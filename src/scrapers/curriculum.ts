/**
 * Curriculum Scraper (J_VOFC.do)
 * Scrapes official curriculum/flowchart for degree programs
 */

import * as cheerio from 'cheerio';
import type { Page } from 'playwright';
import type { Course, Curriculum, DegreeProgram } from '../types.js';
import { parsePrerequisites } from '../parsers/prerequisiteParser.js';
import { parseDegreeCode, formatDegreeInfo } from '../parsers/degreeCodeParser.js';

const VOFC_URL = 'https://aisis.ateneo.edu/j_aisis/J_VOFC.do';

/**
 * Get all available degree programs
 */
export async function getDegreePrograms(page: Page): Promise<DegreeProgram[]> {
  console.log('📋 Fetching degree programs...');
  
  await page.goto(VOFC_URL, { 
    waitUntil: 'domcontentloaded',
    timeout: 30000 
  });
  await page.waitForTimeout(1500);  // Wait for page to stabilize
  
  // Wait for dropdown to be available
  await page.waitForSelector('select[name="degCode"]', { timeout: 10000 });
  
  const html = await page.content();
  const $ = cheerio.load(html);
  
  const programs: DegreeProgram[] = [];
  $('select[name="degCode"] option').each((_, el) => {
    const code = $(el).attr('value');
    const name = $(el).text().trim();
    if (code && code !== '') {
      const parsed = parseDegreeCode(code, name);
      programs.push({
        code,
        name,
        isHonors: parsed.isHonors,
        track: parsed.track,
        specialization: parsed.specialization,
        year: parsed.year,
        semester: parsed.semester
      });
    }
  });
  
  console.log(`  Found ${programs.length} degree programs`);
  return programs;
}

/**
 * Scrape curriculum for a specific degree program
 * Uses retry logic to handle page navigation timing issues
 */
export async function scrapeCurriculum(
  page: Page,
  degCode: string,
  maxRetries: number = 3
): Promise<Curriculum> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Navigate to VOFC page
      await page.goto(VOFC_URL, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await page.waitForTimeout(1000);  // Wait for page to stabilize
      
      // Wait for the dropdown to be available
      await page.waitForSelector('select[name="degCode"]', { timeout: 10000 });
      
      // Select degree program
      await page.selectOption('select[name="degCode"]', degCode);
      
      // Wait for the page to update after selection
      await page.waitForTimeout(2000);
      
      // Wait for navigation to complete - try multiple strategies
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      } catch {
        // Ignore timeout, page may already be loaded
      }
      
      // Additional wait for page content to settle
      await page.waitForTimeout(1000);
      
      // Get the page HTML - wrap in try-catch for navigation race
      let html: string;
      try {
        html = await page.content();
      } catch (contentError) {
        // Wait and retry getting content
        await page.waitForTimeout(2000);
        html = await page.content();
      }
      
      // Extract degree name from dropdown
      const $ = cheerio.load(html);
      const degreeName = $(`select[name="degCode"] option[value="${degCode}"]`).text().trim();
      
      return parseCurriculumHTML(html, degCode, degreeName);
      
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        console.log(`  ⚠️  Retry ${attempt}/${maxRetries} for ${degCode}...`);
        await page.waitForTimeout(2000);
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error(`Failed to scrape curriculum for ${degCode}`);
}

/**
 * Parse curriculum HTML into structured data
 * Handles HTML bleeding issues by using text anchors
 */
export function parseCurriculumHTML(
  html: string,
  degreeCode: string,
  degreeName: string
): Curriculum {
  const $ = cheerio.load(html);
  const courses: Course[] = [];
  
  // Look for year/semester markers as anchors
  const yearMarkers = ['First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year'];
  const semMarkers = ['First Semester', 'Second Semester', 'Summer', 'Intersession'];
  
  let currentYear = 1;
  let currentSemester = 1;
  
  // Strategy: Find all tables and analyze their context
  // The curriculum is usually displayed in tables grouped by year/semester
  
  $('table').each((_, table) => {
    const tableHtml = $(table).html() || '';
    const tableText = $(table).text();
    
    // Check if this is a year header
    for (let i = 0; i < yearMarkers.length; i++) {
      if (tableText.includes(yearMarkers[i])) {
        currentYear = i + 1;
      }
    }
    
    // Check if this is a semester header
    for (let i = 0; i < semMarkers.length; i++) {
      if (tableText.includes(semMarkers[i])) {
        currentSemester = i === 3 ? 3 : i + 1; // Summer = 3, Intersession = 3
      }
    }
    
    // Check if this table has course data
    const rows = $(table).find('tr');
    const headerRow = rows.first().text().toLowerCase();
    
    // Skip if not a course table
    if (!headerRow.includes('cat') && !headerRow.includes('course') && !headerRow.includes('unit')) {
      return; // continue
    }
    
    // Parse course rows (skip header)
    rows.slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;
      
      // Try to identify columns by position and content
      // Common patterns: Cat No | Course Title | Units | Prerequisites | Category
      const cellTexts = cells.map((_, cell) => $(cell).text().trim()).get();
      
      // Find cat number (looks like "CS 121" or "ENGL 101")
      let catNo = '';
      let title = '';
      let units = 0;
      let prereqText = '';
      let category = '';
      
      for (let i = 0; i < cellTexts.length; i++) {
        const text = cellTexts[i];
        
        // Cat number: contains letters followed by space and numbers
        if (!catNo && /^[A-Z]{2,5}\s*\d{2,3}/i.test(text)) {
          catNo = text;
        }
        // Units: single digit or small number
        else if (!units && /^\d{1,2}$/.test(text) && parseInt(text) <= 12) {
          units = parseInt(text);
        }
        // Title: longer text without numbers at start
        else if (!title && text.length > 10 && !/^\d/.test(text)) {
          title = text;
        }
        // Prerequisites: contains course codes or "None"
        else if (!prereqText && (/[A-Z]{2,4}\s*\d{2,3}/i.test(text) || text.toLowerCase() === 'none')) {
          prereqText = text;
        }
        // Category: Major, Core, Elective, etc.
        else if (!category && /^(Major|Core|Elective|GE|Free)/i.test(text)) {
          category = text;
        }
      }
      
      // If we found a valid course
      if (catNo && (title || units > 0)) {
        const prereqResult = parsePrerequisites(prereqText);
        
        courses.push({
          catNo,
          title: title || catNo,
          units,
          prerequisites: prereqResult.courses,
          category: category || 'Unknown',
          year: currentYear,
          semester: currentSemester
        });
      }
    });
  });
  
  // Calculate total units
  const totalUnits = courses.reduce((sum, c) => sum + c.units, 0);
  
  return {
    degreeCode,
    degreeName,
    courses,
    totalUnits
  };
}
