/**
 * Personal IPS Scraper
 * 
 * Scrapes user's Individual Plan of Study from J_VIPS.do
 * 
 * AISIS Structure (based on actual page analysis):
 * - Summary table: Total Units | Units Taken | Remaining Units
 * - Nested tables by Year (First Year, Second Year, etc.) and Semester
 * - Columns: Status | Category No | Units | Category | Required? | Override Prerequisite?
 * - Status uses single-letter links (P, C, N) with title attribute for full status
 */

import * as cheerio from 'cheerio';
import { Element } from 'domhandler';
import { loginToAISIS } from './aisisSession.js';

export interface IPSCourse {
  course_code: string;
  title: string;
  units: number;
  status: 'passed' | 'credited' | 'not_taken' | 'in_progress' | 'failed';
  status_code: string;
  year: number;
  semester: number;
  required: boolean;
}

export interface IPSSummary {
  total_units: number;
  units_taken: number;
  remaining_units: number;
}

export interface IPSResult {
  program: string;
  student_name: string;
  year_level?: number;  // 1, 2, 3, 4, 5
  summary: IPSSummary;
  courses: IPSCourse[];
  courses_by_year: Record<number, Record<number, IPSCourse[]>>;
  progress_percentage: number;
}

const STATUS_MAP: Record<string, IPSCourse['status']> = {
  'P': 'passed',
  'C': 'credited',
  'N': 'not_taken',
  'IP': 'in_progress',
  'F': 'failed',
};

/**
 * Scrape IPS from AISIS
 */
export async function scrapePersonalIPS(
  username: string,
  password: string
): Promise<IPSResult> {
  const session = await loginToAISIS(username, password);
  
  // Try to fetch the welcome page first for program info (not available on J_VIPS.do)
  // This is optional - if it fails, we still proceed with IPS scraping
  let program = 'Unknown Program';
  let yearLevel = '';
  
  try {
    const welcomeResponse = await session.fetch('https://aisis.ateneo.edu/j_aisis/welcome.do');
    const welcomeHtml = await welcomeResponse.text();
    const $welcome = cheerio.load(welcomeHtml);
    
    // Extract program info from welcome page header
    // HTML: <span class="text05">Degree: </span><span class="text04">BS ME (Version 1, 2025)</span>
    
    // Look for labels and get their immediately following text04 span
    // HTML structure: <span class="text05">Degree: </span><span class="text04">BS ME (Version 1, 2025)</span>
    $welcome('span.text05').each((_, el) => {
      const $label = $welcome(el);
      const labelText = $label.text().trim();
      
      if (labelText.includes('Degree')) {
        // Get the immediately next sibling text04 span (not all siblings)
        const $nextSpan = $label.nextAll('span.text04').first();
        if ($nextSpan.length) {
          const text = $nextSpan.text().trim().replace(/\s+/g, ' ');
          console.log(`[IPS Scraper] Found Degree value: "${text}"`);
          if (text && !text.includes('Semester') && !text.includes('SY ')) {
            program = text;
            console.log(`[IPS Scraper] Using degree: "${program}"`);
          }
        }
      }
      
      if (labelText.includes('Year Level')) {
        // Get the immediately next sibling text04 span
        const $nextSpan = $label.nextAll('span.text04').first();
        if ($nextSpan.length) {
          const text = $nextSpan.text().trim();
          console.log(`[IPS Scraper] Found Year Level value: "${text}"`);
          if (text.match(/^\d+$/)) {
            yearLevel = text;
          }
        }
      }
    });
    
    // Cleanup program name
    program = program.replace(/\s+/g, ' ').trim();
    console.log(`[IPS Scraper] Extracted from welcome page: program="${program}", yearLevel="${yearLevel}"`);
  } catch (welcomeError: any) {
    console.warn(`[IPS Scraper] Could not fetch welcome page for program info: ${welcomeError.message}`);
    // Continue without program info - it's optional
  }
  
  // Now fetch the IPS page for curriculum data
  const response = await session.fetch('https://aisis.ateneo.edu/j_aisis/J_VIPS.do');
  const html = await response.text();
  
  const $ = cheerio.load(html);
  
  // Extract student info from header
  const studentNameText = $('span.text04').last().text().trim();
  
  // Parse summary table (Total Units, Units Taken, Remaining Units)
  // AISIS uses horizontal format:
  // Row 1: | Total Units | Units Taken | Remaining Units |
  // Row 2: | 189         | 23          | 166             |
  const summary: IPSSummary = {
    total_units: 0,
    units_taken: 0,
    remaining_units: 0,
  };
  
  $('table').each((_, table) => {
    const $table = $(table);
    const text = $table.text();
    
    if (text.includes('Total Units') && text.includes('Units Taken') && text.includes('Remaining')) {
      const rows = $table.find('tr');
      
      // Find the header row and data row
      let headerRowEl: Element | null = null;
      let dataRowEl: Element | null = null;
      
      rows.each((i, row) => {
        const rowText = $(row).text();
        if (rowText.includes('Total Units') && rowText.includes('Units Taken')) {
          headerRowEl = row as Element;
          // Data row is the next row
          if (i + 1 < rows.length) {
            dataRowEl = rows[i + 1] as Element;
          }
        }
      });
      
      if (headerRowEl && dataRowEl) {
        // Parse header to find column positions
        const headerCells = $(headerRowEl).find('td, th');
        const dataCells = $(dataRowEl).find('td, th');
        
        headerCells.each((idx: number, cell) => {
          const headerText = $(cell).text().trim().toLowerCase();
          const value = parseFloat($(dataCells[idx]).text().trim()) || 0;
          
          if (headerText.includes('total units') && !headerText.includes('taken') && !headerText.includes('remaining')) {
            summary.total_units = value;
          } else if (headerText.includes('units taken')) {
            summary.units_taken = value;
          } else if (headerText.includes('remaining')) {
            summary.remaining_units = value;
          }
        });
      }
    }
  });
  
  console.log(`[IPS Scraper] Parsed summary: Total=${summary.total_units}, Taken=${summary.units_taken}, Remaining=${summary.remaining_units}`);
  
  const courses: IPSCourse[] = [];
  
  // AISIS IPS Structure (confirmed from DOM analysis):
  // - Course tables are nested inside <td> elements that contain the semester label
  // - The semester label is the FIRST LINE of the parent <td> element's text
  // - Year headers are in previous sibling rows
  //
  // Correct table-to-semester mapping:
  // Table 1: Year 1, Semester 1 (first course: ENLIT 12)
  // Table 2: Year 1, Semester 2 (first course: ENGL 11)
  // Table 3: Year 2, Intersession (first course: ArtAp 10)
  // Table 4: Year 2, Semester 1 (first course: FLC 11)
  // Table 5: Year 2, Semester 2 (first course: ECON 110)
  // etc.
  
  // Find all course tables (leaf tables with Status/Category header)
  const courseTables: { table: Element; year: number; semester: number }[] = [];
  
  $('table').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text();
    
    // Check if this is a course table (has Status and Category columns)
    if (!tableText.includes('Status') || !tableText.includes('Category')) {
      return;
    }
    
    // Skip if this is the summary table
    if (tableText.includes('Total Units') && tableText.includes('Units Taken')) {
      return;
    }
    
    // Skip if this table contains other tables (not a leaf table)
    if ($table.find('table').length > 0) {
      return;
    }
    
    // Find semester and year from DOM structure
    // SEMESTER: The semester label ('First Semester', 'Intersession', etc.) is the FIRST text content
    //           of the parent <td> that wraps this table
    // YEAR: The year label ('First Year', etc.) is in a previous sibling <tr> as you walk up
    let semester = 1;
    let year = 1;
    let foundSemester = false;
    let foundYear = false;
    
    // Walk up to find the parent TD that contains the semester label
    let parent = $table.parent();
    for (let depth = 0; depth < 15 && parent.length > 0; depth++) {
      const tagName = parent.prop('tagName')?.toLowerCase();
      
      if (tagName === 'td' && !foundSemester) {
        // Get the text content of THIS td, trimmed and first line/segment
        // The semester label appears at the start of the td's text content
        const tdText = parent.text().trim();
        const firstLine = tdText.split('\n')[0].trim();
        
        // Check if first line starts with semester indicators
        if (firstLine.match(/^Intersession/i)) {
          semester = 0;
          foundSemester = true;
        } else if (firstLine.match(/^First Semester/i)) {
          semester = 1;
          foundSemester = true;
        } else if (firstLine.match(/^Second Semester/i)) {
          semester = 2;
          foundSemester = true;
        }
        // Also check the td has text04 class which indicates semester header
        const tdClass = parent.attr('class') || '';
        if (!foundSemester && tdClass.includes('text04')) {
          if (tdText.match(/Intersession/i)) { semester = 0; foundSemester = true; }
          else if (tdText.match(/First Semester/i)) { semester = 1; foundSemester = true; }
          else if (tdText.match(/Second Semester/i)) { semester = 2; foundSemester = true; }
        }
      }
      
      // Check for TR siblings that contain year labels (td.text06)
      if ((tagName === 'tr' || tagName === 'tbody' || tagName === 'table') && !foundYear) {
        let prevSib = parent.prev();
        while (prevSib.length > 0 && !foundYear) {
          // Check if this sibling contains a year header (td.text06)
          const yearTd = prevSib.find('td.text06');
          if (yearTd.length > 0) {
            const yearText = yearTd.text().trim();
            if (yearText.match(/First Year/i)) { year = 1; foundYear = true; }
            else if (yearText.match(/Second Year/i)) { year = 2; foundYear = true; }
            else if (yearText.match(/Third Year/i)) { year = 3; foundYear = true; }
            else if (yearText.match(/Fourth Year/i)) { year = 4; foundYear = true; }
          }
          // Also check if the sibling itself is a year header
          const sibText = prevSib.text();
          if (!foundYear && sibText.match(/First Year/i)) { year = 1; foundYear = true; }
          else if (!foundYear && sibText.match(/Second Year/i)) { year = 2; foundYear = true; }
          else if (!foundYear && sibText.match(/Third Year/i)) { year = 3; foundYear = true; }
          else if (!foundYear && sibText.match(/Fourth Year/i)) { year = 4; foundYear = true; }
          
          prevSib = prevSib.prev();
        }
      }
      
      parent = parent.parent();
    }
    
    courseTables.push({ table: table as Element, year, semester });
  });
  
  console.log(`[IPS Scraper] Found ${courseTables.length} course tables`);
  
  // Parse course rows from each table
  for (const { table, year, semester } of courseTables) {
    const $table = $(table);
    const firstCourse = $table.find('tr').eq(1).find('td').eq(1).text().trim();
    console.log(`[IPS Scraper] Table Y${year} S${semester} first course: ${firstCourse}`);
    
    // Parse course rows (skip header row)
    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;
      
      // Status is a link with title attribute
      const statusLink = $(cells[0]).find('a');
      const statusCode = statusLink.text().trim() || $(cells[0]).text().trim();
      
      const courseCode = $(cells[1]).text().trim();
      const units = parseFloat($(cells[2]).text().trim()) || 0;
      const title = $(cells[3]).text().trim();
      const required = $(cells[4])?.text().trim().toUpperCase() === 'Y';
      
      // Skip empty rows or header-like rows
      if (!courseCode || courseCode.includes('Category') || courseCode.includes('Status')) {
        return;
      }
      
      courses.push({
        course_code: courseCode,
        title,
        units,
        status_code: statusCode,
        status: STATUS_MAP[statusCode] || 'not_taken',
        year: year,
        semester: semester,
        required,
      });
    });
  }
  
  console.log(`[IPS Scraper] Parsed ${courses.length} courses`);
  
  // Group by year and semester
  const courses_by_year: Record<number, Record<number, IPSCourse[]>> = {};
  for (const course of courses) {
    if (!courses_by_year[course.year]) courses_by_year[course.year] = {};
    if (!courses_by_year[course.year][course.semester]) courses_by_year[course.year][course.semester] = [];
    courses_by_year[course.year][course.semester].push(course);
  }
  
  const progress_percentage = summary.total_units > 0
    ? Math.round((summary.units_taken / summary.total_units) * 100)
    : 0;
  
  return {
    program,
    student_name: studentNameText,
    year_level: yearLevel ? parseInt(yearLevel) : undefined,
    summary,
    courses,
    courses_by_year,
    progress_percentage,
  };
}
