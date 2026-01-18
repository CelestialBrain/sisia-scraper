/**
 * Debug script to find the scrollable element inside FB modal
 */

import { config } from "dotenv";
config();

import { chromium } from "playwright";
import { existsSync } from "fs";
import * as log from "./utils/logger.js";

const POST_URL = "https://www.facebook.com/groups/1568550996761154/permalink/2403994986550080/";
const SESSION_PATH = "./data/sessions/facebook-session.json";

async function debugScroll() {
  log.info("🔍 Starting scroll debug...");
  
  if (!existsSync(SESSION_PATH)) {
    log.error(`Session file not found: ${SESSION_PATH}`);
    return;
  }
  
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: SESSION_PATH,
  });
  
  const page = await context.newPage();
  
  log.info(`📍 Navigating to: ${POST_URL}`);
  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Find scrollable elements inside dialogs
  log.info("\n📊 Finding scrollable elements in modal...");
  const scrollableInfo = await page.evaluate(() => {
    const results: string[] = [];
    
    // Find all elements with overflow-y: auto or scroll
    const allElements = document.querySelectorAll('*');
    const scrollables: Array<{tag: string, id: string, classes: string, scrollHeight: number, clientHeight: number, style: string}> = [];
    
    allElements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        const tag = el.tagName.toLowerCase();
        const id = el.id || '';
        const classes = (el.className && typeof el.className === 'string') ? el.className.split(' ').slice(0, 3).join(' ') : '';
        
        scrollables.push({
          tag,
          id,
          classes,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          style: overflowY
        });
      }
    });
    
    // Filter to significant scrollables
    const significant = scrollables.filter(s => s.scrollHeight > 500);
    significant.forEach((s, i) => {
      results.push(`${i + 1}. <${s.tag}${s.id ? ` id="${s.id}"` : ''}${s.classes ? ` class="${s.classes}..."` : ''}>`);
      results.push(`   scrollHeight: ${s.scrollHeight}, clientHeight: ${s.clientHeight}`);
    });
    
    // Also check dialogs specifically
    const dialogs = document.querySelectorAll('[role="dialog"]');
    results.push(`\nDialogs found: ${dialogs.length}`);
    
    dialogs.forEach((dialog, i) => {
      const children = dialog.querySelectorAll('*');
      let maxScrollable: Element | null = null;
      let maxScrollHeight = 0;
      
      children.forEach((child) => {
        if (child.scrollHeight > child.clientHeight && child.scrollHeight > maxScrollHeight) {
          const style = window.getComputedStyle(child);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            maxScrollable = child;
            maxScrollHeight = child.scrollHeight;
          }
        }
      });
      
      if (maxScrollable) {
        results.push(`Dialog ${i + 1} has scrollable child: <${maxScrollable.tagName.toLowerCase()}> (scrollHeight: ${maxScrollHeight})`);
      }
    });
    
    return results;
  });
  
  scrollableInfo.forEach(line => console.log(line));
  
  // Count initial articles
  const initialCount = await page.locator('[role="article"]').count();
  log.info(`\n📊 Initial article count: ${initialCount}`);
  
  // Try to find and scroll the LAST comment to trigger lazy loading
  log.info("\n🔧 Trying to scroll last article into view...");
  
  for (let i = 0; i < 5; i++) {
    // Find all articles and scroll the last one into view
    const articleCount = await page.locator('[role="article"]').count();
    log.info(`   Iteration ${i + 1}: ${articleCount} articles`);
    
    if (articleCount > 0) {
      // Scroll the last visible article into view
      await page.evaluate(() => {
        const articles = document.querySelectorAll('[role="article"]');
        const lastArticle = articles[articles.length - 1];
        if (lastArticle) {
          lastArticle.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
    
    await page.waitForTimeout(2000);
  }
  
  const finalCount = await page.locator('[role="article"]').count();
  log.info(`\n📊 Final article count: ${finalCount} (started with ${initialCount})`);
  
  // Take screenshot
  await page.screenshot({ path: "./data/debug-scroll.png" });
  log.success("📸 Screenshot saved to ./data/debug-scroll.png");
  
  log.info("\n🔍 Browser open. Press Ctrl+C to close.");
  await page.waitForTimeout(60000);
  
  await browser.close();
}

debugScroll().catch(console.error);
