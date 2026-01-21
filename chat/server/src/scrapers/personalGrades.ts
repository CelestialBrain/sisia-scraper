/**
 * Personal Grades Scraper
 * 
 * Scrapes user's final grades from J_VG.do
 * 
 * AISIS Structure (based on actual page analysis):
 * - Filters: 3 dropdowns (firstChoice, secondChoice, thirdChoice)
 * - Columns: School Year | Sem | Course | Subject Code | Course Title | Units | Final Grade
 * - Summary: Cumulative QPI with breakdown by year level
 */

import * as cheerio from 'cheerio';
import { loginToAISIS } from './aisisSession.js';

export interface GradeEntry {
  school_year: string;
  semester: string;
  course: string;
  subject_code: string;
  course_title: string;
  units: number;
  final_grade: string;
}

export interface QPISummary {
  cumulative_qpi: number;
  total_units: number;
  year_breakdown: Array<{
    year: string;
    units: number;
    qpi: number;
  }>;
}

export interface GradesResult {
  student_name: string;
  grades: GradeEntry[];
  qpi_summary: QPISummary;
  terms: string[];
}

/**
 * Scrape grades from AISIS
 */
export async function scrapePersonalGrades(
  username: string,
  password: string,
  term?: string
): Promise<GradesResult> {
  const session = await loginToAISIS(username, password);
  
  // Default to viewing all grades
  let url = 'https://aisis.ateneo.edu/j_aisis/J_VG.do';
  if (term) {
    url += `?termCode=${term}`;
  }
  
  const response = await session.fetch(url);
  const html = await response.text();
  
  const $ = cheerio.load(html);
  const grades: GradeEntry[] = [];
  const terms: string[] = [];
  
  // Extract student name
  const studentNameText = $('span.text04').last().text().trim();
  
  // Parse available terms from dropdown
  $('select[name="secondChoice"] option, select[name="thirdChoice"] option').each((_, opt) => {
    const val = $(opt).val()?.toString();
    if (val && !terms.includes(val)) {
      terms.push(val);
    }
  });
  
  // Find grades table
  // Headers: School Year | Sem | Course | Subject Code | Course Title | Units | Final Grade
  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('tr').first().text().toLowerCase();
    
    // Check if this is the grades table
    if (!headerText.includes('subject') && !headerText.includes('final grade')) {
      return;
    }
    
    // Parse grade rows
    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 7) return;
      
      const school_year = $(cells[0]).text().trim();
      const semester = $(cells[1]).text().trim();
      const course = $(cells[2]).text().trim();
      const subject_code = $(cells[3]).text().trim();
      const course_title = $(cells[4]).text().trim();
      const units = parseFloat($(cells[5]).text().trim()) || 0;
      const final_grade = $(cells[6]).text().trim();
      
      if (subject_code && final_grade) {
        grades.push({
          school_year,
          semester,
          course,
          subject_code,
          course_title,
          units,
          final_grade,
        });
      }
    });
  });
  
  // Parse QPI summary
  const qpi_summary: QPISummary = {
    cumulative_qpi: 0,
    total_units: 0,
    year_breakdown: [],
  };
  
  // Look for cumulative QPI text
  $('table').each((_, table) => {
    const text = $(table).text();
    if (text.includes('Cumulative QPI') || text.includes('CQPI')) {
      // Parse QPI value
      const qpiMatch = text.match(/Cumulative\s*QPI[:\s]*([\d.]+)/i);
      if (qpiMatch) {
        qpi_summary.cumulative_qpi = parseFloat(qpiMatch[1]);
      }
      
      // Parse year breakdown if present
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        const rowText = $(row).text();
        
        if (rowText.includes('Year')) {
          const year = $(cells[0]).text().trim();
          const units = parseFloat($(cells[1]).text().trim()) || 0;
          const qpi = parseFloat($(cells[2]).text().trim()) || 0;
          
          if (year && !isNaN(qpi)) {
            qpi_summary.year_breakdown.push({ year, units, qpi });
            qpi_summary.total_units += units;
          }
        }
      });
    }
  });
  
  // Calculate cumulative QPI if not found but we have grades
  if (qpi_summary.cumulative_qpi === 0 && grades.length > 0) {
    const numericGrades = grades.filter(g => !isNaN(parseFloat(g.final_grade)));
    if (numericGrades.length > 0) {
      const totalQualityPoints = numericGrades.reduce((sum, g) => 
        sum + parseFloat(g.final_grade) * g.units, 0);
      const totalUnits = numericGrades.reduce((sum, g) => sum + g.units, 0);
      qpi_summary.cumulative_qpi = totalUnits > 0 ? totalQualityPoints / totalUnits : 0;
      qpi_summary.total_units = totalUnits;
    }
  }
  
  return {
    student_name: studentNameText,
    grades,
    qpi_summary,
    terms,
  };
}
