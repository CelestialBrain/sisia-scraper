/**
 * Debug script to analyze Facebook reaction popup structure
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SESSION_PATH = path.join(process.cwd(), "data", "sessions", "facebook-session.json");
const POST_URL = "https://www.facebook.com/groups/1568550996761154/posts/4246741172275443";

async function analyze() {
  console.log("🔍 Analyzing Reaction Popup Structure...\n");
  
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

  console.log("📄 Navigating to AGUILA post...");
  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Click on a reaction count to open the popup
  console.log("\n🔍 Looking for reaction buttons...");
  const reactionBtn = page.locator('[aria-label*="reactions; see who reacted"]').first();
  const btnExists = await reactionBtn.count();
  
  if (btnExists > 0) {
    console.log("✅ Found reaction button, clicking...");
    await reactionBtn.click();
    await page.waitForTimeout(2000);
    
    // Analyze the popup structure
    const analysis = await page.evaluate(() => {
      const result = {
        tabListCount: 0,
        tabs: [] as any[],
        dialogContent: "",
        allImgAlts: [] as string[],
        allSpanTexts: [] as string[],
        allIElements: [] as string[],
      };
      
      // Find tablists
      const tabLists = document.querySelectorAll('[role="tablist"]');
      result.tabListCount = tabLists.length;
      
      tabLists.forEach((tabList, tlIdx) => {
        const tabs = tabList.querySelectorAll('[role="tab"]');
        tabs.forEach((tab, tIdx) => {
          const tabInfo = {
            tabListIdx: tlIdx,
            tabIdx: tIdx,
            text: tab.textContent?.trim(),
            innerHTML: tab.innerHTML.substring(0, 200),
            images: [] as any[],
            svgs: 0,
            iElements: [] as string[],
          };
          
          // Look at images
          tab.querySelectorAll("img").forEach(img => {
            tabInfo.images.push({
              alt: img.alt,
              src: img.src?.substring(0, 80),
            });
          });
          
          // Look at SVGs
          tabInfo.svgs = tab.querySelectorAll("svg").length;
          
          // Look at i elements (font icons)
          tab.querySelectorAll("i").forEach(i => {
            tabInfo.iElements.push(i.className);
          });
          
          result.tabs.push(tabInfo);
        });
      });
      
      // Get all img alts in dialog
      document.querySelectorAll('[role="dialog"] img').forEach(img => {
        const alt = img.getAttribute("alt");
        if (alt) result.allImgAlts.push(alt);
      });
      
      // Get all short span texts
      document.querySelectorAll('[role="dialog"] span').forEach(span => {
        const text = span.textContent?.trim();
        if (text && text.length < 15 && text.length > 0) {
          result.allSpanTexts.push(text);
        }
      });
      
      return result;
    });
    
    console.log("\n📋 TABLIST ANALYSIS:");
    console.log(`  Found ${analysis.tabListCount} tablists`);
    
    console.log("\n📋 TABS:");
    analysis.tabs.forEach((tab, i) => {
      console.log(`\n  Tab ${i} (tablist ${tab.tabListIdx}):`);
      console.log(`    text: "${tab.text}"`);
      console.log(`    innerHTML: ${tab.innerHTML.substring(0, 100)}...`);
      console.log(`    images: ${JSON.stringify(tab.images)}`);
      console.log(`    svgs: ${tab.svgs}`);
      console.log(`    i elements: ${tab.iElements.join(", ")}`);
    });
    
    console.log("\n📋 ALL IMG ALTS IN DIALOG:");
    console.log("  " + analysis.allImgAlts.slice(0, 10).join(", "));
    
    console.log("\n📋 ALL SHORT SPAN TEXTS IN DIALOG (sample):");
    console.log("  " + [...new Set(analysis.allSpanTexts)].slice(0, 15).join(" | "));
  } else {
    console.log("❌ No reaction button found");
  }

  console.log("\n\n✅ Analysis complete. Browser stays open for 30s.\n");
  await page.waitForTimeout(30000);
  await browser.close();
}

analyze().catch(console.error);
