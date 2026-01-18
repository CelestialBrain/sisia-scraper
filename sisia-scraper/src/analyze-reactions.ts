/**
 * Facebook Reaction DOM Analysis Script
 * Analyzes the structure of reaction emoji elements
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SESSION_PATH = path.join(process.cwd(), "data", "sessions", "facebook-session.json");
// Post with known reactions (from user's screenshot)
const POST_URL = "https://www.facebook.com/groups/1568550996761154/posts/4093068340976061";

async function analyze() {
  console.log("🔍 Analyzing Facebook Reaction Elements...\n");
  
  let storageState = undefined;
  if (fs.existsSync(SESSION_PATH)) {
    storageState = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    console.log("✅ Loaded saved session\n");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ 
    storageState,
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();

  console.log("📄 Navigating to post...");
  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("\n🔎 ANALYZING REACTION ELEMENTS...\n");

  const analysis = await page.evaluate(() => {
    const results = {
      reactionAreas: [] as any[],
      imagesWithAlt: [] as any[],
      interestingElements: [] as any[],
      sampleReactionHtml: "",
    };

    // Find all elements that might contain reactions
    document.querySelectorAll('[role="article"]').forEach((article, articleIdx) => {
      // Look for reaction-related aria labels
      article.querySelectorAll('[aria-label*="reaction"], [aria-label*="like"], [aria-label*="love"]').forEach((el, i) => {
        results.reactionAreas.push({
          articleIdx,
          ariaLabel: el.getAttribute("aria-label"),
          tag: el.tagName.toLowerCase(),
          className: el.className?.substring(0, 80),
          childCount: el.childElementCount,
          // Get info about child elements
          children: Array.from(el.children).slice(0, 5).map(child => ({
            tag: child.tagName.toLowerCase(),
            ariaLabel: child.getAttribute("aria-label"),
            alt: (child as any).alt,
            src: (child as any).src?.substring(0, 100),
            className: child.className?.substring(0, 50),
          })),
          // Get the HTML structure (first 500 chars)
          innerHTML: el.innerHTML.substring(0, 500),
        });
      });

      // Look at all images in the article
      article.querySelectorAll("img").forEach((img, i) => {
        if (i < 10) {
          results.imagesWithAlt.push({
            articleIdx,
            alt: img.alt,
            src: img.src?.substring(0, 100),
            width: img.width,
            height: img.height,
            ariaLabel: img.getAttribute("aria-label"),
          });
        }
      });

      // Look for SVG or i elements (often used for icons)
      article.querySelectorAll("svg, i").forEach((el, i) => {
        if (i < 5) {
          results.interestingElements.push({
            articleIdx,
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute("aria-label"),
            className: el.className?.toString().substring(0, 80),
          });
        }
      });
    });

    // Get raw HTML of first reaction area
    const firstReaction = document.querySelector('[aria-label*="reaction"]');
    if (firstReaction) {
      results.sampleReactionHtml = firstReaction.outerHTML.substring(0, 1000);
    }

    return results;
  });

  console.log("📋 REACTION AREAS FOUND:", analysis.reactionAreas.length);
  analysis.reactionAreas.slice(0, 3).forEach((r, i) => {
    console.log(`\n  Reaction ${i} (in article ${r.articleIdx}):`);
    console.log(`    aria-label: ${r.ariaLabel}`);
    console.log(`    tag: <${r.tag}>, class: ${r.className?.substring(0, 50)}...`);
    console.log(`    children (${r.childCount}):`);
    r.children.forEach((c: any, j: number) => {
      console.log(`      ${j}: <${c.tag}> alt="${c.alt || 'none'}" aria="${c.ariaLabel || 'none'}"`);
      if (c.src) console.log(`         src: ${c.src.substring(0, 80)}...`);
    });
    console.log(`    innerHTML sample: ${r.innerHTML.substring(0, 200)}...`);
  });

  console.log("\n\n📋 IMAGES IN ARTICLES:");
  analysis.imagesWithAlt.slice(0, 10).forEach((img, i) => {
    console.log(`  ${i}: article ${img.articleIdx}, alt="${img.alt || 'none'}", ${img.width}x${img.height}`);
    if (img.src) console.log(`      src: ${img.src.substring(0, 80)}...`);
  });

  console.log("\n\n📋 SVG/ICON ELEMENTS:");
  analysis.interestingElements.slice(0, 10).forEach((el, i) => {
    console.log(`  ${i}: <${el.tag}> in article ${el.articleIdx}, aria="${el.ariaLabel || 'none'}"`);
  });

  console.log("\n\n📋 SAMPLE REACTION HTML:");
  console.log(analysis.sampleReactionHtml.substring(0, 800));

  console.log("\n\n✅ Analysis complete. Browser stays open for 30s.\n");
  await page.waitForTimeout(30000);
  await browser.close();
}

analyze().catch(console.error);
