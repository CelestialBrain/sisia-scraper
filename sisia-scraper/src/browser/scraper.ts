/**
 * Playwright browser controller for Facebook scraping
 * Supports both semi-manual and full-auto modes with residential proxy
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import * as log from "../utils/logger.js";
import { actionDelay, readingPause } from "../utils/delay.js";
import { 
  getRandomUserAgent, 
  humanScroll, 
  slowScroll, 
  shouldTakeBreak,
  randomBehavior
} from "./antiDetect.js";
import { saveRawCapture } from "../db/database.js";

export interface ScraperConfig {
  mode: "semi-manual" | "full-auto";
  sessionDir: string;
  rawDir: string;
  proxyUrl?: string;
  headless?: boolean;
  maxPostsPerSession?: number;
  sessionBreakMinutes?: number;
  fastMode?: boolean;      // Skip reaction popup parsing for speed
  blockImages?: boolean;   // Block images/CSS for faster loading
  turboMode?: boolean;     // Aggressive speed mode (reduces all waits by 60%)
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export class FacebookScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: ScraperConfig;
  private sessionId: number = 0;
  private startTime: Date = new Date();
  private postsCaptured: number = 0;

  constructor(config: ScraperConfig) {
    this.config = {
      headless: false,
      maxPostsPerSession: 100,
      sessionBreakMinutes: 30,
      ...config,
    };
  }

  /**
   * Parse proxy URL into Playwright format
   */
  private parseProxy(): ProxyConfig | undefined {
    const proxyUrl = this.config.proxyUrl;
    if (!proxyUrl) return undefined;

    try {
      const url = new URL(proxyUrl);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch {
      log.error(`Invalid proxy URL: ${proxyUrl}`);
      return undefined;
    }
  }

  /**
   * Get storage state path for session persistence
   */
  private getStoragePath(): string {
    return join(this.config.sessionDir, "facebook-session.json");
  }

  /**
   * Launch browser with session persistence and optional proxy
   */
  async launch(): Promise<void> {
    log.info("Launching browser...");
    
    // Ensure directories exist
    [this.config.sessionDir, this.config.rawDir].forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });

    const proxy = this.parseProxy();
    if (proxy) {
      log.info(`Using proxy: ${proxy.server}`);
    }

    const isHeadless = this.config.headless === true;  // Explicit false unless specifically set to true
    log.info(`   Browser mode: ${isHeadless ? 'HEADLESS' : 'VISIBLE WINDOW'}`);
    
    this.browser = await chromium.launch({
      headless: isHeadless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--start-maximized",
      ],
    });

    // Check for existing session
    const storagePath = this.getStoragePath();
    const hasExistingSession = existsSync(storagePath);

    const contextOptions: Record<string, unknown> = {
      userAgent: getRandomUserAgent(),
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "Asia/Manila",
    };

    if (proxy) {
      contextOptions.proxy = proxy;
    }

    if (hasExistingSession) {
      log.info("Restoring previous session...");
      try {
        contextOptions.storageState = storagePath;
      } catch (e) {
        log.warn("Could not restore session, starting fresh");
      }
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Block images and CSS if enabled for faster loading
    if (this.config.blockImages) {
      await this.page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico}', route => route.abort());
      await this.page.route('**/*.css', route => route.abort());
      log.info("   Blocking images/CSS for faster loading");
    }

    // Evasion: Override navigator.webdriver
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    this.startTime = new Date();
    this.postsCaptured = 0;
    
    log.success("Browser launched successfully");
  }

  /**
   * Get wait time based on mode (turbo > headless > normal)
   */
  private getWaitTime(baseMs: number): number {
    // Turbo mode: 40% of normal time
    if (this.config.turboMode) {
      return Math.floor(baseMs * 0.4);
    }
    // Headless mode: 60% of normal time
    if (this.config.headless) {
      return Math.floor(baseMs * 0.6);
    }
    return baseMs;
  }

  /**
   * Save current session for persistence
   */
  async saveSession(): Promise<void> {
    if (this.context) {
      const storagePath = this.getStoragePath();
      await this.context.storageState({ path: storagePath });
      log.success("Session saved");
    }
  }

  /**
   * Create a new page in the same context for parallel scraping
   * All pages share cookies/session but can navigate independently
   */
  async createWorkerPage(): Promise<Page> {
    if (!this.context) throw new Error("Browser not launched");
    
    const page = await this.context.newPage();
    
    // Block images if enabled
    if (this.config.blockImages) {
      await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico}', route => route.abort());
      await page.route('**/*.css', route => route.abort());
    }
    
    // Evasion: Override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    
    return page;
  }

  /**
   * HYBRID: Just collect post URLs from search (for parallel discovery)
   * Returns list of post URLs - actual extraction done sequentially
   */
  async collectPostUrls(
    page: Page,
    professorName: string,
    options: { maxPosts?: number; scrollCount?: number; workerId?: number } = {}
  ): Promise<{ professorName: string; postUrls: string[] }> {
    const maxPosts = options.maxPosts || 50;
    const scrollCount = options.scrollCount || 5;
    const workerId = options.workerId || 0;
    
    log.info(`[W${workerId}] 🔍 Searching for: "${professorName}"`);
    
    // Build search URL
    let searchQuery = professorName;
    if (professorName.includes(",")) {
      const parts = professorName.split(",").map(s => s.trim());
      const lastName = parts[0];
      const firstName = parts[1]?.split(/\s+/)[0];
      if (firstName && firstName.length > 1) {
        searchQuery = `${lastName} ${firstName}`;
      } else {
        searchQuery = lastName;
      }
    }
    
    const groupId = process.env.FB_GROUP_ID || "1568550996761154";
    const searchUrl = `https://www.facebook.com/groups/${groupId}/search/?q=${encodeURIComponent(searchQuery)}`;
    
    // Navigate
    try {
      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      log.warn(`[W${workerId}] Navigation timeout, continuing...`);
    }
    
    await page.waitForTimeout(this.getWaitTime(2500));
    
    // Scroll to load posts
    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(this.getWaitTime(1000));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    
    // Collect post URLs
    const postUrls = await page.evaluate(() => {
      const links: string[] = [];
      const seenUrls = new Set<string>();
      
      document.querySelectorAll('a[href*="/posts/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const cleanUrl = href.split('?')[0];
        if (!seenUrls.has(cleanUrl) && /\/groups\/\d+\/posts\/\d+/.test(cleanUrl)) {
          seenUrls.add(cleanUrl);
          links.push(cleanUrl);
        }
      });
      
      return links;
    });
    
    const uniquePosts = [...new Set(postUrls)].slice(0, maxPosts);
    log.info(`[W${workerId}] ✅ Found ${uniquePosts.length} posts for "${professorName}"`);
    
    return { professorName, postUrls: uniquePosts };
  }

  /**
   * Scrape a single professor using a specific page (for parallel execution)
   */
  async scrapeWithPage(
    page: Page,
    professorName: string,
    options: { maxPosts?: number; scrollCount?: number; workerId?: number } = {}
  ): Promise<{ postsProcessed: number; totalComments: number; totalSaved: number }> {
    const maxPosts = options.maxPosts || 50;
    const scrollCount = options.scrollCount || 5;
    const workerId = options.workerId || 0;
    const isTurbo = this.config.turboMode;
    
    log.info(`[W${workerId}] 🤖 Starting scrape for: "${professorName}"`);
    
    // Build search URL
    let searchQuery = professorName;
    if (professorName.includes(",")) {
      const parts = professorName.split(",").map(s => s.trim());
      const lastName = parts[0];
      const firstName = parts[1]?.split(/\s+/)[0];
      if (firstName && firstName.length > 1) {
        searchQuery = `${lastName} ${firstName}`;
      } else {
        searchQuery = lastName;
      }
    }
    
    const groupId = process.env.FB_GROUP_ID || "1568550996761154";
    const searchUrl = `https://www.facebook.com/groups/${groupId}/search/?q=${encodeURIComponent(searchQuery)}`;
    
    log.info(`[W${workerId}]    Search query: "${searchQuery}"`);
    
    // Navigate
    try {
      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      log.warn(`[W${workerId}] Navigation timeout, continuing...`);
    }
    
    await page.waitForTimeout(this.getWaitTime(2500));
    
    // Scroll to load posts
    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(this.getWaitTime(1500));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    
    // Collect post URLs
    const postUrls = await page.evaluate(() => {
      const links: string[] = [];
      const seenUrls = new Set<string>();
      
      document.querySelectorAll('a[href*="/posts/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const cleanUrl = href.split('?')[0];
        if (!seenUrls.has(cleanUrl) && /\/groups\/\d+\/posts\/\d+/.test(cleanUrl)) {
          seenUrls.add(cleanUrl);
          links.push(cleanUrl);
        }
      });
      
      return links;
    });
    
    const uniquePosts = [...new Set(postUrls)];
    const postsToProcess = uniquePosts.slice(0, maxPosts);
    log.info(`[W${workerId}]    Found ${uniquePosts.length} posts, processing ${postsToProcess.length}`);
    
    let postsProcessed = 0;
    let totalComments = 0;
    let totalSaved = 0;
    
    for (let i = 0; i < postsToProcess.length; i++) {
      const postUrl = postsToProcess[i];
      const postId = postUrl.match(/(\d+)\/?$/)?.[1] || "unknown";
      
      try {
        await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        
        // Wait for content to load (modal or article)
        try {
          await page.waitForSelector('[role="dialog"], [role="article"], [data-pagelet]', { timeout: 5000 });
        } catch {
          // Continue anyway
        }
        await page.waitForTimeout(this.getWaitTime(2000));
        
        // Extract post content for relevance check using multiple strategies
        const postContent = await page.evaluate(() => {
          // Try modal first (post detail view)
          const modal = document.querySelector('[role="dialog"]');
          if (modal) {
            const textElements = modal.querySelectorAll('[dir="auto"]');
            let text = "";
            textElements.forEach(el => {
              text += el.textContent + " ";
            });
            return text.substring(0, 1000);
          }
          
          // Try article
          const article = document.querySelector('[role="article"]');
          if (article) {
            return article.textContent?.substring(0, 1000) || "";
          }
          
          // Fallback to body text
          return document.body?.innerText?.substring(0, 1000) || "";
        });
        
        // Skip if truly empty
        if (!postContent || postContent.trim().length < 20) {
          postsProcessed++;
          continue;
        }
        
        // Verify relevance
        const isRelevant = this.verifyPostRelevance(postContent, professorName);
        if (!isRelevant) {
          postsProcessed++;
          continue;
        }
        
        log.info(`[W${workerId}]    ✓ Post ${i + 1}/${postsToProcess.length} relevant`);
        
        // Extract comments from modal or article elements
        const comments = await page.evaluate(() => {
          const results: Array<{ text: string; reactions: number; reactionTypes: string[]; isReply: boolean }> = [];
          
          // Look for comments in modal or page
          const container = document.querySelector('[role="dialog"]') || document.body;
          const articles = container.querySelectorAll('[role="article"]');
          
          articles.forEach((el, idx) => {
            if (idx === 0) return; // Skip main post (first article)
            
            // Get text from dir=auto elements (cleaner extraction)
            const textElements = el.querySelectorAll('[dir="auto"]');
            let text = "";
            textElements.forEach(te => {
              const t = te.textContent?.trim();
              if (t && t.length > 3) text += t + " ";
            });
            
            const cleanText = text.trim();
            if (cleanText.length > 15) {
              results.push({ 
                text: cleanText.substring(0, 1000), 
                reactions: 0, 
                reactionTypes: [], 
                isReply: false 
              });
            }
          });
          
          return results;
        });
        
        if (comments.length > 0) {
          const { bulkSaveDOMFeedback } = await import("../db/database.js");
          const savedCount = bulkSaveDOMFeedback(this.sessionId, postUrl, professorName, comments);
          totalComments += comments.length;
          totalSaved += savedCount;
          log.info(`[W${workerId}]       ${savedCount}/${comments.length} comments saved`);
        }
        
        postsProcessed++;
        
        // Small delay between posts to avoid detection
        await page.waitForTimeout(this.getWaitTime(500));
      } catch (err) {
        log.warn(`[W${workerId}]    Post ${postId} failed: ${err}`);
        postsProcessed++;
      }
    }
    
    log.info(`[W${workerId}] ✅ Complete: ${totalSaved} saved from ${postsProcessed} posts`);
    return { postsProcessed, totalComments, totalSaved };
  }

  /**
   * Navigate to URL with human-like behavior
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    
    log.info(`Navigating to: ${url}`);
    try {
      await this.page.goto(url, { 
        waitUntil: "domcontentloaded",
        timeout: 60000 
      });
      await this.page.waitForTimeout(2000);
    } catch (e) {
      log.warn(`Navigation slow, continuing anyway...`);
    }
    await actionDelay();
    await randomBehavior(this.page);
  }

  /**
   * Navigate to Facebook group
   */
  async goToGroup(): Promise<void> {
    const groupUrl = process.env.FB_GROUP_URL || "https://www.facebook.com/groups/ateneoprofstopick";
    await this.navigate(groupUrl);
  }

  /**
   * Search for a professor in the group
   * Supports formats: "LASTNAME, FIRSTNAME", "FIRSTNAME LASTNAME", or just "LASTNAME"
   */
  async searchProfessor(name: string, course?: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    
    // Parse the name to extract last and first name
    let searchQuery = name;
    
    if (name.includes(",")) {
      // AISIS format: "LASTNAME, FIRSTNAME M."
      const parts = name.split(",").map(s => s.trim());
      const lastName = parts[0];
      const firstName = parts[1]?.split(/\s+/)[0]; // Get first word of first name
      if (firstName && firstName.length > 1) {
        searchQuery = `${lastName} ${firstName}`;
      } else {
        searchQuery = lastName;
      }
    } else if (name.includes(" ")) {
      // Already has spaces: "FIRSTNAME LASTNAME" - use as is
      searchQuery = name;
    }
    // else: single word (last name only) - use as is
    
    // Use the group ID directly to avoid URL path issues
    const groupId = process.env.FB_GROUP_ID || "1568550996761154";
    
    // Add course to search query if provided (helps narrow results)
    const fullQuery = course ? `${searchQuery} ${course}` : searchQuery;
    const searchUrl = `https://www.facebook.com/groups/${groupId}/search/?q=${encodeURIComponent(fullQuery)}`;
    
    log.scrape(`Searching for professor: ${name}`);
    if (course) log.info(`   With course context: ${course}`);
    log.info(`   Search query: "${fullQuery}"`);
    
    // Navigate and wait for the page to fully load
    try {
      await this.page.goto(searchUrl, { 
        waitUntil: "networkidle",
        timeout: 30000 
      });
    } catch (e) {
      log.warn(`Navigation timeout, continuing...`);
    }
    
    // Wait for search results to render - look for article elements or feed container
    const waitTime = this.getWaitTime(5000);
    log.info(`   Waiting ${waitTime}ms for content to load...`);
    
    try {
      // Wait for either articles or a div with role="feed" to appear
      await this.page.waitForSelector('[role="article"], [role="feed"], [data-pagelet*="GroupFeed"]', { 
        timeout: 10000 
      });
      log.info(`   ✓ Content elements detected`);
    } catch (e) {
      log.warn(`   Content elements not found, page may not have loaded properly`);
      
      // Debug: check what we got
      const pageInfo = await this.page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          bodyLength: document.body?.innerText?.length || 0,
          bodyPreview: document.body?.innerText?.substring(0, 200) || '',
          hasLogin: document.body?.innerText?.includes('Log in') || false,
          hasError: document.body?.innerText?.includes('error') || document.body?.innerText?.includes('Error') || false,
        };
      });
      log.info(`   📋 Page debug: title="${pageInfo.title}", bodyLength=${pageInfo.bodyLength}`);
      log.info(`   📋 Body preview: ${pageInfo.bodyPreview.substring(0, 100)}...`);
      if (pageInfo.hasLogin) log.warn(`   ⚠️ Login prompt detected - session may have expired`);
      if (pageInfo.hasError) log.warn(`   ⚠️ Error text detected on page`);
    }
    
    // Additional wait for dynamic content
    await this.page.waitForTimeout(waitTime);
  }

  /**
   * Capture current page HTML
   */
  async captureCurrentPage(): Promise<string> {
    if (!this.page) throw new Error("Browser not launched");
    
    const html = await this.page.content();
    const url = this.page.url();
    
    // Save to raw directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `capture-${timestamp}.html`;
    const filepath = join(this.config.rawDir, filename);
    
    writeFileSync(filepath, html, "utf-8");
    log.capture(`Saved: ${filename}`);
    
    // Also save to database if session is active
    if (this.sessionId > 0) {
      saveRawCapture(this.sessionId, url, html);
    }
    
    this.postsCaptured++;
    
    return html;
  }

  /**
   * Scroll and capture content (for infinite scroll pages)
   */
  async scrollAndCapture(scrollCount: number = 3): Promise<string[]> {
    if (!this.page) throw new Error("Browser not launched");
    
    const captures: string[] = [];
    
    for (let i = 0; i < scrollCount; i++) {
      // Check if we should take a break
      const breakCheck = shouldTakeBreak(
        this.startTime,
        this.postsCaptured,
        this.config.maxPostsPerSession,
        this.config.sessionBreakMinutes
      );
      
      if (breakCheck.shouldBreak) {
        log.warn(`Taking break: ${breakCheck.reason}`);
        break;
      }
      
      // Capture current view
      const html = await this.captureCurrentPage();
      captures.push(html);
      
      // Scroll down
      await slowScroll(this.page, 3);
      
      // Random behavior
      await randomBehavior(this.page);
      
      log.info(`Scroll ${i + 1}/${scrollCount} complete`);
    }
    
    return captures;
  }

  /**
   * Set session ID for database logging
   */
  setSessionId(id: number): void {
    this.sessionId = id;
  }

  /**
   * Get current page for manual control
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Check if a modal dialog is currently open
   */
  async hasModalOpen(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const modal = await this.page.$('[role="dialog"]');
      return modal !== null;
    } catch {
      return false;
    }
  }

  /**
   * Select "All comments" filter (lightweight, doesn't expand everything)
   * Returns true if successfully switched
   */
  async selectAllCommentsFilter(): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      // Look for "Most relevant" dropdown which indicates filter is available
      const filterButton = await this.page.$('span:has-text("Most relevant")');
      if (filterButton) {
        await filterButton.click();
        await this.page.waitForTimeout(800);
        
        const allCommentsOption = await this.page.$('span:has-text("All comments")');
        if (allCommentsOption) {
          await allCommentsOption.click();
          await this.page.waitForTimeout(1500);
          log.info("Switched to 'All comments' filter");
          return true;
        }
      }
      
      // Already on "All comments" or no filter available
      return true;
    } catch (e) {
      log.debug("Could not switch comment filter");
      return false;
    }
  }

  /**
   * Expand all comments on a post - CRITICAL for full data capture
   * Facebook loads comments incrementally, need to:
   * 1. Switch to "All comments" filter
   * 2. Click all "View more comments" buttons
   * 3. Expand all "View all X replies" links
   */
  async expandAllComments(): Promise<number> {
    if (!this.page) throw new Error("Browser not launched");
    
    let expandedCount = 0;
    const isTurbo = this.config.turboMode;
    log.info(`📂 Starting comment expansion...${isTurbo ? ' (TURBO)' : ''}`);
    
    // Target the modal dialog for all operations
    const modalSelector = '[role="dialog"]';

    // Step 1: Switch comment filter to "All comments"
    log.info("   Step 1: Looking for comment filter in modal...");
    try {
      // Quick wait for modal to stabilize
      await this.page.waitForTimeout(this.getWaitTime(500));
      
      // Look for the filter dropdown inside the modal
      const filterDropdown = await this.page.$(`${modalSelector} [aria-haspopup="menu"]:has-text("Most relevant"), ${modalSelector} span:has-text("Most relevant")`);
      
      if (filterDropdown) {
        log.info("   ↳ Found 'Most relevant' dropdown, clicking...");
        await filterDropdown.click({ force: true, timeout: 5000 });
        await this.page.waitForTimeout(this.getWaitTime(600));
        
        // Look for "All comments" option in popup menu
        const allCommentsOption = await this.page.$('[role="menuitem"]:has-text("All comments"), [role="option"]:has-text("All comments"), div:has-text("All comments"):not(:has(*:has-text("All comments")))');
        
        if (allCommentsOption) {
          log.info("   ↳ Found 'All comments' option, clicking...");
          await allCommentsOption.click({ force: true, timeout: 5000 });
          await this.page.waitForTimeout(this.getWaitTime(800));
          log.success("   ↳ Switched to 'All comments' filter");
        } else {
          log.info("   ↳ 'All comments' option not found in dropdown");
        }
      } else {
        log.info("   ↳ No filter dropdown found (may already be on 'All comments')");
      }
    } catch (e) {
      log.info(`   ↳ Filter error: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // Step 2: Click all "View more comments" buttons
    log.info("   Step 2: Looking for 'View more comments' buttons...");
    let viewMoreClicks = 0;
    const maxViewMoreClicks = 20;
    
    while (viewMoreClicks < maxViewMoreClicks) {
      // Target buttons inside the modal
      const viewMoreButton = await this.page.$(`${modalSelector} span:has-text("View more comments"), ${modalSelector} span:has-text("View previous comments"), ${modalSelector} [role="button"]:has-text("more comments")`);
      
      if (!viewMoreButton) {
        log.info(`   ↳ No more 'View more comments' buttons (clicked ${viewMoreClicks})`);
        break;
      }
      
      try {
        const buttonText = await viewMoreButton.textContent();
        if (!isTurbo) log.info(`   ↳ Clicking: "${buttonText?.trim().substring(0, 40)}"`);
        await viewMoreButton.click({ force: true, timeout: 5000 });
        await this.page.waitForTimeout(this.getWaitTime(800));
        viewMoreClicks++;
        expandedCount++;
      } catch (e) {
        log.info(`   ↳ Click failed: ${e instanceof Error ? e.message : 'unknown'}`);
        break;
      }
    }

    // Step 3: Expand all nested replies
    log.info("   Step 3: Looking for 'View all X replies' buttons...");
    let replyExpansions = 0;
    const maxReplyExpansions = 50;
    
    while (replyExpansions < maxReplyExpansions) {
      // Target reply buttons inside the modal - look for specific patterns
      const replyButton = await this.page.$(`${modalSelector} span:has-text("View all"):has-text("replies"), ${modalSelector} span:has-text("View"):has-text("more replies")`);
      
      if (!replyButton) {
        log.info(`   ↳ No more reply buttons found (expanded ${replyExpansions})`);
        break;
      }
      
      const text = await replyButton.textContent();
      if (!text || !text.toLowerCase().includes('repl')) {
        log.info(`   ↳ Found element but not a reply button: "${text?.substring(0, 30)}"`);
        break;
      }
      
      try {
        if (!isTurbo) log.info(`   ↳ Clicking: "${text.trim()}"`);
        await replyButton.click({ force: true, timeout: 5000 });
        await this.page.waitForTimeout(this.getWaitTime(600));
        replyExpansions++;
        expandedCount++;
      } catch (e) {
        log.info(`   ↳ Click failed: ${e instanceof Error ? e.message : 'unknown'}`);
        break;
      }
    }

    log.success(`📂 Expansion complete: ${viewMoreClicks} 'View more' + ${replyExpansions} replies = ${expandedCount} total`);
    return expandedCount;
  }

  /**
   * Extract the main post content (the original post, not comments)
   * Used to verify the post is actually about the professor being searched
   */
  async extractMainPostContent(): Promise<string> {
    if (!this.page) return "";
    
    try {
      const result = await this.page.evaluate(() => {
        let allText = "";
        let debug = "";
        
        // Get the current URL - it contains the post content in Facebook's format
        const url = window.location.href;
        
        // Try getting the page title or h1 which often contains post info
        const title = document.title || "";
        
        // Get text from data-ad-preview elements (Facebook's post preview)
        const adPreviews = document.querySelectorAll('[data-ad-preview]');
        if (adPreviews.length > 0) {
          // Get the LAST ad-preview (usually the currently viewed post)
          const lastPreview = adPreviews[adPreviews.length - 1];
          allText = (lastPreview as HTMLElement).innerText || "";
          debug = `ad-preview[${adPreviews.length}]: ${allText.length} chars`;
        }
        
        // Fallback: Get text from the body's first article
        if (!allText || allText.length < 20) {
          const articles = document.querySelectorAll('[role="article"]');
          if (articles.length > 0) {
            // Get all text from first 3 articles
            for (let i = 0; i < Math.min(3, articles.length); i++) {
              const article = articles[i];
              const textElements = article.querySelectorAll('[dir="auto"]');
              textElements.forEach((el, idx) => {
                const text = (el as HTMLElement).innerText?.trim() || "";
                if (text.length > 5 && idx < 8) {
                  allText += " " + text;
                }
              });
            }
            debug = `articles[${articles.length}]: ${allText.length} chars`;
          }
        }
        
        // Add title as additional context
        allText = title + " " + allText + " " + decodeURIComponent(url);
        
        return { text: allText.toLowerCase().trim(), debug, preview: allText.slice(0, 80) };
      });
      
      log.info(`   📋 "${result.preview}..." [${result.debug}]`);
      return result.text;
    } catch (err) {
      log.info(`   ❌ Extraction error: ${err}`);
      return "";
    }
  }

  /**
   * Verify if the post content mentions the professor name
   * Returns true if the post appears to be about ONLY this professor (not a comparison)
   * When first name is provided, requires BOTH first AND last name match
   */
  verifyPostRelevance(postContent: string, professorName: string, course?: string): boolean {
    if (!postContent || !professorName) {
      log.info(`   ⚠️ Empty post content - skipping`);
      return false;
    }
    
    const lowerContent = postContent.toLowerCase();
    
    // Extract last name and first name
    // Supports: "LASTNAME, FIRSTNAME M." or "FIRSTNAME LASTNAME"
    let lastName = "";
    let firstName = "";
    
    if (professorName.includes(",")) {
      // AISIS format: "LASTNAME, FIRSTNAME M."
      const nameParts = professorName.split(',').map(s => s.trim());
      lastName = nameParts[0]?.toLowerCase() || "";
      firstName = nameParts[1]?.split(/\s+/)[0]?.toLowerCase() || "";
    } else if (professorName.includes(" ")) {
      // "FIRSTNAME LASTNAME" format
      const parts = professorName.split(/\s+/);
      if (parts.length >= 2) {
        firstName = parts[0].toLowerCase();
        lastName = parts[parts.length - 1].toLowerCase();
      } else {
        lastName = parts[0].toLowerCase();
      }
    } else {
      // Single word (last name only)
      lastName = professorName.toLowerCase();
    }
    
    // Check name matching
    const hasLastName = lastName.length > 2 && lowerContent.includes(lastName);
    const hasFirstName = firstName.length > 2 && lowerContent.includes(firstName);
    
    // If we have first name, require BOTH first AND last name match (stricter)
    // This prevents "Ian Garces" from matching posts about "Jhoana Garces"
    let mentionsOurProf = false;
    if (firstName.length > 2) {
      // Full name provided - require both
      mentionsOurProf = hasLastName && hasFirstName;
      if (!mentionsOurProf) {
        log.info(`   ⚠️ Post doesn't mention both "${lastName}" AND "${firstName}" - skipping`);
        return false;
      }
    } else {
      // Last name only - just require last name
      mentionsOurProf = hasLastName;
      if (!mentionsOurProf) {
        log.info(`   ⚠️ Post doesn't mention "${lastName}" - skipping`);
        return false;
      }
    }
    
    // Optional: verify course context if provided
    if (course) {
      const courseLower = course.toLowerCase().replace(/\s+/g, '');
      const contentNoSpaces = lowerContent.replace(/\s+/g, '');
      if (!contentNoSpaces.includes(courseLower)) {
        // Course not mentioned, but still allow if name matches well
        log.info(`   ⚠️ Post doesn't mention course "${course}" - but name matches`);
      }
    }
    
    // Detect comparison posts (mentions multiple professors)
    // Look for patterns like "X vs Y", "X or Y", "between X and Y", etc.
    const comparisonPatterns = [
      / vs\.? /i,
      / or /i,
      /between .* and /i,
      /\bwho.*better\b/i,
      /\bwhich.*better\b/i,
      /compare/i,
    ];
    
    const isComparisonPost = comparisonPatterns.some(p => p.test(lowerContent));
    
    // Count how many potential professor names are mentioned (ALL CAPS words or Title Case with comma)
    const profNamePattern = /\b[A-Z]{3,}(?:,\s*[A-Za-z]+)?\b/g;
    const allCapsWords = postContent.match(profNamePattern) || [];
    const uniqueNames = new Set(allCapsWords.map(n => n.toLowerCase()));
    
    if (isComparisonPost && uniqueNames.size > 1) {
      log.info(`   ⚠️ Comparison post detected (${uniqueNames.size} profs) - skipping`);
      return false;
    }
    
    return true;
  }

  /**
   * Navigate directly to a post URL for full comment access
   */
  async openPost(postUrl: string): Promise<void> {
    await this.navigate(postUrl);
    await this.page?.waitForTimeout(2000);
    await this.expandAllComments();
  }

  /**
   * Extract comments from current page DOM (call after expandAllComments)
   * Returns structured comment data without commenter names (anonymized)
   * Includes comprehensive debug logging for analysis
   */
  async extractCommentsFromDOM(): Promise<Array<{
    text: string;
    reactions: number;
    reactionTypes: string[];
    isReply: boolean;
  }>> {
    if (!this.page) throw new Error("Browser not launched");

    // First, log page structure for debugging
    const pageInfo = await this.page.evaluate(() => {
      const info = {
        url: window.location.href,
        hasModal: document.querySelector('[role="dialog"]') !== null,
        modalCount: document.querySelectorAll('[role="dialog"]').length,
        articleCount: document.querySelectorAll('[role="article"]').length,
        commentFilterText: document.querySelector('span')?.textContent?.includes('comment') || false,
        textElements: document.querySelectorAll('[dir="auto"]').length,
        postIdMatch: window.location.href.match(/\/(\d{10,})/),
        bodyTextSample: document.body.textContent?.substring(0, 200) || '',
      };
      return info;
    });
    
    log.info(`📊 Page Structure Analysis:`);
    log.info(`   URL: ${pageInfo.url.substring(0, 80)}...`);
    log.info(`   Modal open: ${pageInfo.hasModal} (count: ${pageInfo.modalCount})`);
    log.info(`   Articles found: ${pageInfo.articleCount}`);
    log.info(`   Text elements [dir=auto]: ${pageInfo.textElements}`);
    if (pageInfo.postIdMatch) {
      log.info(`   Post ID detected: ${pageInfo.postIdMatch[1]}`);
    }

    const comments = await this.page.evaluate(() => {
      const results: Array<{ text: string; reactions: number; reactionTypes: string[]; isReply: boolean }> = [];
      const debugLog: string[] = [];
      
      // Find all comment containers (Facebook uses role="article" for comments)
      const commentElements = document.querySelectorAll('[role="article"]');
      debugLog.push(`Found ${commentElements.length} article elements`);
      
      let skippedMainPost = 0;
      let skippedNoText = 0;
      let skippedTooShort = 0;
      let skippedPattern = 0;
      let extracted = 0;
      
      commentElements.forEach((el, idx) => {
        // Skip if it's the main post
        if (el.closest('[aria-label*="post"]') === el) {
          skippedMainPost++;
          return;
        }
        
        // Get comment text - need to skip the commenter name (usually the first dir="auto")
        // and get the actual comment content (subsequent dir="auto" elements)
        const allTextElements = el.querySelectorAll('[dir="auto"]:not([aria-hidden])');
        if (allTextElements.length === 0) {
          skippedNoText++;
          return;
        }
        
        // Extract commenter name (first element) and comment text (remaining elements)
        let commenterName = "";
        let commentText = "";
        
        allTextElements.forEach((textEl, textIdx) => {
          const content = textEl.textContent?.trim() || "";
          
          // Skip UI elements
          if (content.match(/^(Like|Reply|Comment|Share|See more|View .* repl|Write a comment|Most relevant|All comments|\d+ repl|\d+[hdwmy]|Edited|·)/i)) {
            return;
          }
          
          // First substantial text is usually the name
          if (commenterName === "" && content.length > 1 && content.length < 100) {
            commenterName = content;
          } else if (content.length > 3 && !content.match(/^\d+[hdwmy]$/)) {
            // Subsequent substantial text is the actual comment
            commentText += (commentText ? " " : "") + content;
          }
        });
        
        // If no separate comment text found, use everything after name
        const text = commentText || "";
        if (text.length < 3 || text.length > 5000) {
          skippedTooShort++;
          return;
        }
        
        // Skip if still looks like non-comment content
        if (text.match(/^(Like|Reply|Comment|Share|.* reacted|See more|View .* repl|Write a comment|Most relevant|All comments)/i)) {
          skippedPattern++;
          return;
        }
        
        // Count reactions (reaction types will be enriched later by clicking popup)
        let reactions = 0;
        let reactionTypes: string[] = [];
        
        // Find the reaction count area
        const reactionArea = el.querySelector('[aria-label*="reaction"]');
        if (reactionArea) {
          const ariaLabel = reactionArea.getAttribute("aria-label") || "";
          // Extract count (e.g., "2 reactions" or "1 reaction")
          const countMatch = ariaLabel.match(/(\d+)/);
          if (countMatch) reactions = parseInt(countMatch[1]);
        }
        
        // Check if it's a reply (nested comment)
        const isReply = el.closest('[aria-label*="reply"]') !== null ||
                       el.parentElement?.closest('[role="article"]') !== null;
        
        extracted++;
        if (extracted <= 3) {
          const typesStr = reactionTypes.length > 0 ? reactionTypes.join(',') : 'none';
          debugLog.push(`Sample ${extracted}: "${text.substring(0, 50)}..." (${reactions} reactions: ${typesStr})`);
        }
        
        results.push({ text, reactions, reactionTypes, isReply });
      });
      
      debugLog.push(`Skip stats: mainPost=${skippedMainPost}, noText=${skippedNoText}, tooShort=${skippedTooShort}, pattern=${skippedPattern}`);
      debugLog.push(`Total extracted: ${extracted}`);
      
      return { comments: results, debugLog };
    });

    // Log debug info
    log.info(`📋 Extraction Debug Log:`);
    comments.debugLog.forEach(msg => log.info(`   ${msg}`));
    
    log.success(`Extracted ${comments.comments.length} comments from DOM`);
    return comments.comments;
  }

  /**
   * Full extraction workflow: expand all comments, then extract data
   */
  async extractAllComments(): Promise<Array<{
    text: string;
    reactions: number;
    reactionTypes: string[];
    isReply: boolean;
  }>> {
    await this.expandAllComments();
    return this.extractCommentsFromDOM();
  }

  /**
   * Click each reaction button and parse the popup to get exact counts per type
   * This is slower but accurate - takes ~2-3s per comment with reactions
   */
  async enrichCommentsWithReactionTypes(
    comments: Array<{ text: string; reactions: number; reactionTypes: string[]; isReply: boolean }>
  ): Promise<Array<{ text: string; reactions: number; reactionTypes: string[]; isReply: boolean }>> {
    if (!this.page) throw new Error("Browser not launched");
    
    // Find all reaction buttons within articles (not the main post)
    const reactionButtons = await this.page.$$('[role="article"] [aria-label*="reactions; see who reacted"]');
    log.info(`🔍 Found ${reactionButtons.length} comment reaction buttons to parse`);
    
    if (reactionButtons.length === 0) {
      return comments;
    }
    
    // For each reaction button, get the nearby text to match with comments
    for (const btn of reactionButtons) {
      try {
        // Get the reaction count from aria-label
        const ariaLabel = await btn.getAttribute("aria-label");
        const countMatch = ariaLabel?.match(/^(\d+)/);
        const count = countMatch ? parseInt(countMatch[1]) : 0;
        
        if (count === 0) continue;
        
        // Get the text from the parent article to match with our extracted comments
        const articleText = await btn.evaluate((el) => {
          const article = el.closest('[role="article"]');
          if (!article) return "";
          return (article.textContent || "").substring(0, 200).toLowerCase();
        });
        
        // Find which comment this reaction belongs to
        let matchedIdx = -1;
        for (let i = 0; i < comments.length; i++) {
          const commentStart = comments[i].text.substring(0, 50).toLowerCase();
          if (articleText.includes(commentStart)) {
            matchedIdx = i;
            break;
          }
        }
        
        if (matchedIdx === -1) continue; // No matching comment found
        
        // Click the reaction button to open popup
        await btn.click({ force: true });
        await this.page.waitForTimeout(1500);
        
        // Parse the popup for reaction types - look at ALL dialogs for emoji img alts
        const types: string[] = [];
        const tabContent = await this.page.evaluate(() => {
          // The reaction popup shows emoji types as img alt attributes
          // Search ALL dialogs since the reaction popup order varies
          const dialogs = document.querySelectorAll('[role="dialog"]');
          let reactionText = "";
          
          dialogs.forEach(dialog => {
            // Get all img alt text - FB puts emojis there
            dialog.querySelectorAll("img").forEach(img => {
              const alt = img.getAttribute("alt") || "";
              // Only capture short alts that look like emojis
              if (alt.length > 0 && alt.length < 10) {
                reactionText += " " + alt;
              }
            });
          });
          
          return reactionText;
        });
        
        // Look for specific emoji characters in the tab content
        // These are the actual reaction emojis, not just words
        if (tabContent.includes("😆") || tabContent.includes("😂") || tabContent.includes("😁")) {
          types.push("haha");
        }
        if (tabContent.includes("👍")) {
          types.push("like");
        }
        if (tabContent.includes("❤") || tabContent.includes("❤️")) {
          types.push("love");
        }
        if (tabContent.includes("😮") || tabContent.includes("😲")) {
          types.push("wow");
        }
        if (tabContent.includes("😢") || tabContent.includes("😭")) {
          types.push("sad");
        }
        if (tabContent.includes("😡") || tabContent.includes("😠")) {
          types.push("angry");
        }
        if (tabContent.includes("🥰") || tabContent.includes("🤗")) {
          types.push("care");
        }
        
        // Debug: log what we found
        log.info(`      Tab content: "${tabContent.substring(0, 50)}..."`);
        
        if (types.length > 0) {
          comments[matchedIdx].reactionTypes = types;
          log.info(`   📊 "${comments[matchedIdx].text.substring(0, 30)}...": ${types.join(", ")}`);
        }
        
        // Close the popup
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(500);
        
      } catch (err) {
        log.warn(`   ⚠️ Failed to get reactions for a comment`);
      }
    }
    
    return comments;
  }

  /**
   * Extract the main post's reaction count and types
   * This clicks the post's reaction button and parses the popup
   */
  async extractPostReactions(): Promise<{ count: number; types: string[] }> {
    if (!this.page) throw new Error("Browser not launched");
    
    const result = { count: 0, types: [] as string[] };
    
    try {
      // Find the main post's reaction button (first one outside of comments)
      // The main post reaction should be in the first article or the post header
      const postReactionBtn = await this.page.$('[aria-label*="reactions; see who reacted"]:first-child') ||
                              await this.page.$('[role="article"]:first-of-type [aria-label*="reactions"]');
      
      if (!postReactionBtn) {
        // Try alternative selector - look for reaction area with count
        const altBtn = await this.page.$('[aria-label*="and"][aria-label*="other"]');
        if (!altBtn) {
          log.info("   📊 No post reaction button found");
          return result;
        }
      }
      
      // Get the reaction count from the aria-label of the first reaction area
      const reactionAreas = await this.page.$$('[aria-label*="reaction"]');
      for (const area of reactionAreas) {
        const ariaLabel = await area.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.includes("reactions")) {
          const countMatch = ariaLabel.match(/(\d+)/);
          if (countMatch) {
            result.count = parseInt(countMatch[1]);
            break;
          }
        }
      }
      
      // If we have reactions, click to get types
      if (result.count > 0) {
        const btn = await this.page.$('[aria-label*="reactions; see who reacted"]');
        if (btn) {
          log.info(`   📊 Extracting post reactions (${result.count} total)...`);
          await btn.click({ force: true });
          await this.page.waitForTimeout(1500);
          
          // Parse the popup for reaction types
          const tabContent = await this.page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"]');
            let reactionText = "";
            
            dialogs.forEach(dialog => {
              dialog.querySelectorAll("img").forEach(img => {
                const alt = img.getAttribute("alt") || "";
                if (alt.length > 0 && alt.length < 10) {
                  reactionText += " " + alt;
                }
              });
            });
            
            return reactionText;
          });
          
          // Map emojis to types
          if (tabContent.includes("😆") || tabContent.includes("😂") || tabContent.includes("😁")) {
            result.types.push("haha");
          }
          if (tabContent.includes("👍")) {
            result.types.push("like");
          }
          if (tabContent.includes("❤") || tabContent.includes("❤️")) {
            result.types.push("love");
          }
          if (tabContent.includes("😮") || tabContent.includes("😲")) {
            result.types.push("wow");
          }
          if (tabContent.includes("😢") || tabContent.includes("😭")) {
            result.types.push("sad");
          }
          if (tabContent.includes("😡") || tabContent.includes("😠")) {
            result.types.push("angry");
          }
          if (tabContent.includes("🥰") || tabContent.includes("🤗")) {
            result.types.push("care");
          }
          
          log.info(`      Post reactions: ${result.count} (${result.types.join(", ") || "unknown types"})`);
          
          // Close the popup
          await this.page.keyboard.press("Escape");
          await this.page.waitForTimeout(500);
        }
      }
      
    } catch (err) {
      log.warn("   ⚠️ Failed to extract post reactions");
    }
    
    return result;
  }

  /**
   * Extract comments and save directly to database
   * This is the main method for persistent data capture
   */
  async saveExtractedComments(searchTerm?: string): Promise<{
    commentsExtracted: number;
    feedbackSaved: number;
  }> {
    if (!this.page) throw new Error("Browser not launched");

    // Import database functions dynamically to avoid circular deps
    const { bulkSaveDOMFeedback, logExtraction } = await import("../db/database.js");

    const url = this.page.url();
    
    // Extract search term from URL if not provided
    const actualSearchTerm = searchTerm || this.extractSearchTermFromUrl(url);

    // Extract comments
    const comments = await this.extractAllComments();
    
    if (comments.length === 0) {
      log.warn("No comments found to save");
      return { commentsExtracted: 0, feedbackSaved: 0 };
    }

    // Save to database
    const savedCount = bulkSaveDOMFeedback(
      this.sessionId,
      url,
      actualSearchTerm,
      comments
    );

    // Log the extraction
    logExtraction({
      sessionId: this.sessionId,
      url,
      searchTerm: actualSearchTerm,
      postsExtracted: 1,
      commentsExtracted: comments.length,
      feedbackSaved: savedCount,
    });

    log.success(`Saved ${savedCount} comments from ${actualSearchTerm}`);
    
    return {
      commentsExtracted: comments.length,
      feedbackSaved: savedCount,
    };
  }

  /**
   * Extract search term from Facebook URL
   */
  private extractSearchTermFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const searchParam = urlObj.searchParams.get("q");
      if (searchParam) return searchParam;
      
      // Try to extract from path
      const pathMatch = url.match(/\/search\/?\?q=([^&]+)/);
      if (pathMatch) return decodeURIComponent(pathMatch[1]);
      
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * FULL AUTOMATION: Scrape all posts from search results
   * 1. Search for professor name
   * 2. Scroll to load all posts
   * 3. Collect all post links
   * 4. Open each post, expand comments, extract data
   * 5. Save everything to database
   */
  async scrapeAllPostsFromSearch(
    professorName: string,
    options: { maxPosts?: number; scrollCount?: number; course?: string } = {}
  ): Promise<{
    postsProcessed: number;
    totalComments: number;
    totalSaved: number;
  }> {
    if (!this.page) throw new Error("Browser not launched");
    
    const maxPosts = options.maxPosts || 50;
    const scrollCount = options.scrollCount || 5;
    const course = options.course;
    const isTurbo = this.config.turboMode;
    
    log.info(`🤖 Starting FULL AUTOMATION for: "${professorName}"${isTurbo ? ' (TURBO)' : ''}`);
    log.info(`   Max posts: ${maxPosts}, Scroll count: ${scrollCount}`);
    if (course) log.info(`   Course context: ${course}`);
    
    // Step 1: Search for professor (with optional course context)
    log.info("\n📍 Step 1: Searching for professor...");
    await this.searchProfessor(professorName, course);
    await this.page.waitForTimeout(this.getWaitTime(2500));
    
    // Step 2: Scroll to load more posts
    log.info("\n📍 Step 2: Scrolling to load all posts...");
    for (let i = 0; i < scrollCount; i++) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.page.waitForTimeout(this.getWaitTime(1500));
      if (!isTurbo) log.info(`   Scroll ${i + 1}/${scrollCount}`);
    }
    await this.page.evaluate(() => window.scrollTo(0, 0));  // Scroll back to top
    await this.page.waitForTimeout(this.getWaitTime(800));
    
    // Step 3: Collect all post links from the page
    log.info("\\n📍 Step 3: Collecting post URLs...");
    
    // First, let's debug what's on the page
    const debugInfo = await this.page.evaluate(() => {
      const allLinks = document.querySelectorAll('a[href]');
      const groupLinks: string[] = [];
      const allHrefs: string[] = [];
      
      allLinks.forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (href.includes('/groups/')) {
          groupLinks.push(href);
        }
        // Sample first 20 hrefs
        if (allHrefs.length < 20) {
          allHrefs.push(href);
        }
      });
      
      // Check for various Facebook post patterns
      const postPatterns = {
        postsFormat: document.querySelectorAll('a[href*="/posts/"]').length,
        permalinkFormat: document.querySelectorAll('a[href*="permalink"]').length,
        groupPostsFormat: document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]').length,
        groupPermalinkFormat: document.querySelectorAll('a[href*="/groups/"][href*="permalink"]').length,
        pfbidFormat: document.querySelectorAll('a[href*="pfbid"]').length,
        storyFbidFormat: document.querySelectorAll('a[href*="story_fbid"]').length,
        articleElements: document.querySelectorAll('[role="article"]').length,
      };
      
      return {
        totalLinks: allLinks.length,
        groupLinksCount: groupLinks.length,
        groupLinks: groupLinks.slice(0, 10),
        sampleHrefs: allHrefs,
        postPatterns,
        pageUrl: window.location.href,
        bodyText: document.body.innerText.substring(0, 300),
      };
    });
    
    log.info(`   📊 Debug: Total links: ${debugInfo.totalLinks}, Group links: ${debugInfo.groupLinksCount}`);
    log.info(`   📊 Post patterns found:`);
    log.info(`      - /posts/ format: ${debugInfo.postPatterns.postsFormat}`);
    log.info(`      - permalink format: ${debugInfo.postPatterns.permalinkFormat}`);
    log.info(`      - /groups/*/posts/*: ${debugInfo.postPatterns.groupPostsFormat}`);
    log.info(`      - /groups/*/permalink/*: ${debugInfo.postPatterns.groupPermalinkFormat}`);
    log.info(`      - pfbid format: ${debugInfo.postPatterns.pfbidFormat}`);
    log.info(`      - story_fbid format: ${debugInfo.postPatterns.storyFbidFormat}`);
    log.info(`      - [role=article] elements: ${debugInfo.postPatterns.articleElements}`);
    log.info(`   📊 Sample group links:`);
    debugInfo.groupLinks.forEach((link, i) => log.info(`      ${i+1}. ${link.substring(0, 100)}`));
    
    const postUrls = await this.page.evaluate(() => {
      const links: string[] = [];
      const seenUrls = new Set<string>();
      
      // Pattern 1: Standard /groups/ID/posts/ID format
      document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/(https:\/\/www\.facebook\.com\/groups\/\d+\/posts\/\d+)/);
        if (match && !seenUrls.has(match[1])) {
          seenUrls.add(match[1]);
          links.push(match[1]);
        }
      });
      
      // Pattern 2: Permalink format
      document.querySelectorAll('a[href*="/groups/"][href*="permalink"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/(https:\/\/www\.facebook\.com\/groups\/\d+\/permalink\/\d+)/);
        if (match && !seenUrls.has(match[1])) {
          seenUrls.add(match[1]);
          links.push(match[1]);
        }
      });
      
      // Pattern 3: pfbid format (newer Facebook URL format)
      document.querySelectorAll('a[href*="pfbid"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (href.includes('/groups/') && !seenUrls.has(href)) {
          // Clean up the URL
          const cleanUrl = href.split('?')[0];
          if (!seenUrls.has(cleanUrl)) {
            seenUrls.add(cleanUrl);
            links.push(cleanUrl);
          }
        }
      });
      
      // Pattern 4: story_fbid format
      document.querySelectorAll('a[href*="story_fbid"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (href.includes('/groups/') && !seenUrls.has(href)) {
          seenUrls.add(href);
          links.push(href);
        }
      });
      
      // Pattern 5: Any link containing /groups/GROUP_ID/ with a long numeric ID after
      document.querySelectorAll('a[href*="/groups/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        // Match URLs like /groups/123456/something/789012
        const match = href.match(/\/groups\/(\d+)\/\w+\/(\d{10,})/);
        if (match) {
          const cleanUrl = href.split('?')[0];
          if (!seenUrls.has(cleanUrl)) {
            seenUrls.add(cleanUrl);
            links.push(cleanUrl);
          }
        }
      });
      
      return links;
    });
    
    log.info(`   Found ${postUrls.length} unique posts`);
    
    const postsToProcess = postUrls.slice(0, maxPosts);
    log.info(`   Processing ${postsToProcess.length} posts (limited to ${maxPosts})`);
    
    // Step 4: Process each post
    log.info("\n📍 Step 4: Processing posts...\n");
    
    let postsProcessed = 0;
    let totalComments = 0;
    let totalSaved = 0;
    
    for (let i = 0; i < postsToProcess.length; i++) {
      const postUrl = postsToProcess[i];
      const postId = postUrl.match(/(\d+)\/?$/)?.[1] || "unknown";
      
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`📄 Post ${i + 1}/${postsToProcess.length}: ${postId}`);
      
      try {
        // Navigate to the post
        await this.page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        
        // Wait for content to load
        try {
          await this.page.waitForSelector('[role="dialog"], [role="article"]', { timeout: 5000 });
        } catch {
          // Fallback: just wait
        }
        await this.page.waitForTimeout(this.getWaitTime(1200));
        
        // Dismiss any popups (like PIN creation)
        try {
          const skipBtn = await this.page.$('div[aria-label="Skip"], [role="button"]:has-text("Skip")');
          if (skipBtn) {
            await skipBtn.click({ force: true });
            await this.page.waitForTimeout(this.getWaitTime(400));
          }
        } catch {
          // No popup
        }
        
        // STEP: Verify post is actually about the professor
        const postContent = await this.extractMainPostContent();
        const isRelevant = this.verifyPostRelevance(postContent, professorName, course);
        
        if (!isRelevant) {
          // Skip this post - it's not about the professor we're searching for
          postsProcessed++;
          continue;
        }
        
        log.info(`   ✓ Post verified relevant to "${professorName}"`);
        
        // Expand all comments
        log.info("   🔄 Expanding comments...");
        const expandedCount = await this.expandAllComments();
        log.info(`      Expanded ${expandedCount} sections`);
        
        // Extract comments
        log.info("   📥 Extracting comments...");
        let comments = await this.extractCommentsFromDOM();
        
        // Enrich with reaction types by clicking reaction buttons (skip in turbo+fast mode)
        if (comments.some(c => c.reactions > 0) && !this.config.fastMode) {
          log.info("   📊 Fetching reaction types...");
          comments = await this.enrichCommentsWithReactionTypes(comments);
        }
        
        // Extract main post reactions
        const postReactions = await this.extractPostReactions();
        
        if (comments.length > 0) {
          // Import bulkSaveDOMFeedback dynamically
          const { bulkSaveDOMFeedback } = await import("../db/database.js");
          const savedCount = bulkSaveDOMFeedback(
            this.sessionId,
            postUrl,
            professorName,
            comments,
            undefined, // instructorId
            undefined, // instructorName
            postReactions.count,
            postReactions.types
          );
          
          postsProcessed++;
          totalComments += comments.length;
          totalSaved += savedCount;
          
          log.success(`   ✅ Saved ${savedCount}/${comments.length} comments`);
        } else {
          log.info("   📝 No comments found");
          postsProcessed++;
        }
        
        // Brief pause between posts
        await this.page.waitForTimeout(this.getWaitTime(1000));
        
      } catch (error) {
        log.error(`   ❌ Failed to process post: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Summary
    log.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`🏁 AUTOMATION COMPLETE`);
    log.info(`   Professor: ${professorName}`);
    log.info(`   Posts processed: ${postsProcessed}/${postsToProcess.length}`);
    log.info(`   Total comments extracted: ${totalComments}`);
    log.info(`   Total saved to DB: ${totalSaved}`);
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    return { postsProcessed, totalComments, totalSaved };
  }

  /**
   * Scrape a specific post by direct URL
   * Ideal for posts with many comments (100+) that need deep expansion
   */
  async scrapePostByUrl(
    url: string,
    professorName?: string
  ): Promise<{
    commentsExtracted: number;
    feedbackSaved: number;
    postReactions: number;
    postReactionTypes: string[];
  }> {
    if (!this.page) throw new Error("Browser not launched");

    log.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📄 Direct URL Scrape: ${url.substring(0, 60)}...`);
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Navigate to the post
    log.info("📍 Step 1: Navigating to post...");
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForTimeout(3000);

    // Try to extract professor name from post content if not provided
    const searchTerm = professorName || await this.page.evaluate(() => {
      const title = document.querySelector('[data-ad-comet-preview="message"]');
      return title?.textContent?.substring(0, 50) || "unknown";
    });
    log.info(`   Professor/Search term: ${searchTerm}`);

    // Deep expand all comments - this is the key for 200+ comment posts
    log.info("📍 Step 2: Expanding ALL comments (this may take a while)...");
    await this.expandAllCommentsDeep();

    // Extract comments
    log.info("📍 Step 3: Extracting comments...");
    let comments = await this.extractCommentsFromDOM();

    // Enrich with reaction types (skip in fastMode for speed)
    if (!this.config.fastMode && comments.some(c => c.reactions > 0)) {
      log.info("📍 Step 4: Fetching reaction types...");
      comments = await this.enrichCommentsWithReactionTypes(comments);
    } else if (this.config.fastMode) {
      log.info("📍 Step 4: Skipping reaction type parsing (fastMode)");
    }

    // Extract post reactions
    log.info("📍 Step 5: Extracting post reactions...");
    const postReactions = await this.extractPostReactions();

    let savedCount = 0;
    if (comments.length > 0) {
      // Save to database
      log.info("📍 Step 6: Saving to database...");
      const { bulkSaveDOMFeedback } = await import("../db/database.js");
      savedCount = bulkSaveDOMFeedback(
        this.sessionId,
        url,
        searchTerm,
        comments,
        undefined,
        undefined,
        postReactions.count,
        postReactions.types
      );
      log.success(`   ✅ Saved ${savedCount}/${comments.length} comments`);
    } else {
      log.info("   📝 No comments found");
    }

    log.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`🏁 URL SCRAPE COMPLETE`);
    log.info(`   Comments extracted: ${comments.length}`);
    log.info(`   Saved to DB: ${savedCount}`);
    log.info(`   Post reactions: ${postReactions.count} (${postReactions.types.join(", ") || "none"})`);
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return {
      commentsExtracted: comments.length,
      feedbackSaved: savedCount,
      postReactions: postReactions.count,
      postReactionTypes: postReactions.types,
    };
  }

  /**
   * Deep expand all comments - keeps clicking "View more comments" until exhausted
   * This is essential for posts with 100+ comments
   */
  private async expandAllCommentsDeep(): Promise<number> {
    if (!this.page) throw new Error("Browser not launched");
    
    let totalExpanded = 0;
    
    // Step 1: Switch to "All comments" filter
    log.info("   Step 2a: Switching to 'All comments' filter...");
    try {
      const filterBtn = this.page.locator('div:has-text("Most relevant")').first();
      if (await filterBtn.count() > 0) {
        await filterBtn.click();
        await this.page.waitForTimeout(1000);
        
        const allCommentsOption = this.page.locator('span:has-text("All comments")').first();
        if (await allCommentsOption.count() > 0) {
          await allCommentsOption.click();
          await this.page.waitForTimeout(2000);
          log.success("      ↳ Switched to 'All comments' filter");
        }
      }
    } catch (err) {
      log.info("      ↳ Could not switch filter (may already be on 'All comments')");
    }
    
    // Step 2: Scroll inside the modal to trigger infinite scroll loading
    log.info("   Step 2b: Scrolling modal to load ALL comments (infinite scroll)...");
    let scrollCount = 0;
    const maxScrolls = 30; // Safety limit for very long threads (30 scrolls = ~200+ comments)
    let lastArticleCount = 0;
    let stableCount = 0;
    
    for (let i = 0; i < maxScrolls; i++) {
      // Find the scrollable element inside dialog with the largest scrollHeight
      const scrolled = await this.page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        let targetScrollable: Element | null = null;
        let maxScrollHeight = 0;
        
        // Search all dialogs for the scrollable element with largest scrollHeight
        for (const dialog of dialogs) {
          const allChildren = dialog.querySelectorAll('*');
          for (const child of allChildren) {
            if (child.scrollHeight > child.clientHeight + 10) { // +10 to ensure it's actually scrollable
              const style = window.getComputedStyle(child);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                if (child.scrollHeight > maxScrollHeight) {
                  maxScrollHeight = child.scrollHeight;
                  targetScrollable = child;
                }
              }
            }
          }
        }
        
        if (targetScrollable) {
          // Scroll the found element
          targetScrollable.scrollBy({ top: 500, behavior: 'smooth' });
          return { found: true, scrollHeight: maxScrollHeight };
        }
        
        // Fallback: scroll the page
        window.scrollBy({ top: 500, behavior: 'smooth' });
        return { found: false, scrollHeight: 0 };
      });
      
      scrollCount++;
      await this.page.waitForTimeout(1500);
      
      // Check if new articles loaded
      const currentArticleCount = await this.page.locator('[role="article"]').count();
      
      if (currentArticleCount === lastArticleCount) {
        stableCount++;
        if (stableCount >= 3) {
          log.info(`      ↳ No new comments after ${stableCount} scrolls, stopping`);
          break;
        }
      } else {
        stableCount = 0;
        lastArticleCount = currentArticleCount;
      }
      
      // Log progress every 5 scrolls
      if (scrollCount % 5 === 0) {
        log.info(`      ↳ Scroll ${scrollCount}: ${currentArticleCount} articles loaded`);
      }
    }
    log.success(`      ↳ Scrolled modal ${scrollCount} times, loaded ${lastArticleCount} articles`);
    
    // Step 2.5: Also try clicking any "View more comments" buttons that might appear
    log.info("   Step 2b2: Checking for 'View more comments' buttons...");
    let viewMoreClicks = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const viewMoreBtns = this.page.locator('div[role="button"]:has-text("View more comments")');
      const btnCount = await viewMoreBtns.count();
      
      if (btnCount === 0) break;
      
      try {
        await viewMoreBtns.first().click({ force: true });
        viewMoreClicks++;
        await this.page.waitForTimeout(1500);
      } catch {
        break;
      }
    }
    if (viewMoreClicks > 0) {
      log.success(`      ↳ Clicked 'View more comments' ${viewMoreClicks} times`);
    }
    totalExpanded += scrollCount + viewMoreClicks;
    
    // Step 3: Expand all reply threads
    log.info("   Step 2c: Expanding reply threads...");
    let replyExpansions = 0;
    
    for (let attempt = 0; attempt < 20; attempt++) {
      const replyBtns = this.page.locator('div[role="button"]:has-text("View")').filter({ hasText: /view.*\d+.*repl/i });
      const btnCount = await replyBtns.count();
      
      if (btnCount === 0) break;
      
      try {
        await replyBtns.first().click({ force: true });
        replyExpansions++;
        await this.page.waitForTimeout(1000);
      } catch {
        break;
      }
    }
    totalExpanded += replyExpansions;
    log.success(`      ↳ Expanded ${replyExpansions} reply threads`);
    
    log.success(`   ✅ Total expansions: ${totalExpanded}`);
    return totalExpanded;
  }

  /**
   * Check if logged into Facebook
   */
  async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      // Only navigate to Facebook if we're not already there
      const currentUrl = this.page.url();
      if (!currentUrl.includes('facebook.com')) {
        await this.page.goto("https://www.facebook.com", { 
          waitUntil: "domcontentloaded",
          timeout: 60000  // 60 second timeout
        });
        await this.page.waitForTimeout(2000); // Give page time to render
      }
    } catch (e) {
      log.error("Failed to navigate to Facebook:", e);
      return false;
    }
    
    // Check for actual logged-in indicators (more reliable than just absence of login form)
    try {
      // Look for indicators that we're fully logged in:
      // 1. Profile link in header/navigation
      // 2. Home feed container
      // 3. Composer box
      // 4. User menu
      const loggedInIndicator = await this.page.$('[aria-label="Your profile"], [aria-label="Home"], [data-pagelet="LeftRail"], [role="navigation"] [role="button"]');
      
      // Also check we're NOT on login, 2FA, or checkpoint pages
      const url = this.page.url();
      const isOnLoginPage = url.includes('/login') || url.includes('checkpoint') || url.includes('two_step_verification');
      
      // Check for login form (if present, not logged in)
      const loginForm = await this.page.$('input[name="email"]');
      
      // Check for 2FA form
      const twoFactorForm = await this.page.$('input[name="approvals_code"]');
      
      // Logged in if: has logged-in indicators AND not on login/2FA pages AND no login form AND no 2FA form
      const isLoggedIn = (loggedInIndicator !== null || (!isOnLoginPage && !loginForm && !twoFactorForm));
      
      return isLoggedIn && !loginForm && !twoFactorForm && !isOnLoginPage;
    } catch (e) {
      // Navigation happened - check URL
      const url = this.page.url();
      return url.includes('facebook.com') && !url.includes('login') && !url.includes('checkpoint');
    }
  }

  /**
   * Wait for user to log in manually (handles 2FA)
   */
  async waitForLogin(timeoutMinutes: number = 5): Promise<boolean> {
    if (!this.page) return false;
    
    log.info("Please log in to Facebook in the browser window...");
    log.info("   (Complete any 2FA verification if prompted)");
    log.info("   (Page will NOT refresh - take your time)");
    
    const timeout = timeoutMinutes * 60 * 1000;
    const checkInterval = 5000;  // Check every 5 seconds, not 3
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Check current page state WITHOUT navigating (don't interrupt 2FA)
        const url = this.page.url();
        
        // Skip check if we're on a login/checkpoint/2FA page - user is still authenticating
        if (url.includes('login') || url.includes('checkpoint') || url.includes('two_step')) {
          // User is on 2FA page, just wait
          await this.page.waitForTimeout(checkInterval);
          continue;
        }
        
        // Check if we're on the Facebook home/feed (fully logged in)
        if (url.includes('facebook.com') && !url.includes('login')) {
          // Check for actual logged-in content without navigating
          const feedExists = await this.page.$('[role="feed"], [data-pagelet="Feed"], [aria-label="Your profile"], [aria-label="Home"]');
          const loginForm = await this.page.$('input[name="email"]');
          const twoFactorForm = await this.page.$('input[name="approvals_code"]');
          
          if (feedExists && !loginForm && !twoFactorForm) {
            log.success("Login verified!");
            await this.saveSession();
            return true;
          }
        }
      } catch (e) {
        // Ignore errors during check - page might be navigating
      }
      await this.page.waitForTimeout(checkInterval);
    }
    
    log.error("Login timeout");
    return false;
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    await this.saveSession();
    
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    
    log.info("Browser closed");
  }
}

/**
 * Create scraper instance from environment config
 */
export function createScraper(overrides?: Partial<ScraperConfig>): FacebookScraper {
  const config: ScraperConfig = {
    mode: (process.env.SCRAPE_MODE as "semi-manual" | "full-auto") || "semi-manual",
    sessionDir: process.env.SESSION_DIR || "./data/sessions",
    rawDir: process.env.RAW_DIR || "./data/raw",
    maxPostsPerSession: parseInt(process.env.MAX_POSTS_PER_SESSION || "100"),
    sessionBreakMinutes: parseInt(process.env.SESSION_BREAK_MINUTES || "30"),
    headless: process.env.HEADLESS === "true",
    ...overrides,  // Apply any overrides
  };

  // Build proxy URL if configured
  if (process.env.PROXY_URL) {
    config.proxyUrl = process.env.PROXY_URL;
  } else if (process.env.PROXY_HOST) {
    const user = process.env.PROXY_USER;
    const pass = process.env.PROXY_PASS;
    const host = process.env.PROXY_HOST;
    const port = process.env.PROXY_PORT || "10000";
    
    if (user && pass) {
      config.proxyUrl = `http://${user}:${pass}@${host}:${port}`;
    } else {
      config.proxyUrl = `http://${host}:${port}`;
    }
  }

  return new FacebookScraper(config);
}
