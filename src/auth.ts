/**
 * AISIS Authentication Module
 * Handles login and session management using Playwright
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright';
import type { AISISSession } from './types.js';

const BASE_URL = 'https://aisis.ateneo.edu/j_aisis';
const LOGIN_URL = `${BASE_URL}/displayLogin.do`;
const LOGIN_ACTION = `${BASE_URL}/login.do`;

export class AISISAuth {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private session: AISISSession | null = null;

  /**
   * Initialize browser and authenticate with AISIS
   */
  async login(username: string, password: string): Promise<AISISSession> {
    console.log('🔐 Authenticating with AISIS...');
    
    // Launch browser in headless mode
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });
    this.page = await this.context.newPage();
    
    // Increase default timeout for slow connections
    this.page.setDefaultTimeout(60000);

    // Navigate to login page with longer timeout
    try {
      await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForSelector('input[name="userName"]', { timeout: 30000 });
    } catch (err) {
      console.log('⚠️  Slow connection, retrying...');
      await this.page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 90000 });
    }

    // Extract the dynamic 'rnd' value from the form (runs in browser context)
    const rnd = await this.page.evaluate(() => {
      const input = document.querySelector('input[name="rnd"]');
      return (input as HTMLInputElement)?.value || '';
    });

    // Fill and submit login form
    await this.page.fill('input[name="userName"]', username);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('input[type="submit"]');

    // Wait for navigation after login
    await this.page.waitForLoadState('networkidle');

    // Check if login was successful (look for error message or successful navigation)
    const currentUrl = this.page.url();
    if (currentUrl.includes('displayLogin.do') || currentUrl.includes('login.do')) {
      const errorText = await this.page.textContent('body');
      if (errorText?.includes('Invalid') || errorText?.includes('Error')) {
        throw new Error('Login failed: Invalid credentials');
      }
    }

    // Extract cookies for session management
    const cookies = await this.context.cookies();
    const cookieMap: Record<string, string> = {};
    let jsessionid = '';

    for (const cookie of cookies) {
      cookieMap[cookie.name] = cookie.value;
      if (cookie.name === 'JSESSIONID') {
        jsessionid = cookie.value;
      }
    }

    // Also check URL for jsessionid (older Java apps append it)
    const jsessionMatch = currentUrl.match(/jsessionid=([^&?]+)/);
    if (jsessionMatch && !jsessionid) {
      jsessionid = jsessionMatch[1];
    }

    this.session = {
      jsessionid,
      cookies: cookieMap,
      rnd
    };

    console.log('✅ Authentication successful!');
    return this.session;
  }

  /**
   * Get the authenticated page for scraping
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('Not authenticated. Call login() first.');
    }
    return this.page;
  }

  /**
   * Get the browser context for creating new pages
   */
  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error('Not authenticated. Call login() first.');
    }
    return this.context;
  }

  /**
   * Get session info for HTTP requests
   */
  getSession(): AISISSession {
    if (!this.session) {
      throw new Error('Not authenticated. Call login() first.');
    }
    return this.session;
  }

  /**
   * Build cookie header string for fetch requests
   */
  getCookieHeader(): string {
    if (!this.session) {
      throw new Error('Not authenticated. Call login() first.');
    }
    return Object.entries(this.session.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      this.session = null;
    }
  }
}

// Export singleton instance
export const auth = new AISISAuth();
