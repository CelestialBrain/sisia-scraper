/**
 * Class Schedule Scraper (J_VCSC.do)
 * Scrapes all class sections from AISIS Schedule of Classes
 */

import * as cheerio from 'cheerio';
import type { Page } from 'playwright';
import type { ClassSection, ScheduleSlot, Department, AcademicPeriod } from '../types.js';

const VCSC_URL = 'https://aisis.ateneo.edu/j_aisis/J_VCSC.do';

/**
 * Get all available periods and departments from the schedule page
 */
export async function getScheduleOptions(page: Page): Promise<{
  periods: AcademicPeriod[];
  departments: Department[];
}> {
  console.log('📋 Fetching schedule options...');
  
  await page.goto(VCSC_URL, { waitUntil: 'networkidle' });
  
  const html = await page.content();
  const $ = cheerio.load(html);
  
  // Extract periods from applicablePeriod dropdown
  const periods: AcademicPeriod[] = [];
  $('select[name="applicablePeriod"] option').each((_, el) => {
    const value = $(el).attr('value');
    const label = $(el).text().trim();
    if (value && value !== '') {
      periods.push({ value, label });
    }
  });
  
  // Extract departments from deptCode dropdown
  const departments: Department[] = [];
  $('select[name="deptCode"] option').each((_, el) => {
    const code = $(el).attr('value');
    const name = $(el).text().trim();
    if (code && code !== '' && code !== '**') {
      departments.push({ code, name });
    }
  });
  
  console.log(`  Found ${periods.length} periods, ${departments.length} departments`);
  return { periods, departments };
}

/**
 * Scrape class sections for a specific department and period
 */
export async function scrapeClassSections(
  page: Page,
  period: string,
  deptCode: string
): Promise<ClassSection[]> {
  // Navigate and submit form with filters
  await page.goto(VCSC_URL, { waitUntil: 'networkidle' });
  
  // Select period
  await page.selectOption('select[name="applicablePeriod"]', period);
  await page.waitForLoadState('networkidle');
  
  // Select department
  await page.selectOption('select[name="deptCode"]', deptCode);
  await page.waitForLoadState('networkidle');
  
  // Click display button
  await page.click('input[type="submit"]');
  await page.waitForLoadState('networkidle');
  
  // Parse results
  const html = await page.content();
  return parseClassScheduleHTML(html, period, deptCode);
}

/**
 * Parse class schedule HTML into structured data
 */
export function parseClassScheduleHTML(
  html: string,
  term: string,
  department: string
): ClassSection[] {
  const $ = cheerio.load(html);
  const sections: ClassSection[] = [];
  
  // Find the results table (typically has headers like "Subject Code", "Section", etc.)
  const tables = $('table');
  let resultsTable: cheerio.Cheerio<cheerio.Element> | null = null;
  
  tables.each((_, table) => {
    const headerText = $(table).find('tr:first-child').text();
    if (headerText.includes('Subject') || headerText.includes('Section')) {
      resultsTable = $(table);
      return false; // Break
    }
  });
  
  if (!resultsTable) {
    return sections;
  }
  
  // Parse each row (skip header row)
  $(resultsTable).find('tr').slice(1).each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 8) return; // Skip incomplete rows
    
    const subjectCode = $(cells[0]).text().trim();
    const section = $(cells[1]).text().trim();
    const courseTitle = $(cells[2]).text().trim();
    const units = parseInt($(cells[3]).text().trim()) || 0;
    const timeText = $(cells[4]).text().trim();
    const room = $(cells[5]).text().trim();
    const instructor = $(cells[6]).text().trim();
    const maxCapacity = parseInt($(cells[7]).text().trim()) || 0;
    
    // Parse additional columns if present
    const lang = cells[8] ? $(cells[8]).text().trim() : '';
    const level = cells[9] ? $(cells[9]).text().trim() : '';
    const freeSlots = cells[10] ? parseInt($(cells[10]).text().trim()) || 0 : 0;
    const remarks = cells[11] ? $(cells[11]).text().trim() : '';
    
    // Check if has prerequisites (usually a "P" link)
    const hasPrerequisites = $(row).find('a[href*="prereq"]').length > 0 ||
                            $(row).text().includes('P');
    
    // Parse schedule
    const schedule = parseScheduleText(timeText, room);
    
    if (subjectCode && section) {
      sections.push({
        id: `${subjectCode}-${section}-${term}`,
        subjectCode,
        section,
        courseTitle,
        units,
        schedule,
        instructor,
        maxCapacity,
        freeSlots,
        lang,
        level,
        remarks,
        hasPrerequisites,
        term,
        department,
        scrapedAt: new Date()
      });
    }
  });
  
  return sections;
}

/**
 * Parse schedule text into structured slots
 * Examples:
 * - "MWF 08:30-10:00 FULLY ONSITE"
 * - "TTH 13:00-14:30 SEC A 301"
 * - "S 09:00-12:00 HYBRID"
 */
export function parseScheduleText(timeText: string, room: string): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  
  if (!timeText || timeText === 'TBA' || timeText === '') {
    return slots;
  }
  
  // Common modality keywords
  const modalities = ['FULLY ONSITE', 'FULLY ONLINE', 'HYBRID', 'ONSITE', 'ONLINE'];
  let modality = 'ONSITE'; // Default
  
  for (const mod of modalities) {
    if (timeText.toUpperCase().includes(mod)) {
      modality = mod;
      break;
    }
  }
  
  // Parse day-time combinations
  // Pattern: days followed by time range
  const dayTimeRegex = /([MTWTHFS]+)\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/gi;
  let match;
  
  while ((match = dayTimeRegex.exec(timeText)) !== null) {
    const daysStr = match[1].toUpperCase();
    const startTime = match[2];
    const endTime = match[3];
    
    // Split days (handle "TH" as Thursday)
    const days = parseDays(daysStr);
    
    for (const day of days) {
      slots.push({
        day,
        startTime,
        endTime,
        room: room || '',
        modality
      });
    }
  }
  
  return slots;
}

/**
 * Parse day string into individual days
 * "MWF" -> ["M", "W", "F"]
 * "TTH" -> ["T", "TH"]
 */
function parseDays(daysStr: string): string[] {
  const days: string[] = [];
  let i = 0;
  
  while (i < daysStr.length) {
    // Check for "TH" (Thursday)
    if (daysStr.substring(i, i + 2) === 'TH') {
      days.push('TH');
      i += 2;
    } else {
      days.push(daysStr[i]);
      i++;
    }
  }
  
  return days;
}
