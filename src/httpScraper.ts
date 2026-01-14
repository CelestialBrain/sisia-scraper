/**
 * HTTP-based Class Schedule Scraper
 * Uses pure HTTP requests with concurrent batching
 */

import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import type { HTTPSession } from './httpAuth.js';
import { httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import type { ClassSection, Department, ScheduleSlot } from './types.js';

interface ScheduleOptions {
  periods: { value: string; label: string }[];
  departments: Department[];
}

/**
 * Get schedule form options (periods and departments)
 */
export async function getScheduleOptionsHTTP(session: HTTPSession): Promise<ScheduleOptions> {
  console.log('📋 Fetching schedule options (HTTP)...');
  
  const html = await httpGet(AISIS_URLS.SCHEDULE, session);
  const $ = cheerio.load(html);
  
  // Extract periods
  const periods: { value: string; label: string }[] = [];
  $('select[name="applicablePeriod"] option').each((_, el) => {
    const value = $(el).attr('value');
    const label = $(el).text().trim();
    if (value && value !== '') {
      periods.push({ value, label });
    }
  });
  
  // Extract departments
  const departments: Department[] = [];
  $('select[name="deptCode"] option').each((_, el) => {
    const code = $(el).attr('value');
    const name = $(el).text().trim();
    if (code && code !== '' && code !== '**IE**') {
      departments.push({ code, name });
    }
    // Also include **IE** (all departments) but rename it
    if (code === '**IE**') {
      departments.push({ code, name: 'All Departments' });
    }
  });
  
  console.log(`  Found ${periods.length} periods, ${departments.length} departments`);
  return { periods, departments };
}

/**
 * Scrape class sections for a specific department
 * AISIS requires: 1) GET form page first, 2) POST to query
 */
export async function scrapeScheduleHTTP(
  session: HTTPSession,
  period: string,
  deptCode: string
): Promise<ClassSection[]> {
  // Step 1: GET the schedule page first to load form state
  // This is required - AISIS needs the form loaded before accepting POST
  await httpGet(AISIS_URLS.SCHEDULE, session);
  
  // Step 2: POST to get schedule results
  // CRITICAL: command must be 'displayResults' (not 'displaySearchForm')
  // This is what resetCommand() JavaScript function sets before submit
  const html = await httpPost(AISIS_URLS.SCHEDULE, session, {
    applicablePeriod: period,
    deptCode: deptCode,
    subjCode: 'ALL',  // ALL to get all subjects in department
    command: 'displayResults',  // NOT displaySearchForm!
  });
  
  return parseScheduleHTML(html, period, deptCode);
}

/**
 * Parse schedule HTML into class sections
 */
function parseScheduleHTML(html: string, term: string, department: string): ClassSection[] {
  const $ = cheerio.load(html);
  const sections: ClassSection[] = [];
  
  // Find the schedule table - look for table with schedule headers
  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text().toLowerCase();
    
    // Check if this looks like a schedule table
    if (!headerText.includes('subject') && !headerText.includes('section')) {
      return; // continue
    }
    
    // Parse rows (skip header)
    const rows = $(table).find('tr').slice(1);
    
    rows.each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 8) return;
      
      const cellTexts = cells.map((_, cell) => $(cell).text().trim()).get();
      
      // Expected columns: Subject Code | Section | Course Title | Units | Time/Days | Room | Instructor | Max | Lang | Level | Free | Remarks | S | P
      // But column order may vary, so we use pattern matching
      
      const subjectCode = cellTexts[0] || '';
      const sectionCode = cellTexts[1] || '';
      const courseTitle = cellTexts[2] || '';
      const units = parseInt(cellTexts[3]) || 0;
      const timeInfo = cellTexts[4] || '';
      const room = cellTexts[5] || '';
      const instructor = cellTexts[6] || '';
      const maxCapacity = parseInt(cellTexts[7]) || 0;
      const lang = cellTexts[8] || '';
      const level = cellTexts[9] || '';
      const freeSlots = parseInt(cellTexts[10]) || 0;
      const remarks = cellTexts[11] || '';
      
      // Skip empty rows
      if (!subjectCode || subjectCode.length < 2) return;
      
      // Parse schedule slots from time info
      const schedule = parseTimeSlots(timeInfo);
      
      const section: ClassSection = {
        id: `${term}-${subjectCode}-${sectionCode}`,
        subjectCode,
        section: sectionCode,
        courseTitle,
        units,
        schedule,
        instructor,
        maxCapacity,
        freeSlots,
        lang,
        level,
        remarks,
        hasPrerequisites: cellTexts.some(c => c.includes('P') || c.includes('prerequisite')),
        term,
        department,
        scrapedAt: new Date(),
      };
      
      sections.push(section);
    });
  });
  
  return sections;
}

/**
 * Parse time slot string into structured data
 * Examples: "MWF 08:30-10:00 SEC A 301 (FULLY ONSITE)"
 */
function parseTimeSlots(timeInfo: string): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  
  if (!timeInfo) return slots;
  
  // Pattern: days time room (modality)
  const pattern = /([MTWTHFSU]+)\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*([^(]*)\s*(\([^)]+\))?/gi;
  let match;
  
  while ((match = pattern.exec(timeInfo)) !== null) {
    const daysStr = match[1];
    const startTime = match[2];
    const endTime = match[3];
    const room = match[4]?.trim() || '';
    const modality = match[5]?.replace(/[()]/g, '') || 'ONSITE';
    
    // Expand days (M, T, W, TH, F, S)
    const days = expandDays(daysStr);
    
    for (const day of days) {
      slots.push({
        day,
        startTime,
        endTime,
        room,
        modality,
      });
    }
  }
  
  return slots;
}

/**
 * Expand day abbreviations (MWF -> ['Monday', 'Wednesday', 'Friday'])
 */
function expandDays(daysStr: string): string[] {
  const days: string[] = [];
  let i = 0;
  
  while (i < daysStr.length) {
    if (daysStr.substring(i, i + 2).toUpperCase() === 'TH') {
      days.push('Thursday');
      i += 2;
    } else if (daysStr.substring(i, i + 2).toUpperCase() === 'SU') {
      days.push('Sunday');
      i += 2;
    } else {
      const char = daysStr[i].toUpperCase();
      const dayMap: Record<string, string> = {
        'M': 'Monday',
        'T': 'Tuesday',
        'W': 'Wednesday',
        'F': 'Friday',
        'S': 'Saturday',
      };
      if (dayMap[char]) {
        days.push(dayMap[char]);
      }
      i++;
    }
  }
  
  return days;
}

/**
 * Scrape all departments with concurrent batching
 */
export async function scrapeAllSchedulesHTTP(
  session: HTTPSession,
  period: string,
  departments: Department[],
  options: {
    concurrency?: number;
    batchDelayMs?: number;
    onProgress?: (dept: string, count: number) => void;
  } = {}
): Promise<ClassSection[]> {
  const { 
    concurrency = 8, 
    batchDelayMs = 500,
    onProgress 
  } = options;
  
  const limit = pLimit(concurrency);
  const allSections: ClassSection[] = [];
  
  console.log(`\n📅 Scraping ${departments.length} departments (concurrency: ${concurrency})...\n`);
  
  const startTime = Date.now();
  
  const tasks = departments.map((dept, index) => 
    limit(async () => {
      try {
        const sections = await scrapeScheduleHTTP(session, period, dept.code);
        allSections.push(...sections);
        
        if (onProgress) {
          onProgress(dept.code, sections.length);
        } else {
          process.stdout.write(`  ${dept.code.padEnd(8)} ${sections.length} sections\n`);
        }
        
        // Add delay between batches (every concurrency requests)
        if ((index + 1) % concurrency === 0 && batchDelayMs > 0) {
          await new Promise(r => setTimeout(r, batchDelayMs));
        }
        
        return sections;
      } catch (err: any) {
        console.error(`  ⚠️ ${dept.code}: ${err.message}`);
        return [];
      }
    })
  );
  
  await Promise.all(tasks);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Scraped ${allSections.length} sections in ${elapsed}s`);
  
  return allSections;
}
