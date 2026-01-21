/**
 * SISIA Scraper - CLI Entry Point
 * Manual browser-based Facebook group scraper for professor feedback
 */

import { config } from "dotenv";
import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";

// Load environment
config();

import * as log from "./utils/logger.js";
import { initDatabase, startSession, endSession, getDb, closeDatabase, getUnprocessedCaptures, markCaptureProcessed, savePost, saveFeedback, getTargetProfessors, logExtraction } from "./db/database.js";
import { createScraper, FacebookScraper } from "./browser/scraper.js";
import { parsePageCapture, calculateSentimentFromReactions } from "./parsers/postParser.js";
import { filterProfessorFeedback } from "./parsers/commentParser.js";
import { initProfessorMatcher, findProfessorsInText, Professor, generateSearchTerms, normalizeName } from "./matchers/professorMatcher.js";

const program = new Command();

program
  .name("sisia-scraper")
  .description("Facebook group scraper for Ateneo Profs to Pick professor feedback")
  .version("1.0.0");

// ============================================
// SCRAPE Command - Launch browser for scraping
// ============================================
program
  .command("scrape")
  .description("Launch browser for manual/semi-auto scraping")
  .option("-m, --mode <mode>", "Scraping mode: semi-manual or full-auto", "semi-manual")
  .option("-p, --professor <name>", "Search for specific professor")
  .option("--headless", "Run in headless mode")
  .action(async (options) => {
    log.info("Starting SISIA Scraper...");
    log.info(`Mode: ${options.mode}`);

    // Ensure data directories exist
    ["./data", "./data/sessions", "./data/exports", "./data/raw"].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    log.success("Database initialized");

    // Create and launch scraper
    const scraper = createScraper();
    await scraper.launch();

    // Start a scrape session
    const sessionId = startSession(options.mode);
    scraper.setSessionId(sessionId);
    log.info(`Session #${sessionId} started`);

    // Check login status
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      log.warn("Not logged into Facebook. Please log in manually...");
      const success = await scraper.waitForLogin(5);
      if (!success) {
        log.error("Login failed or timed out");
        await scraper.close();
        endSession(sessionId, "aborted");
        closeDatabase();
        return;
      }
    }

    log.success("Logged into Facebook!");

    // Navigate to group
    await scraper.goToGroup();

    if (options.professor) {
      // Search for specific professor
      await scraper.searchProfessor(options.professor);
    }

    // In semi-manual mode, provide instructions and wait
    if (options.mode === "semi-manual") {
      log.info("\n" + "=".repeat(50));
      log.info("SEMI-MANUAL MODE ACTIVE");
      log.info("=".repeat(50));
      log.info("The browser is now open. You can:");
      log.info("  1. Navigate to posts manually");
      log.info("  2. Search for professors in the group");
      log.info("  3. Scroll through content");
      log.info("\nPress Ctrl+C to stop and save session.");
      log.info("Raw HTML will be captured automatically.");
      log.info("=".repeat(50) + "\n");

      // Capture current page periodically
      let captureCount = 0;
      const captureInterval = setInterval(async () => {
        try {
          await scraper.captureCurrentPage();
          captureCount++;
          log.capture(`Auto-capture #${captureCount}`);
        } catch (e) {
          // Page might be navigating
        }
      }, 30000); // Capture every 30 seconds

      // Handle graceful shutdown
      process.on("SIGINT", async () => {
        log.info("\nShutting down...");
        clearInterval(captureInterval);
        await scraper.close();
        endSession(sessionId, "completed");
        closeDatabase();
        log.success(`Session #${sessionId} completed. Captured ${captureCount} pages.`);
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {}); // Wait forever until Ctrl+C
    } else {
      // Full-auto mode: iterate through target professors
      const professors = getTargetProfessors(20);
      log.info(`Found ${professors.length} target professors to search`);

      for (const prof of professors) {
        log.scrape(`Searching for: ${prof.name}`);
        await scraper.searchProfessor(prof.name);
        
        // Scroll and capture
        await scraper.scrollAndCapture(3);
        
        log.success(`Captured posts for ${prof.name}`);
      }

      await scraper.close();
      endSession(sessionId, "completed");
      closeDatabase();
      log.success("Scraping completed!");
    }
  });

// ============================================
// PROCESS Command - Parse captured HTML
// ============================================
program
  .command("process")
  .description("Process captured HTML files into structured data")
  .action(async () => {
    log.info("Processing captured HTML files...");

    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);

    // Load professors for matching
    const sisiaDbPath = process.env.SISIA_DB_PATH || "../chat/server/data/sisia.db";
    if (existsSync(sisiaDbPath)) {
      const professorList = loadProfessorsFromSisia(sisiaDbPath);
      initProfessorMatcher(professorList);
      log.success(`Loaded ${professorList.length} professors for matching`);
    } else {
      log.warn("SISIA database not found, professor matching disabled");
    }

    // Get unprocessed captures
    const captures = getUnprocessedCaptures();
    log.info(`Found ${captures.length} unprocessed captures`);

    let totalPosts = 0;
    let totalFeedback = 0;

    for (const capture of captures) {
      log.info(`Processing capture #${capture.id}...`);
      
      const posts = parsePageCapture(capture.html_content);
      
      for (const post of posts) {
        // Save post
        const postId = savePost({
          captureId: capture.id,
          postUrl: capture.url,
          authorType: post.authorType,
          content: post.content,
          postDate: post.date,
          normalizedDate: post.normalizedDate?.toISOString(),
        });
        totalPosts++;

        // Find professor mentions and save feedback
        const matches = findProfessorsInText(post.content);
        const sentiment = calculateSentimentFromReactions(post.reactions);

        for (const match of matches) {
          saveFeedback({
            postId,
            instructorId: match.instructorId,
            instructorNameScraped: match.matchedTerm,
            instructorNameMatched: match.instructorName,
            matchConfidence: match.confidence,
            feedbackText: post.content,
            feedbackType: "post",
            sentiment: sentiment.label,
          });
          totalFeedback++;
        }

        // Also process any professor mentions in comments
        for (const comment of post.comments) {
          const commentMatches = findProfessorsInText(comment.text);
          for (const match of commentMatches) {
            saveFeedback({
              postId,
              instructorId: match.instructorId,
              instructorNameScraped: match.matchedTerm,
              instructorNameMatched: match.instructorName,
              matchConfidence: match.confidence,
              feedbackText: comment.text,
              feedbackType: "comment",
              sentiment: sentiment.label,
            });
            totalFeedback++;
          }
        }
      }

      markCaptureProcessed(capture.id);
    }

    closeDatabase();
    log.success(`Processing complete! Posts: ${totalPosts}, Feedback entries: ${totalFeedback}`);
  });

// ============================================
// EXPORT Command - Export data to JSON/CSV
// ============================================
program
  .command("export")
  .description("Export professor feedback data to JSON or CSV")
  .option("-f, --format <format>", "Output format: json or csv", "json")
  .option("-p, --professor <name>", "Filter by professor name (optional)")
  .option("-o, --output <path>", "Output file path (optional)")
  .action(async (options: { format: string; professor?: string; output?: string }) => {
    log.info("Exporting professor feedback data...");
    
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    
    const db = getDb();
    
    // Build query - use professor_feedback directly (works without posts table constraint)
    let query = `
      SELECT 
        instructor_name_scraped as professor,
        instructor_name_matched as matched_name,
        feedback_text as comment,
        sentiment,
        reactions,
        reaction_types,
        source_url,
        scraped_at
      FROM professor_feedback
    `;
    
    const params: string[] = [];
    if (options.professor) {
      query += ` WHERE LOWER(instructor_name_scraped) LIKE ?`;
      params.push(`%${options.professor.toLowerCase()}%`);
    }
    
    query += ` ORDER BY instructor_name_scraped, scraped_at DESC`;
    
    const data = db.prepare(query).all(...params) as Record<string, unknown>[];
    
    if (data.length === 0) {
      log.warn("No data found to export");
      closeDatabase();
      return;
    }
    
    log.info(`Found ${data.length} records to export`);
    
    // Ensure export directory exists
    const exportDir = "./data/exports";
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
    
    const timestamp = new Date().toISOString().slice(0, 10);
    const profSuffix = options.professor ? `_${options.professor.replace(/[^a-zA-Z]/g, '')}` : "";
    
    let outputPath: string;
    let content: string;
    
    if (options.format === "csv") {
      outputPath = options.output || `${exportDir}/feedback${profSuffix}_${timestamp}.csv`;
      
      // Build CSV with proper escaping
      const headers = ["professor", "matched_name", "comment", "sentiment", "reactions", "reaction_types", "source_url", "scraped_at"];
      const rows = data.map((row) => 
        headers.map(h => {
          const val = String(row[h] || "");
          if (val.includes(",") || val.includes('"') || val.includes("\n")) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(",")
      );
      
      content = [headers.join(","), ...rows].join("\n");
      log.success(`Exported to CSV: ${outputPath}`);
    } else {
      outputPath = options.output || `${exportDir}/feedback${profSuffix}_${timestamp}.json`;
      content = JSON.stringify(data, null, 2);
      log.success(`Exported to JSON: ${outputPath}`);
    }
    
    writeFileSync(outputPath, content);
    log.info(`   Records: ${data.length}`);
    log.info(`   File size: ${(content.length / 1024).toFixed(1)} KB`);
    
    closeDatabase();
  });

// ============================================
// CAPTURE Command - Auto-capture on page navigation
// ============================================
program
  .command("capture")
  .description("Launch browser with AUTO-CAPTURE - comments saved automatically as you browse")
  .option("-p, --professor <name>", "Search term for professor")
  .option("-i, --interval <ms>", "Check interval in milliseconds", "5000")
  .action(async (options) => {
    log.info("Starting AUTO-CAPTURE mode...");

    // Ensure data directories exist
    ["./data", "./data/sessions", "./data/exports", "./data/raw"].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    log.success("Database initialized");

    // Create and launch scraper
    const scraper = createScraper();
    await scraper.launch();

    // Start a session
    const sessionId = startSession("semi-manual");
    scraper.setSessionId(sessionId);
    log.info(`Session #${sessionId} started`);

    // Check login
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      log.warn("Not logged into Facebook. Please log in manually...");
      const success = await scraper.waitForLogin(5);
      if (!success) {
        log.error("Login failed");
        await scraper.close();
        endSession(sessionId, "aborted");
        closeDatabase();
        return;
      }
    }

    log.success("Logged into Facebook!");
    await scraper.goToGroup();

    if (options.professor) {
      await scraper.searchProfessor(options.professor);
    }

    log.info("\n" + "=".repeat(50));
    log.info("🤖 AUTO-CAPTURE MODE ACTIVE");
    log.info("=".repeat(50));
    log.info("Just browse normally! Comments are captured automatically.");
    log.info("Navigate to search results or posts - data saves in background.");
    log.info("Press Ctrl+C to exit and save session.");
    log.info("=".repeat(50) + "\n");

    let totalCaptured = 0;
    let totalSaved = 0;
    let lastUrl = "";
    const capturedUrls = new Set<string>();
    const checkInterval = parseInt(options.interval) || 5000;

    // Track modal state to detect when user opens a post
    let wasModalOpen = false;
    
    // Auto-capture function
    const autoCapture = async () => {
      try {
        const page = scraper.getPage();
        if (!page) return;

        const currentUrl = page.url();
        const isModalOpen = await scraper.hasModalOpen();
        
        // Check if we're on a relevant page type
        const isSearchPage = currentUrl.includes("/search/?q=");
        const isPostPage = currentUrl.includes("/posts/") || 
                          currentUrl.includes("/permalink/") ||
                          currentUrl.match(/\/\d{10,}/) !== null;
        
        // Detect when modal just opened (transition from closed to open)
        const modalJustOpened = isModalOpen && !wasModalOpen;
        wasModalOpen = isModalOpen;
        
        // Generate capture key (URL + modal state)
        const captureKey = `${currentUrl}:${isModalOpen ? 'modal' : 'page'}`;
        
        // Capture if: URL changed OR modal just opened, and we haven't captured this
        const shouldCapture = (currentUrl !== lastUrl || modalJustOpened) 
                              && (isSearchPage || isPostPage || isModalOpen)
                              && !capturedUrls.has(captureKey);
        
        if (shouldCapture) {
          lastUrl = currentUrl;
          
          // Wait for content to load
          await page.waitForTimeout(2000);
          
          const displayUrl = currentUrl.length > 70 ? currentUrl.substring(0, 70) + "..." : currentUrl;
          log.info(`📸 Auto-capturing${isModalOpen ? ' (modal)' : ''}: ${displayUrl}`);
          
          try {
            // If modal is open, fully expand all comments
            if (isModalOpen) {
              log.info("🔄 Expanding all comments and replies...");
              // This will: 1) Switch to "All comments", 2) Click "View more comments", 3) Expand all replies
              const expandedCount = await scraper.expandAllComments();
              log.info(`   ↳ Expanded ${expandedCount} sections`);
              await page.waitForTimeout(1500);  // Wait for expanded content to render
            }
            
            // Extract comments
            const comments = await scraper.extractCommentsFromDOM();
            
            if (comments.length > 0) {
              const { bulkSaveDOMFeedback } = await import("./db/database.js");
              const searchTerm = new URL(currentUrl).searchParams.get("q") || "unknown";
              
              const savedCount = bulkSaveDOMFeedback(sessionId, currentUrl, searchTerm, comments);
              totalCaptured += comments.length;
              totalSaved += savedCount;
              capturedUrls.add(captureKey);
              
              log.success(`✅ Saved ${savedCount} comments (Total: ${totalSaved})`);
            } else {
              capturedUrls.add(captureKey);
              log.info(`📝 No comments found on this page`);
            }
          } catch (e) {
            log.debug("Capture error (may be normal during navigation)");
          }
        }
      } catch (e) {
        // Ignore errors during navigation
      }
    };

    // Start monitoring loop
    const monitorInterval = setInterval(autoCapture, checkInterval);

    // Handle shutdown
    process.on("SIGINT", async () => {
      log.info("\nShutting down...");
      clearInterval(monitorInterval);
      await scraper.close();
      endSession(sessionId, "completed");
      closeDatabase();
      log.success(`\n✅ Session complete!`);
      log.success(`   Pages captured: ${capturedUrls.size}`);
      log.success(`   Comments found: ${totalCaptured}`);
      log.success(`   Feedback saved: ${totalSaved}`);
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  });

// ============================================
// IMPORT-PROFESSORS Command - Load from SISIA
// ============================================
program
  .command("import-professors")
  .description("Import target professors from SISIA database")
  .option("-l, --limit <number>", "Maximum professors to import", "50")
  .action(async (options) => {
    log.info("Importing professors from SISIA database...");

    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);

    const sisiaDbPath = process.env.SISIA_DB_PATH || "../sisia.db";
    if (!existsSync(sisiaDbPath)) {
      log.error(`SISIA database not found at: ${sisiaDbPath}`);
      closeDatabase();
      return;
    }

    const sisiaDb = new Database(sisiaDbPath, { readonly: true });
    
    const limit = parseInt(options.limit);
    const rows = sisiaDb.prepare(`
      SELECT id, name FROM instructor
      ORDER BY RANDOM()
      LIMIT ?
    `).all(limit) as Array<{ id: number; name: string }>;

    sisiaDb.close();

    const db = getDb();
    let imported = 0;

    for (const row of rows) {
      const normalized = row.name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
      const searchTerms = generateSearchTerms(row.name);
      
      try {
        db.prepare(`
          INSERT OR REPLACE INTO target_professors 
          (instructor_id, name, name_normalized, search_terms, priority, active)
          VALUES (?, ?, ?, ?, ?, TRUE)
        `).run(row.id, row.name, normalized, JSON.stringify(searchTerms), 0);
        imported++;
      } catch (e) {
        log.warn(`Failed to import: ${row.name}`);
      }
    }

    closeDatabase();
    log.success(`Imported ${imported} professors from SISIA database`);
  });

// ============================================
// Helper: Load professors from SISIA database
// ============================================
function loadProfessorsFromSisia(dbPath: string): Professor[] {
  const sisiaDb = new Database(dbPath, { readonly: true });
  
  const rows = sisiaDb.prepare(`
    SELECT id, name FROM instructor
  `).all() as Array<{ id: number; name: string }>;

  sisiaDb.close();

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nameNormalized: normalizeName(row.name),
    searchTerms: generateSearchTerms(row.name),
  }));
}

// ============================================
// SCRAPE-AUTO Command - Full automation mode
// ============================================
program
  .command("scrape-auto")
  .description("FULL AUTOMATION: Search professor, process all posts, extract & save all comments")
  .argument("<professor>", "Professor name to search for")
  .option("-m, --max-posts <number>", "Maximum posts to process", "20")
  .option("-s, --scroll-count <number>", "Number of scrolls to load posts", "5")
  .option("--headless", "Run in headless mode (no visible browser window)")
  .option("--fast", "Fast mode: skip reaction popup parsing (saves ~70s on large posts)")
  .option("--block-images", "Block images/CSS for faster page loading")
  .option("--turbo", "TURBO mode: maximum speed (60% faster, reduces all wait times)")
  .action(async (professor: string, options: { maxPosts: string; scrollCount: string; headless?: boolean; fast?: boolean; blockImages?: boolean; turbo?: boolean }) => {
    log.info("Starting FULL AUTOMATION mode...");
    log.info(`Professor: ${professor}`);
    if (options.headless) log.info("Running in HEADLESS mode (background)");
    if (options.fast) log.info("Running in FAST mode (skipping reaction popups)");
    if (options.blockImages) log.info("Blocking images/CSS for faster loading");
    if (options.turbo) log.info("Running in TURBO mode (60% faster)");

    // Ensure data directories exist
    ["./data", "./data/sessions", "./data/exports", "./data/raw"].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    log.success("Database initialized");

    // Create and launch scraper with all options
    const scraper = createScraper({ 
      headless: options.headless,
      fastMode: options.fast,
      blockImages: options.blockImages,
      turboMode: options.turbo,
    });
    await scraper.launch();

    // Start a session
    const sessionId = startSession("full-auto");
    scraper.setSessionId(sessionId);
    log.info(`Session #${sessionId} started`);

    // Check login
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      log.warn("Not logged into Facebook. Please log in manually...");
      const success = await scraper.waitForLogin(5);
      if (!success) {
        log.error("Login failed");
        await scraper.close();
        endSession(sessionId, "aborted");
        closeDatabase();
        return;
      }
    }
    log.success("Logged into Facebook!");

    // Navigate to group
    await scraper.goToGroup();

    try {
      // Run full automation
      const result = await scraper.scrapeAllPostsFromSearch(professor, {
        maxPosts: parseInt(options.maxPosts, 10),
        scrollCount: parseInt(options.scrollCount, 10),
      });

      // End session with success
      endSession(sessionId, "completed");
      
      log.info("\n📊 FINAL RESULTS:");
      log.info(`   Posts processed: ${result.postsProcessed}`);
      log.info(`   Comments extracted: ${result.totalComments}`);
      log.info(`   Saved to database: ${result.totalSaved}`);
      
    } catch (error) {
      log.error(`Automation failed: ${error instanceof Error ? error.message : String(error)}`);
      endSession(sessionId, "aborted");
    }

    await scraper.close();
    closeDatabase();
    log.success("Automation complete!");
  });

// ============================================
// SCRAPE-URL Command - Scrape specific post by URL
// ============================================
program
  .command("scrape-url")
  .description("Scrape a specific Facebook post by URL - great for posts with many comments")
  .argument("<url>", "Direct URL to the Facebook post")
  .option("-p, --professor <name>", "Professor name to associate with this post")
  .option("--headless", "Run in headless mode (no visible browser window)")
  .option("--fast", "Fast mode: skip reaction popup parsing (saves ~70s on large posts)")
  .option("--block-images", "Block images/CSS for faster page loading")
  .option("--turbo", "TURBO mode: maximum speed (60% faster, reduces all wait times)")
  .action(async (url: string, options: { professor?: string; headless?: boolean; fast?: boolean; blockImages?: boolean; turbo?: boolean }) => {
    log.info("Starting DIRECT URL scrape mode...");
    log.info(`URL: ${url}`);
    if (options.professor) log.info(`Professor: ${options.professor}`);
    if (options.headless) log.info("Running in HEADLESS mode (background)");
    if (options.fast) log.info("Running in FAST mode (skipping reaction popups)");
    if (options.blockImages) log.info("Blocking images/CSS for faster loading");
    if (options.turbo) log.info("Running in TURBO mode (60% faster)");

    // Ensure data directories exist
    ["./data", "./data/sessions", "./data/exports", "./data/raw"].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    log.success("Database initialized");

    // Create and launch scraper with all options
    const scraper = createScraper({ 
      headless: options.headless,
      fastMode: options.fast,
      blockImages: options.blockImages,
      turboMode: options.turbo,
    });
    await scraper.launch();

    // Start a session
    const sessionId = startSession("direct-url");
    scraper.setSessionId(sessionId);
    log.info(`Session #${sessionId} started`);

    // Check login
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      log.warn("Not logged into Facebook. Please log in manually...");
      const success = await scraper.waitForLogin(5);
      if (!success) {
        log.error("Login failed");
        await scraper.close();
        endSession(sessionId, "aborted");
        closeDatabase();
        return;
      }
    }
    log.success("Logged into Facebook!");

    try {
      // Run direct URL scrape
      const result = await scraper.scrapePostByUrl(url, options.professor);

      // End session with success
      endSession(sessionId, "completed");
      
      log.info("\n📊 FINAL RESULTS:");
      log.info(`   Comments extracted: ${result.commentsExtracted}`);
      log.info(`   Saved to database: ${result.feedbackSaved}`);
      log.info(`   Post reactions: ${result.postReactions} (${result.postReactionTypes?.join(", ") || "none"})`);
      
    } catch (error) {
      log.error(`URL scrape failed: ${error instanceof Error ? error.message : String(error)}`);
      endSession(sessionId, "aborted");
    }

    await scraper.close();
    closeDatabase();
    log.success("URL scrape complete!");
  });

// ============================================
// SCRAPE-BATCH Command - Batch scrape multiple professors in one session
// ============================================
program
  .command("scrape-batch")
  .description("Batch scrape multiple professors in a single browser session (most efficient)")
  .argument("<professors...>", "Professor names to search for")
  .option("-m, --max-posts <number>", "Maximum posts to process per professor", "10")
  .option("-s, --scroll-count <number>", "Number of scrolls to load posts", "5")
  .option("--visible", "Show browser window (for login/debugging, headless is default)")
  .option("--fast", "Fast mode: skip reaction popup parsing")
  .option("--block-images", "Block images/CSS for faster page loading")
  .option("--turbo", "TURBO mode: maximum speed (60% faster, reduces all wait times)")
  .option("--resume", "Resume from previous progress (skips already completed professors)")
  .option("-c, --concurrency <number>", "Number of parallel workers (default: 1)", "1")
  .action(async (professors: string[], options: { maxPosts: string; scrollCount: string; visible?: boolean; fast?: boolean; blockImages?: boolean; turbo?: boolean; resume?: boolean; concurrency: string }) => {
    log.info("Starting BATCH SCRAPE mode...");
    log.info(`Professors to scrape: ${professors.length}`);
    professors.forEach((p, i) => log.info(`   ${i + 1}. ${p}`));
    if (!options.visible) log.info("Running in HEADLESS mode (background)");
    if (options.visible) log.info("Running in VISIBLE mode (browser window shown)");
    if (options.fast) log.info("Running in FAST mode (skipping reaction popups)");
    if (options.blockImages) log.info("Blocking images/CSS for faster loading");
    if (options.turbo) log.info("Running in TURBO mode (60% faster)");
    if (options.resume) log.info("Running with RESUME enabled (skipping completed profs)");
    const concurrency = parseInt(options.concurrency, 10) || 1;
    if (concurrency > 1) log.info(`Running with ${concurrency} parallel workers`);

    // Ensure data directories exist
    ["./data", "./data/sessions", "./data/exports", "./data/raw"].forEach(dir => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    });

    // Progress file for resume support
    const progressPath = "./data/batch_progress.json";
    let completedProfessors: string[] = [];
    
    // Load previous progress if resume mode
    if (options.resume && existsSync(progressPath)) {
      try {
        const progress = JSON.parse(readFileSync(progressPath, "utf-8"));
        completedProfessors = progress.completed || [];
        log.info(`Resuming: ${completedProfessors.length} professors already completed`);
      } catch {
        log.warn("Could not read progress file, starting fresh");
      }
    }
    
    // Filter out already completed professors
    const remainingProfessors = professors.filter(p => !completedProfessors.includes(p.toLowerCase()));
    if (remainingProfessors.length < professors.length) {
      log.info(`Skipping ${professors.length - remainingProfessors.length} already completed professors`);
    }
    
    if (remainingProfessors.length === 0) {
      log.success("All professors already completed! Use without --resume to re-scrape.");
      return;
    }

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/scraper.db";
    initDatabase(dbPath);
    log.success("Database initialized");

    // Create and launch scraper ONCE for all professors
    // headless is now the default, --visible flag opts out
    const scraper = createScraper({ 
      headless: !options.visible,  // headless unless --visible flag
      fastMode: options.fast,
      blockImages: options.blockImages,
      turboMode: options.turbo,
    });
    await scraper.launch();

    // Start a single session for batch
    const sessionId = startSession("full-auto");
    scraper.setSessionId(sessionId);
    log.info(`Session #${sessionId} started (batch mode)`);

    // Check login once
    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      log.warn("Not logged into Facebook. Please log in manually...");
      log.info("TIP: Use --visible flag to see the browser window for login");
      const success = await scraper.waitForLogin(10);
      if (!success) {
        log.error("Login failed");
        await scraper.close();
        endSession(sessionId, "aborted");
        closeDatabase();
        return;
      }
    }
    log.success("Logged into Facebook!");

    // Navigate to group once
    await scraper.goToGroup();

    let totalProfessors = 0;
    let totalComments = 0;
    let totalSaved = 0;

    // Concurrent scraping logic
    if (concurrency > 1) {
      log.info(`\n🚀 CONCURRENT MODE: ${concurrency} workers`);
      
      // Create worker function
      const processWorker = async (professorQueue: string[], workerId: number): Promise<{ comments: number; saved: number }> => {
        let workerComments = 0;
        let workerSaved = 0;
        
        for (const professor of professorQueue) {
          log.info(`[Worker ${workerId}] Processing: ${professor}`);
          try {
            const result = await scraper.scrapeAllPostsFromSearch(professor, {
              maxPosts: parseInt(options.maxPosts, 10),
              scrollCount: parseInt(options.scrollCount, 10),
            });
            workerComments += result.totalComments;
            workerSaved += result.totalSaved;
            
            // Save progress
            completedProfessors.push(professor.toLowerCase());
            writeFileSync(progressPath, JSON.stringify({ 
              completed: completedProfessors,
              lastUpdated: new Date().toISOString(),
            }));
          } catch (err) {
            log.error(`[Worker ${workerId}] Error with ${professor}: ${err}`);
          }
        }
        
        return { comments: workerComments, saved: workerSaved };
      };

      // Distribute professors across workers (round-robin)
      const workerQueues: string[][] = Array.from({ length: concurrency }, () => []);
      remainingProfessors.forEach((prof, idx) => {
        workerQueues[idx % concurrency].push(prof);
      });

      // HYBRID: Parallel search, then sequential extraction
      log.info(`Creating ${concurrency} parallel browser pages for search...`);
      
      const workerPages = await Promise.all(
        Array.from({ length: concurrency }, async (_, i) => {
          const page = await scraper.createWorkerPage();
          log.info(`   Worker ${i + 1} ready`);
          return page;
        })
      );
      
      log.info(`\n🔍 PHASE 1: Parallel URL discovery with ${concurrency} workers...`);
      
      // Phase 1: Parallel URL collection
      const urlPromises = workerQueues.map(async (queue, workerId) => {
        const page = workerPages[workerId];
        const results: Array<{ professorName: string; postUrls: string[] }> = [];
        
        for (const professor of queue) {
          try {
            await page.waitForTimeout(workerId * 500); // Stagger requests
            
            const result = await scraper.collectPostUrls(page, professor, {
              maxPosts: parseInt(options.maxPosts, 10),
              scrollCount: parseInt(options.scrollCount, 10),
              workerId: workerId + 1,
            });
            
            results.push(result);
          } catch (err) {
            log.error(`[W${workerId + 1}] Error searching ${professor}: ${err}`);
            results.push({ professorName: professor, postUrls: [] });
          }
        }
        
        return results;
      });
      
      // Wait for all searches to complete
      const allSearchResults = await Promise.all(urlPromises);
      
      // Close worker pages
      for (const page of workerPages) {
        await page.close();
      }
      
      // Flatten and count URLs
      const allProfessorUrls = allSearchResults.flat();
      const totalUrls = allProfessorUrls.reduce((sum, p) => sum + p.postUrls.length, 0);
      
      log.info(`\n📋 Found ${totalUrls} total posts across ${allProfessorUrls.length} professors`);
      log.info(`\n📝 PHASE 2: Sequential extraction (using full extraction logic)...`);
      
      // Phase 2: Sequential extraction using the proven scrapeAllPostsFromSearch
      for (const { professorName, postUrls: _ } of allProfessorUrls) {
        log.info(`\n${"=".repeat(50)}`);
        log.info(`📖 Processing: ${professorName}`);
        log.info(`${"=".repeat(50)}`);
        
        try {
          // Use the full, proven extraction method
          const result = await scraper.scrapeAllPostsFromSearch(professorName, {
            maxPosts: parseInt(options.maxPosts, 10),
            scrollCount: parseInt(options.scrollCount, 10),
          });
          
          totalProfessors++;
          totalComments += result.totalComments;
          totalSaved += result.totalSaved;
          
          completedProfessors.push(professorName.toLowerCase());
          writeFileSync(progressPath, JSON.stringify({ 
            completed: completedProfessors,
            lastUpdated: new Date().toISOString(),
          }));
          
          log.success(`✅ Completed: ${result.totalSaved} comments saved`);
        } catch (err) {
          log.error(`Error with ${professorName}: ${err}`);
        }
      }
      
      log.info(`\n🏁 Hybrid scraping completed!`);
    } else {
      // Sequential processing (original logic)
      for (const professor of remainingProfessors) {
        log.info(`\n${"=".repeat(50)}`);
        log.info(`📖 Processing professor ${totalProfessors + 1}/${remainingProfessors.length}: ${professor}`);
        log.info(`${"=".repeat(50)}`);

        try {
          const result = await scraper.scrapeAllPostsFromSearch(professor, {
            maxPosts: parseInt(options.maxPosts, 10),
            scrollCount: parseInt(options.scrollCount, 10),
          });
          
          totalProfessors++;
          totalComments += result.totalComments;
          totalSaved += result.totalSaved;
          
          // Save progress after each successful professor
          completedProfessors.push(professor.toLowerCase());
          writeFileSync(progressPath, JSON.stringify({ 
            completed: completedProfessors,
            lastUpdated: new Date().toISOString(),
            totalProcessed: totalProfessors,
          }, null, 2));
          
          log.success(`   ✅ Completed: ${result.totalSaved} comments saved`);
        } catch (error) {
          log.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }  // End of else block (sequential processing)

    // Final summary
    endSession(sessionId, "completed");

    log.info("\n" + "=".repeat(50));
    log.info("📊 BATCH SCRAPE COMPLETE");
    log.info("=".repeat(50));
    log.info(`   Professors processed: ${totalProfessors}/${remainingProfessors.length}`);
    log.info(`   Total comments extracted: ${totalComments}`);
    log.info(`   Total saved to DB: ${totalSaved}`);

    // Clear progress file on full completion
    if (existsSync(progressPath)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(progressPath);
      log.info("   Progress file cleared");
    }

    await scraper.close();
    closeDatabase();
    log.success("Batch scrape complete!");
  });

// ============================================
// SCRAPE-ALL Command - Auto-scrape all professors from SISIA database
// ============================================
program
  .command("scrape-all")
  .description("Auto-scrape ALL professors from SISIA database (uses scrape-batch internally)")
  .option("-l, --limit <number>", "Limit number of professors to scrape", "50")
  .option("-m, --max-posts <number>", "Maximum posts to process per professor", "5")
  .option("-s, --scroll-count <number>", "Number of scrolls to load posts", "3")
  .option("--visible", "Show browser window (for login/debugging, headless is default)")
  .option("--fast", "Fast mode: skip reaction popup parsing")
  .option("--block-images", "Block images/CSS for faster page loading")
  .option("--turbo", "TURBO mode: maximum speed (60% faster)")
  .option("--resume", "Resume from previous progress")
  .action(async (options: { limit: string; maxPosts: string; scrollCount: string; visible?: boolean; fast?: boolean; blockImages?: boolean; turbo?: boolean; resume?: boolean }) => {
    log.info("Loading professors from SISIA database...");
    
    // Load professors from SISIA DB
    const sisiaDbPath = process.env.SISIA_DB_PATH || "../chat/server/data/sisia.db";
    if (!existsSync(sisiaDbPath)) {
      log.error(`SISIA database not found at: ${sisiaDbPath}`);
      log.info("Set SISIA_DB_PATH environment variable to the correct path");
      return;
    }
    
    const sisiaDb = new Database(sisiaDbPath);
    const limit = parseInt(options.limit, 10);
    
    // Get professors with name, sorted by last name
    const professors = sisiaDb.prepare(`
      SELECT DISTINCT 
        UPPER(last_name) || ', ' || first_name as search_name
      FROM instructors 
      WHERE last_name IS NOT NULL AND first_name IS NOT NULL
        AND length(last_name) > 1
      ORDER BY last_name
      LIMIT ?
    `).all(limit) as { search_name: string }[];
    
    sisiaDb.close();
    
    log.info(`Found ${professors.length} professors to scrape`);
    
    if (professors.length === 0) {
      log.warn("No professors found in database");
      return;
    }
    
    const professorNames = professors.map(p => p.search_name);
    
    // Log first few
    log.info("Sample professors:");
    professorNames.slice(0, 5).forEach((p, i) => log.info(`   ${i + 1}. ${p}`));
    if (professorNames.length > 5) {
      log.info(`   ... and ${professorNames.length - 5} more`);
    }
    
    // Use the batch scrape logic (delegating to programmatic call)
    log.info("\nStarting batch scrape...");
    
    // Construct command args and call scrape-batch
    const args = [
      "scrape-batch",
      ...professorNames,
      "--max-posts", options.maxPosts,
      "--scroll-count", options.scrollCount,
    ];
    
    if (options.visible) args.push("--visible");
    if (options.fast) args.push("--fast");
    if (options.blockImages) args.push("--block-images");
    if (options.turbo) args.push("--turbo");
    if (options.resume) args.push("--resume");
    
    // Re-invoke the program with these args
    program.parse(["node", "index.ts", ...args]);
  });

// Run CLI
program.parse();
