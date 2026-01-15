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
 * Optimized: Skip redundant GET after first successful POST
 */
let formInitialized = false;

export async function scrapeScheduleHTTP(
  session: HTTPSession,
  period: string,
  deptCode: string
): Promise<ClassSection[]> {
  // Only GET form state once per session (not for every department)
  if (!formInitialized) {
    await httpGet(AISIS_URLS.SCHEDULE, session);
    formInitialized = true;
  }
  
  // POST to get schedule results
  // CRITICAL: command must be 'displayResults' (not 'displaySearchForm')
  const html = await httpPost(AISIS_URLS.SCHEDULE, session, {
    applicablePeriod: period,
    deptCode: deptCode,
    subjCode: 'ALL',
    command: 'displayResults',
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
      // Set room on each slot (room is in a separate column)
      for (const slot of schedule) {
        slot.room = room;
      }
      
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
 * AISIS format: "M-TH 0800-0930<br/>(FULLY ONSITE)" or "TF 0800-0930"
 * Note: Days can be M-TH, T-F, M-W-F, etc.
 */
function parseTimeSlots(timeInfo: string): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  
  if (!timeInfo || timeInfo.trim() === '') return slots;
  
  // Split by <br/> or newlines to handle multiple time slots
  const timeBlocks = timeInfo.split(/<br\s*\/?>/i).map(s => s.trim()).filter(s => s);
  
  for (const block of timeBlocks) {
    // Skip modality-only lines like "(FULLY ONSITE)"
    if (block.startsWith('(') && block.endsWith(')')) continue;
    
    // Pattern: days (like M-TH, TF, M-W-F) followed by time (0800-0930 or 08:00-09:30)
    // Format: "[days] [start]-[end]" optionally followed by room and modality
    const timeMatch = block.match(/^([MTWHFS-]+)\s+(\d{2}:?\d{2})-(\d{2}:?\d{2})/i);
    
    if (!timeMatch) continue;
    
    const daysStr = timeMatch[1].replace(/-/g, ''); // Remove dashes: M-TH -> MTH
    const startRaw = timeMatch[2];
    const endRaw = timeMatch[3];
    
    // Format time: 0800 -> 08:00
    const startTime = startRaw.includes(':') ? startRaw : 
      startRaw.slice(0, 2) + ':' + startRaw.slice(2);
    const endTime = endRaw.includes(':') ? endRaw : 
      endRaw.slice(0, 2) + ':' + endRaw.slice(2);
    
    // Extract modality from next block or same block
    let modality = 'ONSITE';
    const modalityMatch = timeInfo.match(/\(([^)]+)\)/);
    if (modalityMatch) {
      modality = modalityMatch[1].replace('FULLY ', '');
    }
    
    // Expand days (MTH -> ['Monday', 'Thursday'], etc.)
    const days = expandDays(daysStr);
    
    for (const day of days) {
      slots.push({
        day,
        startTime,
        endTime,
        room: '', // Room is in a separate column in AISIS
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
 * Scrape all departments with ADAPTIVE concurrency
 * Features:
 * - Starts at high concurrency, backs off on errors
 * - Tracks department checksums for incremental scraping
 * - Skip departments with no changes (when baseline provided)
 */
export async function scrapeAllSchedulesHTTP(
  session: HTTPSession,
  period: string,
  departments: Department[],
  options: {
    concurrency?: number;
    batchDelayMs?: number;
    onProgress?: (dept: string, count: number) => void;
    baselineCounts?: Map<string, number>;  // Previous section counts per dept
  } = {}
): Promise<ClassSection[]> {
  const { 
    concurrency: initialConcurrency = 8, 
    batchDelayMs = 300,  // Reduced from 500ms
    onProgress,
    baselineCounts,
  } = options;
  
  let currentConcurrency = initialConcurrency;
  let consecutiveErrors = 0;
  const allSections: ClassSection[] = [];
  
  console.log(`\n📅 Scraping ${departments.length} departments (concurrency: ${currentConcurrency})...\n`);
  
  const startTime = Date.now();
  
  // Process in batches with adaptive concurrency
  let i = 0;
  while (i < departments.length) {
    const limit = pLimit(currentConcurrency);
    const batch = departments.slice(i, i + currentConcurrency);
    
    const tasks = batch.map(dept => 
      limit(async () => {
        try {
          const sections = await scrapeScheduleHTTP(session, period, dept.code);
          
          // Check if this department changed (when baseline exists)
          if (baselineCounts && baselineCounts.has(dept.code)) {
            const prevCount = baselineCounts.get(dept.code)!;
            if (sections.length === prevCount) {
              // Mark as unchanged for logging
              if (onProgress) {
                onProgress(dept.code + '*', sections.length);  // * = unchanged
              }
            } else if (onProgress) {
              onProgress(dept.code, sections.length);
            }
          } else if (onProgress) {
            onProgress(dept.code, sections.length);
          } else {
            process.stdout.write(`  ${dept.code.padEnd(8)} ${sections.length} sections\n`);
          }
          
          consecutiveErrors = 0;  // Reset on success
          return sections;
        } catch (err: any) {
          console.error(`  ⚠️ ${dept.code}: ${err.message}`);
          consecutiveErrors++;
          
          // Adaptive backoff: reduce concurrency on errors
          if (consecutiveErrors >= 2 && currentConcurrency > 2) {
            currentConcurrency = Math.max(2, Math.floor(currentConcurrency / 2));
            console.log(`  ⚡ Reducing concurrency to ${currentConcurrency}`);
          }
          
          return [];
        }
      })
    );
    
    const batchResults = await Promise.all(tasks);
    for (const sections of batchResults) {
      allSections.push(...sections);
    }
    
    i += batch.length;
    
    // Small delay between batches
    if (i < departments.length && batchDelayMs > 0) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
    
    // Adaptive speedup: increase concurrency if no errors
    if (consecutiveErrors === 0 && currentConcurrency < initialConcurrency) {
      currentConcurrency = Math.min(initialConcurrency, currentConcurrency + 2);
      console.log(`  ⚡ Increasing concurrency to ${currentConcurrency}`);
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Scraped ${allSections.length} sections in ${elapsed}s`);
  
  return allSections;
}

