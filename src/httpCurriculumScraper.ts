/**
 * HTTP-based Curriculum Scraper (V4 - Year Detection Fixed)
 * 
 * AISIS Layout:
 * - Year headings are in <td class="text06"> with colspan="3" (e.g., "First Year")
 * - Semester tables are nested inside the following row
 * - Each semester is its own table with 5 columns
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

const YEAR_MAP: Record<string, number> = {
  'FIRST': 1, 'SECOND': 2, 'THIRD': 3, 'FOURTH': 4, 'FIFTH': 5
};

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
  await httpGet(AISIS_URLS.CURRICULUM, session);
  
  const html = await httpPost(AISIS_URLS.CURRICULUM, session, {
    degCode: degCode,
    command: 'display',
  });
  
  return parseCurriculumHTML(html, degCode);
}

/**
 * Parse curriculum HTML into courses (V4 - Year Detection Fixed)
 */
function parseCurriculumHTML(html: string, degCode: string): CurriculumCourse[] {
  const $ = cheerio.load(html);
  const courses: CurriculumCourse[] = [];
  
  // Check if this is graduate (no year structure) or undergraduate
  const hasYearHeaders = /FIRST\s*YEAR|SECOND\s*YEAR/i.test(html);
  
  if (!hasYearHeaders) {
    return parseGraduateCurriculum($, degCode);
  }
  
  // ===== NEW APPROACH: Traverse DOM in order, tracking year context =====
  let currentYear = 0;
  let currentSemester = 1;
  
  // Get all elements in document order
  $('td, th, table').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const tagName = el.tagName.toLowerCase();
    
    // Check for year heading (td.text06 with year text)
    if (tagName === 'td') {
      const className = $el.attr('class') || '';
      
      // Year headings are in td.text06 or have specific patterns
      if (className.includes('text06') || $el.attr('colspan')) {
        for (const [yearName, yearNum] of Object.entries(YEAR_MAP)) {
          const regex = new RegExp(`^${yearName}\\s*YEAR$`, 'i');
          if (regex.test(text)) {
            currentYear = yearNum;
            currentSemester = 1; // Reset semester when year changes
          }
        }
      }
      
      // Check for semester header in first row of table
      if (text.match(/^First\s*Semester/i)) {
        currentSemester = 1;
      } else if (text.match(/^Second\s*Semester/i)) {
        currentSemester = 2;
      } else if (text.match(/^Intersession/i)) {
        currentSemester = 0;
      }
    }
    
    // Process course tables (5 columns with Cat No)
    if (tagName === 'table') {
      const tableText = $el.text();
      if (!tableText.includes('Cat No')) return;
      if (tableText.includes('Select a degree') || tableText.includes('sign out')) return;
      
      // Detect semester from table header
      if (tableText.match(/First\s*Semester/i)) {
        currentSemester = 1;
      } else if (tableText.match(/Second\s*Semester/i)) {
        currentSemester = 2;
      } else if (tableText.match(/Intersession/i)) {
        currentSemester = 0;
      }
      
      $el.find('tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length !== 5) return;
        
        const cellTexts = cells.map((_, c) => $(c).text().trim()).get();
        const course = parseCourseRow(cellTexts, degCode, currentYear, currentSemester);
        if (course) courses.push(course);
      });
    }
  });
  
  return courses;
}

/**
 * Parse a single row of course data
 */
function parseCourseRow(
  cells: string[], 
  degCode: string, 
  year: number, 
  semester: number
): CurriculumCourse | null {
  const subjectCode = cells[0];
  const courseTitle = cells[1];
  const unitsStr = cells[2];
  const prerequisites = cells[3];
  const category = cells[4];
  
  // Skip header rows
  if (subjectCode.toLowerCase() === 'cat no') return null;
  if (subjectCode.toLowerCase().includes('course')) return null;
  
  // Skip empty or garbage
  if (!subjectCode || subjectCode.length < 2) return null;
  if (subjectCode.includes('home') || 
      subjectCode.includes('sign out') ||
      subjectCode.includes('Copyright') ||
      subjectCode.includes('Ateneo') ||
      subjectCode.includes('Terms') ||
      subjectCode.includes('Privacy')) return null;
  
  // Parse units
  const units = parseFloat(unitsStr) || 0;
  
  return {
    degCode,
    subjectCode,
    courseTitle,
    units,
    prerequisites,
    category,
    year,
    semester,
  };
}

/**
 * Parse graduate curriculum (flat list, no year/semester)
 */
function parseGraduateCurriculum($: cheerio.CheerioAPI, degCode: string): CurriculumCourse[] {
  const courses: CurriculumCourse[] = [];
  
  $('table').each((_, table) => {
    const tableText = $(table).text();
    if (!tableText.includes('Cat No')) return;
    if (tableText.includes('Select a degree') || tableText.includes('sign out')) return;
    
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td, th');
      if (cells.length !== 5) return;
      
      const cellTexts = cells.map((_, c) => $(c).text().trim()).get();
      const course = parseCourseRow(cellTexts, degCode, 0, 0);
      if (course) courses.push(course);
    });
  });
  
  return courses;
}

/**
 * Scrape all curricula with concurrent batching
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
    concurrency = 4,
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
        
        if (onSave && courses.length > 0) {
          onSave(deg, courses);
        }
        
        if (onProgress) {
          onProgress(deg.code, courses.length);
        } else {
          const shortCode = deg.code.length > 20 ? deg.code.substring(0, 20) + '...' : deg.code;
          process.stdout.write(`  ${shortCode.padEnd(25)} ${courses.length} courses\n`);
        }
        
        if ((index + 1) % concurrency === 0 && batchDelayMs > 0) {
          await new Promise(r => setTimeout(r, batchDelayMs));
        }
        
        return courses;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`  ⚠️ ${deg.code}: ${message}`);
        return [];
      }
    })
  );
  
  await Promise.all(tasks);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Scraped ${allCourses.length} curriculum courses in ${elapsed}s`);
  
  return allCourses;
}
