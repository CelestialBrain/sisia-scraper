/**
 * HTTP-based Curriculum Scraper
 * Uses pure HTTP requests to scrape official curriculum data
 */

import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import type { HTTPSession } from './httpAuth.js';
import { httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import type { DegreeProgram, CurriculumCourse } from './types.js';
import { parseDegreeCode } from './parsers/degreeCodeParser.js';

interface CurriculumOptions {
  degrees: DegreeProgram[];
}

/**
 * Get curriculum form options (degree programs)
 */
export async function getCurriculumOptionsHTTP(session: HTTPSession): Promise<CurriculumOptions> {
  console.log('📋 Fetching curriculum options (HTTP)...');
  
  const html = await httpGet(AISIS_URLS.CURRICULUM, session);
  const $ = cheerio.load(html);
  
  const degrees: DegreeProgram[] = [];
  $('select[name="degCode"] option').each((_, el) => {
    const code = $(el).attr('value');
    const name = $(el).text().trim();
    
    if (code && code !== '') {
      const parsed = parseDegreeCode(code);
      degrees.push({
        code,
        name,
        isHonors: parsed.isHonors,
        track: parsed.track,
        specialization: parsed.specialization,
        year: parsed.year,
        semester: parsed.semester,
      });
    }
  });
  
  console.log(`  Found ${degrees.length} degree programs`);
  return { degrees };
}

/**
 * Scrape curriculum for a specific degree program
 */
export async function scrapeCurriculumHTTP(
  session: HTTPSession,
  degCode: string
): Promise<CurriculumCourse[]> {
  // Step 1: GET the curriculum page first to load form state
  await httpGet(AISIS_URLS.CURRICULUM, session);
  
  // Step 2: POST to get curriculum results - 'display' command shows curriculum
  const html = await httpPost(AISIS_URLS.CURRICULUM, session, {
    degCode: degCode,
    command: 'display',  // 'display' shows curriculum, NOT 'displaySearchForm'
  });
  
  return parseCurriculumHTML(html, degCode);
}

/**
 * Parse curriculum HTML into courses
 */
function parseCurriculumHTML(html: string, degCode: string): CurriculumCourse[] {
  const $ = cheerio.load(html);
  const courses: CurriculumCourse[] = [];
  
  let currentYear = 0;
  let currentSemester = 0;
  
  // Find all year/semester headings and course tables
  $('table').each((_, table) => {
    // Check for year/semester header
    const headerText = $(table).text();
    
    // Look for year patterns like "FIRST YEAR", "SECOND YEAR", etc.
    const yearMatch = headerText.match(/(FIRST|SECOND|THIRD|FOURTH|FIFTH)\s*YEAR/i);
    if (yearMatch) {
      const yearMap: Record<string, number> = {
        'FIRST': 1, 'SECOND': 2, 'THIRD': 3, 'FOURTH': 4, 'FIFTH': 5
      };
      currentYear = yearMap[yearMatch[1].toUpperCase()] || 0;
    }
    
    // Look for semester patterns
    const semMatch = headerText.match(/(FIRST|SECOND|SUMMER)\s*SEMESTER/i);
    if (semMatch) {
      const semMap: Record<string, number> = {
        'FIRST': 1, 'SECOND': 2, 'SUMMER': 0
      };
      currentSemester = semMap[semMatch[1].toUpperCase()] || 0;
    }
    
    // Parse course rows
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;  // Need at least: code, title, units
      
      const cellTexts = cells.map((_, cell) => $(cell).text().trim()).get();
      
      const subjectCode = cellTexts[0] || '';
      const courseTitle = cellTexts[1] || '';
      const unitsStr = cellTexts[2] || '0';
      const units = parseFloat(unitsStr) || 0;
      const prerequisites = cellTexts.length >= 4 ? cellTexts[3] : '';
      const category = cellTexts.length >= 5 ? cellTexts[4] : '';
      
      // Skip header rows or empty rows
      if (!subjectCode || subjectCode.length < 2) return;
      // Skip known header patterns: "Cat No", "Course Title", "Units", etc.
      if (subjectCode.toLowerCase().includes('code') || 
          subjectCode.toLowerCase() === 'cat no' ||
          subjectCode.toLowerCase().includes('course')) return;
      // Skip if units column doesn't look like a number
      if (isNaN(parseFloat(unitsStr)) && unitsStr !== '') return;
      
      courses.push({
        degCode,
        subjectCode,
        courseTitle,
        units,
        prerequisites,
        category,
        year: currentYear,
        semester: currentSemester,
      });
    });
  });
  
  return courses;
}

/**
 * Scrape all curricula with concurrent batching
 * Uses onSave callback for incremental saving per degree program
 */
export async function scrapeAllCurriculaHTTP(
  session: HTTPSession,
  degrees: DegreeProgram[],
  options: {
    concurrency?: number;
    batchDelayMs?: number;
    onProgress?: (deg: string, count: number) => void;
    onSave?: (degree: DegreeProgram, courses: CurriculumCourse[]) => void;
  } = {}
): Promise<CurriculumCourse[]> {
  const { 
    concurrency = 4,  // Lower concurrency for curriculum (more complex pages)
    batchDelayMs = 500,
    onProgress,
    onSave 
  } = options;
  
  const limit = pLimit(concurrency);
  const allCourses: CurriculumCourse[] = [];
  
  console.log(`\n📚 Scraping ${degrees.length} curricula (concurrency: ${concurrency})...\n`);
  
  const startTime = Date.now();
  
  const tasks = degrees.map((deg, index) => 
    limit(async () => {
      try {
        const courses = await scrapeCurriculumHTTP(session, deg.code);
        allCourses.push(...courses);
        
        // Save immediately if callback provided (for normalized schema)
        if (onSave && courses.length > 0) {
          onSave(deg, courses);
        }
        
        if (onProgress) {
          onProgress(deg.code, courses.length);
        } else {
          const shortCode = deg.code.length > 20 ? deg.code.substring(0, 20) + '...' : deg.code;
          process.stdout.write(`  ${shortCode.padEnd(25)} ${courses.length} courses\n`);
        }
        
        // Add delay between batches
        if ((index + 1) % concurrency === 0 && batchDelayMs > 0) {
          await new Promise(r => setTimeout(r, batchDelayMs));
        }
        
        return courses;
      } catch (err: any) {
        console.error(`  ⚠️ ${deg.code}: ${err.message}`);
        return [];
      }
    })
  );
  
  await Promise.all(tasks);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Scraped ${allCourses.length} curriculum courses in ${elapsed}s`);
  
  return allCourses;
}
