/**
 * Facebook DOM Analysis Script v3
 * Navigates directly to a specific post and analyzes modal structure
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SESSION_PATH = path.join(process.cwd(), "data", "sessions", "facebook-session.json");
// Use a direct post URL that we know exists
const POST_URL = "https://www.facebook.com/groups/1568550996761154/posts/430770663284556";

async function analyze() {
  console.log("🔍 Starting Facebook DOM analysis v3...\n");
  
  // Load session
  let storageState = undefined;
  if (fs.existsSync(SESSION_PATH)) {
    storageState = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    console.log("✅ Loaded saved session\n");
  } else {
    console.log("⚠️ No session file found - will need to log in manually\n");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ 
    storageState,
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();

  // Navigate directly to a post
  console.log("📄 Navigating directly to post...");
  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);

  console.log("\n🔎 ANALYZING PAGE STRUCTURE...\n");

  // Comprehensive DOM analysis
  const analysis = await page.evaluate(() => {
    const results = {
      dialogs: [] as any[],
      filterElements: [] as any[],
      viewMoreButtons: [] as any[],
      viewRepliesButtons: [] as any[],
      allClickableTexts: [] as string[],
    };

    // Find all dialogs
    document.querySelectorAll('[role="dialog"]').forEach((dialog, i) => {
      const dialogTexts: string[] = [];
      dialog.querySelectorAll("span").forEach((span) => {
        const text = span.textContent?.trim() || "";
        if (text.length > 3 && text.length < 60) {
          dialogTexts.push(text);
        }
      });
      
      results.dialogs.push({
        index: i,
        ariaLabel: dialog.getAttribute("aria-label"),
        hasArticles: dialog.querySelectorAll('[role="article"]').length,
        sampleTexts: dialogTexts.slice(0, 15),
      });
    });

    // Find filter-related elements (look more broadly)
    document.querySelectorAll("span, div").forEach((el) => {
      const text = el.textContent?.trim() || "";
      
      // Filter dropdown - exact matches
      if (text === "Most relevant" || text === "All comments" || text === "Newest") {
        const parent = el.parentElement;
        const grandparent = parent?.parentElement;
        results.filterElements.push({
          text,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          parentTag: parent?.tagName.toLowerCase(),
          parentRole: parent?.getAttribute("role"),
          gpTag: grandparent?.tagName.toLowerCase(),
          gpRole: grandparent?.getAttribute("role"),
          ariaHaspopup: el.getAttribute("aria-haspopup") || parent?.getAttribute("aria-haspopup"),
        });
      }

      // View more comments - partial match
      if (text.toLowerCase().includes("view more comment") || 
          text.toLowerCase().includes("view previous comment")) {
        results.viewMoreButtons.push({
          text: text.substring(0, 40),
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || el.parentElement?.getAttribute("role"),
        });
      }

      // View all replies - regex match
      if (text.match(/View all \d+ repl/i) || text.match(/View \d+ repl/i) || text.match(/View \d+ more repl/i)) {
        results.viewRepliesButtons.push({
          text: text.substring(0, 40),
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          parentRole: el.parentElement?.getAttribute("role"),
        });
      }
    });

    // Collect all clickable-looking texts
    document.querySelectorAll('[role="button"], span').forEach((el) => {
      const text = el.textContent?.trim() || "";
      if (text.length > 3 && text.length < 40 && 
          (text.includes("View") || text.includes("comment") || text.includes("repl"))) {
        results.allClickableTexts.push(text);
      }
    });
    results.allClickableTexts = [...new Set(results.allClickableTexts)].slice(0, 20);

    return results;
  });

  console.log("📋 DIALOGS FOUND:", analysis.dialogs.length);
  analysis.dialogs.forEach((d, i) => {
    console.log(`\n  Dialog ${i}: ${d.ariaLabel || 'no label'}`);
    console.log(`    Articles: ${d.hasArticles}`);
    console.log(`    Sample texts: ${d.sampleTexts.slice(0, 5).join(", ")}`);
  });

  console.log("\n\n📋 FILTER ELEMENTS:");
  if (analysis.filterElements.length === 0) {
    console.log("  ⚠️ None found!");
  } else {
    analysis.filterElements.forEach((f) => {
      console.log(`  "${f.text}" - <${f.tag}> role=${f.role}, parent=<${f.parentTag}> role=${f.parentRole}`);
    });
  }

  console.log("\n📋 VIEW MORE COMMENTS BUTTONS:");
  if (analysis.viewMoreButtons.length === 0) {
    console.log("  ⚠️ None found!");
  } else {
    analysis.viewMoreButtons.forEach((b) => console.log(`  "${b.text}" - <${b.tag}> role=${b.role}`));
  }

  console.log("\n📋 VIEW REPLIES BUTTONS:");
  if (analysis.viewRepliesButtons.length === 0) {
    console.log("  ⚠️ None found!");
  } else {
    analysis.viewRepliesButtons.forEach((b) => console.log(`  "${b.text}" - <${b.tag}> role=${b.role}`));
  }

  console.log("\n📋 ALL CLICKABLE TEXTS (sample):");
  console.log("  " + analysis.allClickableTexts.join("\n  "));

  // Test and click filter
  console.log("\n\n🎯 TESTING SELECTORS AND CLICKING...\n");

  // Try to find and click the filter
  const filterSelectors = [
    'span:text-is("Most relevant")',
    'div:text-is("Most relevant")',
    'text="Most relevant"',
    '[aria-haspopup] >> text=Most relevant',
  ];

  for (const selector of filterSelectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`✅ Found filter with: ${selector} (${count} elements)`);
        console.log("   Clicking...");
        await page.locator(selector).first().click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        
        // Check if All comments appeared
        const allComments = await page.locator('text="All comments"').count();
        console.log(`   'All comments' visible: ${allComments > 0}`);
        
        if (allComments > 0) {
          console.log("   Clicking 'All comments'...");
          await page.locator('text="All comments"').first().click({ timeout: 5000 });
          await page.waitForTimeout(2000);
          console.log("   ✅ Successfully switched filter!");
        }
        break;
      }
    } catch (e: any) {
      console.log(`❌ ${selector}: ${e.message?.substring(0, 60)}`);
    }
  }

  // Try to find and click View all replies
  console.log("\n🔍 Looking for 'View all X replies'...");
  const replySelectors = [
    'span:text-matches("View all \\\\d+ repl", "i")',
    'text=/View all \\d+ repl/i',
    'span >> text=/View all \\d+/',
  ];

  for (const selector of replySelectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) {
        const text = await page.locator(selector).first().textContent();
        console.log(`✅ Found: "${text}" with selector: ${selector}`);
        console.log("   Clicking...");
        await page.locator(selector).first().click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        console.log("   ✅ Clicked reply expansion!");
        break;
      }
    } catch (e: any) {
      console.log(`❌ ${selector}: ${e.message?.substring(0, 60)}`);
    }
  }

  console.log("\n\n✅ Analysis complete. Browser stays open for 30s for manual inspection.\n");
  await page.waitForTimeout(30000);
  await browser.close();
}

analyze().catch(console.error);
