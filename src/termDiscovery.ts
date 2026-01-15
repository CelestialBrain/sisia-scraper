/**
 * Term Discovery Module
 * Explores all possible term codes to find available schedule data
 */

import type { HTTPSession } from './httpAuth.js';
import { httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import * as cheerio from 'cheerio';

export interface TermInfo {
  code: string;       // "2025-2"
  label: string;      // "2025-2026-Second Semester"
  year: number;
  semester: number;
  isAvailable: boolean;
  sectionCount?: number;
}

/**
 * Generate all possible term codes for a year range
 * Term format: YYYY-S where S is 0 (summer), 1 (first), 2 (second)
 */
export function generateTermCodes(startYear: number, endYear: number): string[] {
  const codes: string[] = [];
  
  for (let year = startYear; year <= endYear; year++) {
    codes.push(`${year}-0`); // Intersession/Summer
    codes.push(`${year}-1`); // First Semester
    codes.push(`${year}-2`); // Second Semester
  }
  
  return codes;
}

/**
 * Get all listed term codes from the AISIS dropdown
 */
export async function getListedTerms(session: HTTPSession): Promise<TermInfo[]> {
  const html = await httpGet(AISIS_URLS.SCHEDULE, session);
  const $ = cheerio.load(html);
  
  const terms: TermInfo[] = [];
  $('select[name="applicablePeriod"] option').each((_, el) => {
    const code = $(el).attr('value');
    const label = $(el).text().trim();
    
    if (code && code !== '') {
      const [yearStr, semStr] = code.split('-');
      terms.push({
        code,
        label,
        year: parseInt(yearStr) || 0,
        semester: parseInt(semStr) || 0,
        isAvailable: true,
      });
    }
  });
  
  return terms;
}

/**
 * Probe a specific term code to check if it has data
 * Returns section count or -1 if term doesn't exist
 */
export async function probeTermCode(
  session: HTTPSession, 
  termCode: string,
  deptCode: string = '**IE**' // All departments
): Promise<number> {
  try {
    // GET the schedule page first
    await httpGet(AISIS_URLS.SCHEDULE, session);
    
    // POST with the term code
    const html = await httpPost(AISIS_URLS.SCHEDULE, session, {
      applicablePeriod: termCode,
      deptCode: deptCode,
      subjCode: 'ALL',
      command: 'displayResults',
    });
    
    const $ = cheerio.load(html);
    
    // Check for error messages
    if (html.includes('No records found') || html.includes('Invalid')) {
      return 0;
    }
    
    // Count rows in the schedule table
    let rowCount = 0;
    $('table').each((_, table) => {
      const headerText = $(table).find('tr').first().text().toLowerCase();
      if (headerText.includes('subject') || headerText.includes('section')) {
        rowCount = $(table).find('tr').length - 1; // Subtract header
      }
    });
    
    return rowCount;
  } catch (err) {
    return -1; // Error probing
  }
}

/**
 * Discover all available terms by probing a range
 */
export async function discoverAllTerms(
  session: HTTPSession,
  options: {
    startYear?: number;
    endYear?: number;
    onProgress?: (code: string, count: number) => void;
  } = {}
): Promise<TermInfo[]> {
  const { 
    startYear = 2015, 
    endYear = new Date().getFullYear() + 1,
    onProgress
  } = options;
  
  console.log(`\n🔍 Discovering terms from ${startYear} to ${endYear}...\n`);
  
  // First get listed terms
  const listedTerms = await getListedTerms(session);
  const listedCodes = new Set(listedTerms.map(t => t.code));
  
  console.log(`  Listed terms: ${listedTerms.length}`);
  listedTerms.forEach(t => console.log(`    ✅ ${t.code}: ${t.label}`));
  
  // Generate all possible codes
  const allCodes = generateTermCodes(startYear, endYear);
  const unlistedCodes = allCodes.filter(c => !listedCodes.has(c));
  
  console.log(`\n  Probing ${unlistedCodes.length} unlisted term codes...`);
  
  const discoveredTerms: TermInfo[] = [...listedTerms];
  
  // Probe unlisted codes
  for (const code of unlistedCodes) {
    const count = await probeTermCode(session, code);
    
    if (count > 0) {
      const [yearStr, semStr] = code.split('-');
      const term: TermInfo = {
        code,
        label: `${yearStr}-${parseInt(yearStr) + 1} ${semStr === '0' ? 'Summer' : semStr === '1' ? 'First' : 'Second'} Semester (HIDDEN)`,
        year: parseInt(yearStr),
        semester: parseInt(semStr),
        isAvailable: true,
        sectionCount: count,
      };
      
      discoveredTerms.push(term);
      console.log(`    🔓 FOUND: ${code} (${count} sections)`);
      
      if (onProgress) {
        onProgress(code, count);
      }
    }
    
    // Small delay to not overload server
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Sort by year and semester
  discoveredTerms.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.semester - a.semester;
  });
  
  console.log(`\n  Total available terms: ${discoveredTerms.length}`);
  
  return discoveredTerms;
}
