/**
 * Personal Schedule Scraper
 * 
 * Scrapes user's personal class schedule from J_VMCS.do
 * 
 * AISIS Structure (based on actual page analysis):
 * - Layout: Weekly time-slot grid
 * - Columns: Time | Mon | Tue | Wed | Thur | Fri | Sat
 * - Rows: 30-minute intervals (700-730, 730-800, etc.)
 * - Cell content: "COURSE_CODE SECTION ROOM (INSTRUCTION_MODE)"
 */

import * as cheerio from 'cheerio';
import { loginToAISIS } from './aisisSession.js';
import { db } from '../mcp/tools/db.js';

export interface PersonalScheduleSlot {
  time: string;
  course_code: string;
  section: string;
  room: string;
  day: string;
  instruction_mode: string;
  instructor?: string;  // Added: lookup from database
}

export interface PersonalScheduleResult {
  term: string;
  student_name: string;
  schedule: PersonalScheduleSlot[];
  weekly_grid: Record<string, PersonalScheduleSlot[]>;
  available_terms?: { value: string; label: string }[]; // All available terms from dropdown
}

const DAY_COLUMNS = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];

/**
 * Scrape personal schedule from AISIS
 */
export async function scrapePersonalSchedule(
  username: string,
  password: string,
  term?: string
): Promise<PersonalScheduleResult> {
  const session = await loginToAISIS(username, password);
  
  // Navigate to My Class Schedule
  const url = term 
    ? `https://aisis.ateneo.edu/j_aisis/J_VMCS.do?termCode=${term}`
    : 'https://aisis.ateneo.edu/j_aisis/J_VMCS.do';
  
  const response = await session.fetch(url);
  const html = await response.text();
  
  const $ = cheerio.load(html);
  const schedule: PersonalScheduleSlot[] = [];
  
  // Extract term from page header or dropdown
  const termText = $('span.text04').first().text().trim() || term || '2025-2';
  
  // Extract available terms from dropdown
  const availableTerms: { value: string; label: string }[] = [];
  $('select option').each((_, opt) => {
    const value = $(opt).attr('value') || '';
    const label = $(opt).text().trim();
    if (value && label) {
      availableTerms.push({ value, label });
    }
  });
  
  // Extract student name
  const studentNameText = $('span.text04').last().text().trim();
  
  // Find the schedule grid table
  // The table has headers: Time | Mon | Tue | Wed | Thur | Fri | Sat
  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('tr').first().text();
    
    // Check if this is the schedule grid (has Time and day columns)
    if (!headerText.includes('Time') || !headerText.includes('Mon')) {
      return;
    }
    
    // Parse each row (skip header)
    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 7) return;
      
      const timeSlot = $(cells[0]).text().trim(); // e.g., "700-730"
      
      // Check each day column (1-6)
      DAY_COLUMNS.forEach((day, index) => {
        const cellContent = $(cells[index + 1]).text().trim();
        
        if (cellContent && cellContent !== '') {
          // Parse AISIS schedule cell content
          // Formats:
          // 1. "MATH 31.2 K2 G-206 (FULLY ONSITE)"
          // 2. "THEO 11 A1 K-303 (FULLY ONSITE)"
          // 3. "CHEM 10.01 NSLEC-E-L SEC-B305 (FULLY ONSITE)"
          // All modality is at end in parentheses
          
          // Extract modality first (always last, in parentheses)
          const modalityMatch = cellContent.match(/\(([^)]+)\)\s*$/);
          const instructionMode = modalityMatch ? modalityMatch[1].trim() : 'FULLY ONSITE';
          
          // Remove modality from content
          const contentWithoutModality = cellContent.replace(/\s*\([^)]+\)\s*$/, '').trim();
          
          // Split by whitespace
          const parts = contentWithoutModality.split(/\s+/).filter(p => p);
          
          // Course code is first 1-2 parts (until we hit a section identifier)
          // Section identifiers: start with letter(s) followed by number, or common patterns
          const courseCodeParts: string[] = [];
          let sectionIndex = 0;
          
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            // First part is always course prefix (e.g., "MATH", "THEO")
            if (i === 0) {
              courseCodeParts.push(part);
              continue;
            }
            // Second part is course number if it starts with digit or has decimal
            if (i === 1 && (/^\d/.test(part) || /\./.test(part))) {
              courseCodeParts.push(part);
              continue;
            }
            // Everything else after course code
            sectionIndex = i;
            break;
          }
          
          const courseCode = courseCodeParts.join(' ');
          const remainingParts = parts.slice(sectionIndex);
          
          // Section is first remaining part (e.g., "K2", "A1", "NSLEC-E-L")
          // Room is second remaining part (e.g., "G-206", "K-303", "SEC-B305")
          const section = remainingParts[0] || '';
          const room = remainingParts[1] || '';
          
          if (courseCode) {
            schedule.push({
              time: timeSlot,
              day,
              course_code: courseCode,
              section: section,
              room: room,
              instruction_mode: instructionMode,
            });
          }
        }
      });
    });
  });
  
  // Consolidate contiguous time slots into single class periods
  const consolidated = consolidateTimeSlots(schedule);
  
  // Enrich with instructor names from database (prevents AI hallucination)
  const enriched = enrichWithInstructors(consolidated, termText);
  
  // Group by day for weekly grid
  const weekly_grid: Record<string, PersonalScheduleSlot[]> = {};
  for (const slot of enriched) {
    if (!weekly_grid[slot.day]) weekly_grid[slot.day] = [];
    weekly_grid[slot.day].push(slot);
  }
  
  // Sort by time
  for (const day of Object.keys(weekly_grid)) {
    weekly_grid[day].sort((a, b) => {
      const timeA = parseInt(a.time.split('-')[0]);
      const timeB = parseInt(b.time.split('-')[0]);
      return timeA - timeB;
    });
  }
  
  return {
    term: termText,
    student_name: studentNameText,
    schedule: enriched,
    weekly_grid,
    available_terms: availableTerms.length > 0 ? availableTerms : undefined,
  };
}

/**
 * Look up instructor names AND room data from database
 * This prevents AI from hallucinating and fills in room data not present in AISIS
 */
function enrichWithInstructors(
  slots: PersonalScheduleSlot[],
  term: string
): PersonalScheduleSlot[] {
  // Normalize term format - AISIS returns "2nd Semester, SY 2025-2026" but DB uses "2025-2"
  let dbTerm = '2025-2'; // Default to current term
  if (term) {
    // Try to extract term code from various formats
    const yearMatch = term.match(/20\d{2}/);
    const semMatch = term.match(/(\d)(?:st|nd|rd|th)?[\s-]?[Ss]em/i);
    if (yearMatch && semMatch) {
      // Convert "2nd Semester, SY 2025-2026" to "2025-2"
      dbTerm = `${yearMatch[0]}-${semMatch[1]}`;
    } else if (/^\d{4}-\d$/.test(term)) {
      // Already in correct format like "2025-2"
      dbTerm = term;
    }
  }
  
  console.log(`[enrichWithInstructors] Input term: "${term}", normalized: "${dbTerm}"`);
  
  // Get unique course+section pairs
  const lookupPairs = [...new Set(slots.map(s => `${s.course_code}|${s.section}`))];
  
  // Create lookup maps from database
  const instructorMap = new Map<string, string>();
  const roomMap = new Map<string, string>();
  
  for (const pair of lookupPairs) {
    const [courseCode, section] = pair.split('|');
    try {
      // Query for instructor AND room data
      const result = db.prepare(`
        SELECT 
          i.name as instructor,
          r.code as room
        FROM class_section cs
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE c.course_code = ? AND cs.section = ? AND t.code = ?
        LIMIT 1
      `).get(courseCode, section, dbTerm) as { instructor: string; room: string } | undefined;
      
      if (result?.instructor) {
        instructorMap.set(pair, result.instructor);
        console.log(`[enrichWithInstructors] Found instructor: ${courseCode} ${section} -> ${result.instructor}`);
      } else {
        console.log(`[enrichWithInstructors] No instructor for: ${courseCode} ${section}`);
      }
      
      if (result?.room) {
        roomMap.set(pair, result.room);
        console.log(`[enrichWithInstructors] Found room: ${courseCode} ${section} -> ${result.room}`);
      }
    } catch (e) {
      console.error(`[enrichWithInstructors] Error for ${courseCode} ${section}:`, e);
    }
  }
  
  // Enrich slots with instructor and room data from database
  return slots.map(slot => {
    const key = `${slot.course_code}|${slot.section}`;
    const dbRoom = roomMap.get(key);
    return {
      ...slot,
      instructor: instructorMap.get(key) || 'TBA',
      // Always prefer database room if available (AISIS parsing is unreliable)
      // Fall back to AISIS room only if it looks like a valid room code
      room: dbRoom || (isValidRoomCode(slot.room) ? slot.room : 'TBA'),
    };
  });
}

/**
 * Check if a string looks like a valid room code (e.g., CTC 304, SOM 105, G-206)
 * Excludes values like "ONSITE)", "TBA", empty strings
 */
function isValidRoomCode(room: string | undefined): boolean {
  if (!room || room === '' || room === 'TBA') return false;
  // Invalid if contains ONSITE, ONLINE, or ends with )
  if (room.includes('ONSITE') || room.includes('ONLINE') || room.endsWith(')')) return false;
  // Valid if contains at least one letter and one number (typical room format)
  return /[A-Z]/.test(room) && /\d/.test(room);
}

/**
 * Consolidate contiguous 30-minute time slots into full class periods
 * e.g., [1400-1430, 1430-1500, 1500-1530] -> [1400-1530]
 */
function consolidateTimeSlots(slots: PersonalScheduleSlot[]): PersonalScheduleSlot[] {
  if (slots.length === 0) return [];
  
  // Group by day + course + section
  const groups = new Map<string, PersonalScheduleSlot[]>();
  
  for (const slot of slots) {
    const key = `${slot.day}|${slot.course_code}|${slot.section}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(slot);
  }
  
  const consolidated: PersonalScheduleSlot[] = [];
  
  for (const [_, groupSlots] of groups) {
    // Sort by start time
    groupSlots.sort((a, b) => {
      const timeA = parseInt(a.time.split('-')[0]);
      const timeB = parseInt(b.time.split('-')[0]);
      return timeA - timeB;
    });
    
    // Merge contiguous slots
    let currentStart = groupSlots[0].time.split('-')[0];
    let currentEnd = groupSlots[0].time.split('-')[1];
    const firstSlot = groupSlots[0];
    
    for (let i = 1; i < groupSlots.length; i++) {
      const [slotStart, slotEnd] = groupSlots[i].time.split('-');
      
      // If this slot starts where the previous ended, extend the period
      if (slotStart === currentEnd) {
        currentEnd = slotEnd;
      } else {
        // Save the previous period and start a new one
        consolidated.push({
          ...firstSlot,
          time: `${currentStart}-${currentEnd}`,
        });
        currentStart = slotStart;
        currentEnd = slotEnd;
      }
    }
    
    // Add the last period
    consolidated.push({
      ...firstSlot,
      time: `${currentStart}-${currentEnd}`,
    });
  }
  
  return consolidated;
}
