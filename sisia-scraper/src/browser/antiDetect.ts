/**
 * Anti-detection utilities for human-like browser behavior
 */

import type { Page } from "playwright";
import { randomDelay, microDelay } from "../utils/delay.js";
import * as log from "../utils/logger.js";

/**
 * Collection of user agents to rotate through
 */
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

/**
 * Get a random user agent
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Simulate human-like mouse movement
 */
export async function humanMouseMove(page: Page, x: number, y: number): Promise<void> {
  // Add some jitter to the target
  const jitterX = x + (Math.random() - 0.5) * 10;
  const jitterY = y + (Math.random() - 0.5) * 10;
  
  // Move with some steps for natural feel
  await page.mouse.move(jitterX, jitterY, { steps: Math.floor(Math.random() * 5) + 3 });
  await microDelay();
}

/**
 * Human-like click with random offset
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  const element = await page.$(selector);
  if (!element) {
    log.warn(`Element not found: ${selector}`);
    return;
  }
  
  const box = await element.boundingBox();
  if (!box) return;
  
  // Click at random position within element
  const x = box.x + Math.random() * box.width;
  const y = box.y + Math.random() * box.height;
  
  await humanMouseMove(page, x, y);
  await microDelay();
  await page.mouse.click(x, y);
}

/**
 * Human-like scroll behavior
 */
export async function humanScroll(page: Page, distance: number = 300): Promise<void> {
  // Random scroll speed
  const speed = 50 + Math.random() * 100;
  const steps = Math.ceil(distance / speed);
  
  for (let i = 0; i < steps; i++) {
    const scrollAmount = speed + (Math.random() - 0.5) * 30;
    await page.mouse.wheel(0, scrollAmount);
    await randomDelay(50, 150);
  }
}

/**
 * Slow scroll to load content (for infinite scroll pages)
 */
export async function slowScroll(page: Page, scrolls: number = 5): Promise<number> {
  let totalScrolled = 0;
  
  for (let i = 0; i < scrolls; i++) {
    const distance = 200 + Math.random() * 200;
    await humanScroll(page, distance);
    totalScrolled += distance;
    
    // Random pause between scrolls
    await randomDelay(1000, 3000);
    
    // Occasionally take a longer break (reading simulation)
    if (Math.random() < 0.2) {
      log.debug("Taking reading break...");
      await randomDelay(5000, 15000);
    }
  }
  
  return totalScrolled;
}

/**
 * TURBO scroll - fast scrolling without reading breaks
 * Optimized for speed while still loading content
 */
export async function turboScroll(page: Page, scrolls: number = 5): Promise<number> {
  let totalScrolled = 0;
  
  for (let i = 0; i < scrolls; i++) {
    // Larger scroll distance for faster coverage
    await page.evaluate(() => window.scrollBy(0, 600));
    totalScrolled += 600;
    
    // Minimal wait - just enough for content to load
    await page.waitForTimeout(400);
  }
  
  return totalScrolled;
}

/**
 * Type text with human-like delays between keystrokes
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await microDelay();
  
  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
    
    // Occasionally pause longer (thinking)
    if (Math.random() < 0.05) {
      await randomDelay(200, 500);
    }
  }
}

/**
 * Check if we should take a session break
 */
export function shouldTakeBreak(
  startTime: Date,
  postsScraped: number,
  maxPosts: number = 100,
  breakMinutes: number = 30
): { shouldBreak: boolean; reason: string } {
  const elapsedMinutes = (Date.now() - startTime.getTime()) / 1000 / 60;
  
  if (postsScraped >= maxPosts) {
    return { shouldBreak: true, reason: `Reached max posts limit (${maxPosts})` };
  }
  
  if (elapsedMinutes >= breakMinutes) {
    return { shouldBreak: true, reason: `Session time limit reached (${breakMinutes} min)` };
  }
  
  return { shouldBreak: false, reason: "" };
}

/**
 * Add random behavior patterns to seem more human
 */
export async function randomBehavior(page: Page): Promise<void> {
  const action = Math.random();
  
  if (action < 0.1) {
    // Occasionally move mouse to random position
    const x = Math.random() * 800 + 100;
    const y = Math.random() * 600 + 100;
    await humanMouseMove(page, x, y);
  } else if (action < 0.15) {
    // Occasionally scroll up a bit
    await page.mouse.wheel(0, -100 - Math.random() * 100);
  }
  
  await microDelay();
}
