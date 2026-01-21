/**
 * Enrolled Classes Scraper (J_VCEC.do)
 * 
 * Scrapes "My Currently Enrolled Classes" which includes:
 * - Subject code with term suffix
 * - Section
 * - Instructor name (key data!)
 * - Course title
 * - Delivery mode
 * 
 * This is the best source for instructor names for personal classes.
 */

import * as cheerio from 'cheerio';
import { loginToAISIS } from './aisisSession.js';
import { normalizeCourseCode, normalizeInstructorName } from '../utils/normalizer.js';

export interface EnrolledClass {
  subject_code: string;       // Normalized: "LLAW 113"
  subject_code_raw: string;   // Original: "LLAW 11312018"
  section: string;
  delivery_mode: string;
  course_title: string;
  instructor: string;         // Normalized: "AGUILA, Eirene Jhone"
  instructor_raw: string;     // Original: "Eirene Jhone AGUILA"
  syllabus_url?: string;
  syllabus_available: boolean; // Whether syllabus is available
}

export interface EnrolledClassesResult {
  term: string;
  student_name?: string;
  classes: EnrolledClass[];
  total_units?: number;
}

/**
 * Scrape enrolled classes from AISIS
 */
export async function scrapeEnrolledClasses(
  username: string,
  password: string
): Promise<EnrolledClassesResult> {
  const session = await loginToAISIS(username, password);
  
  const response = await session.fetch('https://aisis.ateneo.edu/j_aisis/J_VCEC.do');
  const html = await response.text();
  
  const $ = cheerio.load(html);
  const classes: EnrolledClass[] = [];
  
  // Extract term from page header
  let term = '';
  $('td.text02, span.text02').each((_, el) => {
    const text = $(el).text();
    if (text.includes('Semester') && text.includes('SY')) {
      term = text.trim();
    }
  });
  
  // Find the enrollment table (contains "SUBJECT CODE" and "INSTRUCTOR" headers)
  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('tr').first().text().toUpperCase();
    
    if (!headerText.includes('SUBJECT CODE') || !headerText.includes('INSTRUCTOR')) {
      return;
    }
    
    // Parse data rows
    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 7) return;
      
      const subjectCodeRaw = $(cells[0]).text().trim();
      const section = $(cells[1]).text().trim();
      const deliveryMode = $(cells[2]).text().trim();
      // cells[3] = BATCH
      // cells[4] = SCHEDULE (usually empty in this table)
      const courseTitle = $(cells[5]).text().trim();
      const instructorRaw = $(cells[6]).text().trim();
      
      // Extract syllabus URL - check multiple possible locations and patterns
      let syllabusUrl: string | undefined;
      let syllabusAvailable = true;
      
      // Check each cell for syllabus link (could be in different columns)
      $(cells).each((_, cell) => {
        // Look for links to syllabi directory
        const syllabusLink = $(cell).find('a[href*="/syllabi/"], a[href*="syllabus"]');
        if (syllabusLink.length > 0) {
          const href = syllabusLink.attr('href');
          if (href) {
            // Make URL absolute if it's relative
            syllabusUrl = href.startsWith('http') 
              ? href 
              : `https://aisis.ateneo.edu${href.startsWith('/') ? '' : '/'}${href}`;
          }
        }
        
        // Check for "Syllabus Not Available" text
        if ($(cell).text().includes('Not Available')) {
          syllabusAvailable = false;
        }
      });
      
      if (subjectCodeRaw && section) {
        classes.push({
          subject_code: normalizeCourseCode(subjectCodeRaw),
          subject_code_raw: subjectCodeRaw,
          section,
          delivery_mode: deliveryMode,
          course_title: courseTitle,
          instructor: normalizeInstructorName(instructorRaw),
          instructor_raw: instructorRaw,
          syllabus_url: syllabusUrl,
          syllabus_available: syllabusAvailable,
        });
      }
    });
  });
  
  return {
    term,
    classes,
  };
}
