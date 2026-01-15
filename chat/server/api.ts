import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { FunctionDeclaration } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Connect to SISIA database
const db = new Database(path.join(__dirname, '../../sisia.db'), { readonly: true });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// === QUICK WIN HELPERS ===

// 1. Course code normalization: "CSCI111" → "CSCI 111", "math30" → "MATH 30"
function normalizeCourseCode(code: string): string {
  const upper = code.toUpperCase().trim();
  // Add space between letters and numbers if missing: CSCI111 → CSCI 111
  return upper.replace(/([A-Z]+)(\d)/, '$1 $2');
}

// 2. Program aliases for common abbreviations
const PROGRAM_ALIASES: Record<string, string[]> = {
  'CS': ['CSCI', 'COMPUTER SCIENCE'],
  'MIS': ['MANAGEMENT INFORMATION SYSTEMS'],
  'ME': ['MANAGEMENT ENGINEERING'],
  'MECH': ['MECHANICAL ENGINEERING'],  // Note: Ateneo doesn't have this
  'ECE': ['ELECTRONICS AND COMMUNICATIONS ENGINEERING'],
  'EcE': ['ELECTRONICS AND COMMUNICATIONS ENGINEERING'],
  'COM': ['COMMUNICATION'],
  'ECON': ['ECONOMICS', 'EC'],
  'MATH': ['MATHEMATICS', 'MA'],
  'PSYCH': ['PSYCHOLOGY', 'PS'],
  'BIO': ['BIOLOGY'],
  'CHEM': ['CHEMISTRY', 'CH'],
  'MGT': ['MANAGEMENT'],
  'ACCT': ['ACCOUNTANCY', 'ACC'],
  'FIN': ['FINANCE', 'AMF'],
};

function expandProgramAlias(input: string): string {
  const upper = input.toUpperCase().trim();
  for (const [alias, expansions] of Object.entries(PROGRAM_ALIASES)) {
    if (upper === alias || expansions.some(e => upper.includes(e))) {
      return alias;
    }
  }
  return upper;
}

// 3. Simple phonetic matching for typos (first 3-4 chars)
function getSoundexPrefix(str: string): string {
  return str.toUpperCase().replace(/[AEIOU]/g, '').substring(0, 4);
}

function fuzzyMatch(input: string, target: string): boolean {
  const inputUpper = input.toUpperCase();
  const targetUpper = target.toUpperCase();
  
  // Exact match
  if (targetUpper.includes(inputUpper)) return true;
  
  // Soundex-like prefix match (handles typos like "Buenflor" for "Buenaflor")
  if (getSoundexPrefix(input) === getSoundexPrefix(target.split(',')[0] || target)) {
    return true;
  }
  
  // Check individual words
  const inputWords = inputUpper.split(/\s+/);
  return inputWords.some(word => targetUpper.includes(word));
}

// 4. Term inference from natural language
function inferTerm(input: string): string {
  const lower = input.toLowerCase();
  const currentYear = new Date().getFullYear();
  
  if (lower.includes('next sem') || lower.includes('next semester')) {
    return '2025-2'; // 2nd sem 2025-2026
  }
  if (lower.includes('this sem') || lower.includes('current')) {
    return '2025-2';
  }
  if (lower.includes('intersem') || lower.includes('summer')) {
    return '2025-0';
  }
  if (lower.includes('first sem') || lower.includes('1st sem')) {
    return `${currentYear}-1`;
  }
  if (lower.includes('second sem') || lower.includes('2nd sem')) {
    return `${currentYear}-2`;
  }
  
  return '2025-2'; // Default to current term
}

// Function definitions for Gemini
const functions: FunctionDeclaration[] = [
  {
    name: 'search_courses',
    description: 'Search for courses by keyword or course code. Returns matching courses with their details.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Search query (course code or title keyword)' },
        term: { type: SchemaType.STRING, description: 'Optional term code like 2025-2' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_course_sections',
    description: 'Get all sections for a specific course code, including schedule times and instructors.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        course_code: { type: SchemaType.STRING, description: 'Course code like MATH 30.13' },
        term: { type: SchemaType.STRING, description: 'Term code like 2025-2' },
      },
      required: ['course_code'],
    },
  },
  {
    name: 'get_instructor_schedule',
    description: 'Get all classes taught by an instructor, optionally filtered by day.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        instructor_name: { type: SchemaType.STRING, description: 'Instructor name (partial match)' },
        day: { type: SchemaType.STRING, description: 'Optional day like Monday, Friday' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['instructor_name'],
    },
  },
  {
    name: 'get_room_schedule',
    description: 'Get all classes in a specific room.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_code: { type: SchemaType.STRING, description: 'Room code like SEC-A117' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['room_code'],
    },
  },
  {
    name: 'search_instructors',
    description: 'Search for instructors by name. ALWAYS use this when user asks about a specific instructor. Returns matching instructors with similar names for fuzzy matching.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING, description: 'Instructor name to search for (partial match supported, e.g. "Yap", "Buenaflor", "Kath")' },
        department: { type: SchemaType.STRING, description: 'Optional department filter like DISCS, MA, ENVI' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 20)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_all_rooms',
    description: 'Get a list of all rooms/classrooms in the database.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        building: { type: SchemaType.STRING, description: 'Optional building filter' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_term_summary',
    description: 'Get summary statistics for a term (section count, course count, etc).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        term: { type: SchemaType.STRING, description: 'Term code like 2025-2 (optional, defaults to current)' },
      },
    },
  },
  {
    name: 'find_classes_by_time',
    description: 'Find classes that meet on specific days or time ranges.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        day: { type: SchemaType.STRING, description: 'Day like Monday, MWF, TTh' },
        start_time: { type: SchemaType.STRING, description: 'Start time like 0800, 1300' },
        end_time: { type: SchemaType.STRING, description: 'End time like 0930, 1430' },
        term: { type: SchemaType.STRING, description: 'Term code' },
        limit: { type: SchemaType.NUMBER, description: 'Max results' },
      },
      required: ['day'],
    },
  },
  // === ADVANCED FUNCTIONS ===
  {
    name: 'get_room_weekly_grid',
    description: 'Get a complete weekly schedule grid for a room, organized by day (Monday-Saturday) and time slots. Perfect for room schedule displays.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_code: { type: SchemaType.STRING, description: 'Room code like CTC 106, SEC-A117' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['room_code'],
    },
  },
  {
    name: 'find_schedule_conflicts',
    description: 'Check if a set of courses have schedule conflicts (overlapping times). Input is a list of course codes.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        course_codes: { type: SchemaType.STRING, description: 'Comma-separated course codes to check, e.g. "MATH 30.13, CSCI 111, ENGL 11"' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['course_codes'],
    },
  },
  {
    name: 'get_instructor_load',
    description: 'Analyze an instructor\'s teaching load: total sections, class hours per week, unique courses, and busiest day.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        instructor_name: { type: SchemaType.STRING, description: 'Instructor name (partial match)' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['instructor_name'],
    },
  },
  {
    name: 'find_available_time_slots',
    description: 'Find time slots when a room is NOT occupied (available for booking or study).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_code: { type: SchemaType.STRING, description: 'Room code' },
        day: { type: SchemaType.STRING, description: 'Optional: specific day to check' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['room_code'],
    },
  },
  // === CURRICULUM FUNCTIONS ===
  {
    name: 'get_curriculum',
    description: 'Get the curriculum/course list for a specific degree program (e.g., BS CS, BS MIS, AB COM). Can filter by year and semester.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        program: { type: SchemaType.STRING, description: 'Degree program code like "BS CS", "BS MIS", "AB COM"' },
        year: { type: SchemaType.NUMBER, description: 'Optional: year level (1, 2, 3, 4)' },
        semester: { type: SchemaType.NUMBER, description: 'Optional: semester (1 or 2)' },
        version: { type: SchemaType.STRING, description: 'Optional: curriculum version year like "2024", "2020"' },
      },
      required: ['program'],
    },
  },
  {
    name: 'list_degree_programs',
    description: 'List all available degree programs in the database.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        search: { type: SchemaType.STRING, description: 'Optional: search filter like "Computer", "Engineering"' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'get_course_prerequisites',
    description: 'Get the prerequisites for a specific course.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        course_code: { type: SchemaType.STRING, description: 'Course code like CSCI 111' },
        program: { type: SchemaType.STRING, description: 'Optional: degree program to check prerequisites in' },
      },
      required: ['course_code'],
    },
  },
];

// Function handlers
function handleFunctionCall(name: string, args: Record<string, unknown>): unknown {
  const limit = (args.limit as number) || 20;
  const term = (args.term as string) || '2025-2';
  
  switch (name) {
    case 'search_courses': {
      // Apply course code normalization (CSCI111 → CSCI 111)
      const normalizedQuery = normalizeCourseCode(args.query as string);
      const query = `%${normalizedQuery}%`;
      const queryLower = `%${(args.query as string).toLowerCase()}%`;
      
      const rows = db.prepare(`
        SELECT DISTINCT c.course_code, c.title, c.units, d.code as department,
               (SELECT COUNT(*) FROM class_section cs 
                JOIN term t ON cs.term_id = t.id 
                WHERE cs.course_id = c.id AND t.code = ?) as section_count
        FROM course c
        LEFT JOIN department d ON c.department_id = d.id
        WHERE c.course_code LIKE ? OR c.course_code LIKE ? OR LOWER(c.title) LIKE ?
        ORDER BY c.course_code
        LIMIT ?
      `).all(term, query, `%${args.query}%`, queryLower, limit);
      return { courses: rows, total: rows.length };
    }
    
    case 'get_course_sections': {
      const rows = db.prepare(`
        SELECT cs.section, i.name as instructor, cs.max_capacity, cs.free_slots,
               cs.remarks, t.code as term,
               GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time || ' ' || COALESCE(r.code, ''), '; ') as schedule
        FROM class_section cs
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE c.course_code = ? AND t.code = ?
        GROUP BY cs.id
        ORDER BY cs.section
      `).all(args.course_code, term);
      return { course: args.course_code, term, sections: rows };
    }
    
    case 'get_instructor_schedule': {
      const nameLike = `%${args.instructor_name}%`;
      let sql = `
        SELECT i.name as instructor, c.course_code, cs.section, 
               ss.day, ss.start_time, ss.end_time, r.code as room, t.code as term
        FROM class_section cs
        JOIN instructor i ON cs.instructor_id = i.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE i.name LIKE ? AND t.code = ?
      `;
      const params: unknown[] = [nameLike, term];
      if (args.day) {
        sql += ` AND ss.day = ?`;
        params.push(args.day);
      }
      sql += ` ORDER BY ss.day, ss.start_time LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { instructor: args.instructor_name, schedule: rows };
    }
    
    case 'get_room_schedule': {
      const rows = db.prepare(`
        SELECT r.code as room, c.course_code, cs.section, i.name as instructor,
               ss.day, ss.start_time, ss.end_time, t.code as term
        FROM schedule_slot ss
        JOIN room r ON ss.room_id = r.id
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        WHERE r.code LIKE ? AND t.code = ?
        ORDER BY ss.day, ss.start_time
        LIMIT ?
      `).all(`%${args.room_code}%`, term, limit);
      return { room: args.room_code, schedule: rows };
    }
    
    case 'search_instructors': {
      const searchName = args.name as string;
      // Fuzzy matching: split search into parts and match any
      const parts = searchName.toUpperCase().split(/\s+/);
      
      // Build fuzzy query - match if name contains ANY of the search parts
      let sql = `
        SELECT DISTINCT i.name, d.code as department, 
               (SELECT COUNT(*) FROM class_section cs WHERE cs.instructor_id = i.id) as class_count,
               (SELECT GROUP_CONCAT(DISTINCT c.course_code) FROM class_section cs2 
                JOIN course c ON cs2.course_id = c.id WHERE cs2.instructor_id = i.id LIMIT 5) as courses
        FROM instructor i
        LEFT JOIN department d ON i.department_id = d.id
        WHERE (${parts.map(() => 'UPPER(i.name) LIKE ?').join(' OR ')})
      `;
      
      const params: unknown[] = parts.map(p => `%${p}%`);
      
      if (args.department) {
        sql += ` AND d.code = ?`;
        params.push(args.department);
      }
      
      sql += ` ORDER BY i.name LIMIT ?`;
      params.push(limit);
      
      const rows = db.prepare(sql).all(...params) as Array<{name: string; department: string; class_count: number; courses: string}>;
      
      // If no exact matches, suggest alternatives using fuzzy matching
      if (rows.length === 0) {
        // Get all instructors and filter with fuzzyMatch for typo tolerance
        const allInstructors = db.prepare(`
          SELECT name, 
                 (SELECT GROUP_CONCAT(DISTINCT c.course_code) FROM class_section cs2 
                  JOIN course c ON cs2.course_id = c.id WHERE cs2.instructor_id = i.id LIMIT 3) as courses
          FROM instructor i
          LIMIT 500
        `).all() as Array<{name: string; courses: string}>;
        
        // Filter using fuzzy matching (handles typos like Buenflor → Buenaflor)
        const fuzzyMatches = allInstructors.filter(i => fuzzyMatch(searchName, i.name)).slice(0, 10);
        
        return { 
          search: searchName,
          found: false,
          message: `No instructors found matching "${searchName}".`,
          similar_names: fuzzyMatches.map(r => ({ name: r.name, teaches: r.courses })),
          suggestion: 'Try searching with just the last name (e.g., "Yap" instead of "Romina Yap")'
        };
      }
      
      return { 
        search: searchName,
        found: true,
        instructors: rows.map(r => ({
          name: r.name,
          department: r.department || 'Unknown',
          classes: r.class_count,
          courses: r.courses?.split(',').slice(0, 5).join(', ') || 'None this term'
        })),
        total: rows.length,
        note: rows.length >= limit ? `Showing first ${limit} results. Be more specific for better results.` : undefined
      };
    }
    
    case 'list_all_rooms': {
      const rows = db.prepare(`
        SELECT r.code, COUNT(DISTINCT ss.id) as slot_count
        FROM room r
        LEFT JOIN schedule_slot ss ON ss.room_id = r.id
        GROUP BY r.id
        ORDER BY r.code
        LIMIT ?
      `).all(limit);
      return { rooms: rows, total: rows.length };
    }
    
    case 'get_term_summary': {
      const row = db.prepare(`
        SELECT t.code as term, 
               COUNT(DISTINCT cs.id) as sections,
               COUNT(DISTINCT c.id) as courses,
               COUNT(DISTINCT i.id) as instructors,
               COUNT(DISTINCT r.id) as rooms
        FROM term t
        LEFT JOIN class_section cs ON cs.term_id = t.id
        LEFT JOIN course c ON cs.course_id = c.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE t.code = ?
        GROUP BY t.id
      `).get(term);
      return row || { error: 'Term not found' };
    }
    
    case 'find_classes_by_time': {
      let sql = `
        SELECT c.course_code, cs.section, i.name as instructor,
               ss.day, ss.start_time, ss.end_time, r.code as room
        FROM schedule_slot ss
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE t.code = ? AND ss.day LIKE ?
      `;
      const params: unknown[] = [term, `%${args.day}%`];
      if (args.start_time) {
        sql += ` AND ss.start_time >= ?`;
        params.push(args.start_time);
      }
      if (args.end_time) {
        sql += ` AND ss.end_time <= ?`;
        params.push(args.end_time);
      }
      sql += ` ORDER BY ss.start_time LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { day: args.day, classes: rows };
    }
    
    // === ADVANCED FUNCTION HANDLERS ===
    
    case 'get_room_weekly_grid': {
      const rows = db.prepare(`
        SELECT r.code as room, c.course_code, cs.section,
               ss.day, ss.start_time, ss.end_time, i.name as instructor
        FROM schedule_slot ss
        JOIN room r ON ss.room_id = r.id
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        WHERE r.code LIKE ? AND t.code = ?
        ORDER BY 
          CASE ss.day 
            WHEN 'Monday' THEN 1 
            WHEN 'Tuesday' THEN 2 
            WHEN 'Wednesday' THEN 3 
            WHEN 'Thursday' THEN 4 
            WHEN 'Friday' THEN 5 
            WHEN 'Saturday' THEN 6 
            ELSE 7 
          END,
          ss.start_time
      `).all(`%${args.room_code}%`, term) as Array<{day: string; start_time: string; end_time: string; course_code: string; section: string; instructor: string}>;
      
      // Group by day
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const grid: Record<string, Array<{time: string; course: string; section: string; instructor: string}>> = {};
      
      for (const day of days) {
        grid[day] = rows
          .filter(r => r.day === day)
          .map(r => ({
            time: `${r.start_time}-${r.end_time}`,
            course: r.course_code,
            section: r.section,
            instructor: r.instructor || 'TBA'
          }));
      }
      
      return { room: args.room_code, term, weekly_schedule: grid, total_slots: rows.length };
    }
    
    case 'find_schedule_conflicts': {
      const courseCodes = (args.course_codes as string).split(',').map(c => c.trim());
      
      // Get all schedule slots for requested courses
      const placeholders = courseCodes.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT c.course_code, cs.section, ss.day, ss.start_time, ss.end_time
        FROM schedule_slot ss
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        WHERE c.course_code IN (${placeholders}) AND t.code = ?
        ORDER BY c.course_code, ss.day, ss.start_time
      `).all(...courseCodes, term) as Array<{course_code: string; section: string; day: string; start_time: string; end_time: string}>;
      
      // Find conflicts (same day, overlapping times)
      const conflicts: Array<{course1: string; course2: string; day: string; time1: string; time2: string}> = [];
      
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i];
          const b = rows[j];
          
          if (a.day === b.day && a.course_code !== b.course_code) {
            // Check time overlap
            if (a.start_time < b.end_time && b.start_time < a.end_time) {
              conflicts.push({
                course1: `${a.course_code} ${a.section}`,
                course2: `${b.course_code} ${b.section}`,
                day: a.day,
                time1: `${a.start_time}-${a.end_time}`,
                time2: `${b.start_time}-${b.end_time}`
              });
            }
          }
        }
      }
      
      return { 
        courses_checked: courseCodes, 
        has_conflicts: conflicts.length > 0,
        conflicts,
        message: conflicts.length > 0 
          ? `Found ${conflicts.length} schedule conflict(s)` 
          : 'No conflicts found - these courses can be taken together'
      };
    }
    
    case 'get_instructor_load': {
      const nameLike = `%${args.instructor_name}%`;
      
      // Get teaching stats
      const stats = db.prepare(`
        SELECT 
          i.name as instructor,
          COUNT(DISTINCT cs.id) as total_sections,
          COUNT(DISTINCT c.id) as unique_courses,
          SUM(
            CASE 
              WHEN ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL 
              THEN (CAST(SUBSTR(ss.end_time, 1, 2) AS INTEGER) * 60 + CAST(SUBSTR(ss.end_time, 3, 2) AS INTEGER)) -
                   (CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) * 60 + CAST(SUBSTR(ss.start_time, 3, 2) AS INTEGER))
              ELSE 0 
            END
          ) / 60.0 as total_hours_per_week
        FROM instructor i
        JOIN class_section cs ON cs.instructor_id = i.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        WHERE i.name LIKE ? AND t.code = ?
        GROUP BY i.id
      `).get(nameLike, term) as {instructor: string; total_sections: number; unique_courses: number; total_hours_per_week: number} | null;
      
      if (!stats) {
        return { error: 'Instructor not found' };
      }
      
      // Get busiest day
      const busyDay = db.prepare(`
        SELECT ss.day, COUNT(*) as class_count
        FROM instructor i
        JOIN class_section cs ON cs.instructor_id = i.id
        JOIN term t ON cs.term_id = t.id
        JOIN schedule_slot ss ON ss.section_id = cs.id
        WHERE i.name LIKE ? AND t.code = ?
        GROUP BY ss.day
        ORDER BY class_count DESC
        LIMIT 1
      `).get(nameLike, term) as {day: string; class_count: number} | null;
      
      return {
        instructor: stats.instructor,
        term,
        total_sections: stats.total_sections,
        unique_courses: stats.unique_courses,
        hours_per_week: Math.round(stats.total_hours_per_week * 10) / 10,
        busiest_day: busyDay?.day || 'N/A',
        classes_on_busiest_day: busyDay?.class_count || 0
      };
    }
    
    case 'find_available_time_slots': {
      // Get occupied slots
      const rows = db.prepare(`
        SELECT ss.day, ss.start_time, ss.end_time
        FROM schedule_slot ss
        JOIN room r ON ss.room_id = r.id
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN term t ON cs.term_id = t.id
        WHERE r.code LIKE ? AND t.code = ?
        ORDER BY ss.day, ss.start_time
      `).all(`%${args.room_code}%`, term) as Array<{day: string; start_time: string; end_time: string}>;
      
      // Standard time slots (7am to 9pm)
      const allSlots = ['0700', '0830', '1000', '1130', '1300', '1430', '1600', '1730', '1900'];
      const days = args.day ? [args.day] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      const available: Record<string, string[]> = {};
      
      for (const day of days) {
        const occupiedTimes = rows
          .filter(r => r.day === day)
          .map(r => `${r.start_time}-${r.end_time}`);
        
        available[day] = allSlots.filter(slot => {
          const slotEnd = String(parseInt(slot) + 130).padStart(4, '0');
          return !occupiedTimes.some(occ => {
            const [occStart, occEnd] = occ.split('-');
            return slot < occEnd && slotEnd > occStart;
          });
        }).map(s => `${s}-${String(parseInt(s) + 130).padStart(4, '0')}`);
      }
      
      return { room: args.room_code, term, available_slots: available };
    }
    
    // === CURRICULUM FUNCTION HANDLERS ===
    
    case 'get_curriculum': {
      // Expand program alias (CS → CSCI, ME → Management Engineering)
      const programSearch = expandProgramAlias(args.program as string);
      const programLike = `%${programSearch}%`;
      const versionLike = args.version ? `%${args.version}%` : '%';
      
      // First, find the exact degree program
      const programMatch = db.prepare(`
        SELECT code, name FROM degree_program 
        WHERE code LIKE ? AND code LIKE ?
        ORDER BY version_year DESC
        LIMIT 1
      `).get(programLike, versionLike) as {code: string; name: string} | null;
      
      if (!programMatch) {
        // Suggest similar programs
        const suggestions = db.prepare(`
          SELECT DISTINCT code, name FROM degree_program 
          WHERE code LIKE ? OR name LIKE ?
          ORDER BY code LIMIT 10
        `).all(`%${args.program}%`, `%${args.program}%`) as Array<{code: string; name: string}>;
        
        return {
          found: false,
          search: args.program,
          message: `No program found matching "${args.program}".`,
          suggestions: suggestions.map(s => ({ code: s.code.split('_')[0], name: s.name })),
          hint: 'Try searching with full program name like "BS Management Engineering"'
        };
      }
      
      // Get ALL courses for this program (no limit)
      let sql = `
        SELECT c.course_code, c.title, cc.year, cc.semester, cc.prerequisites_raw as prerequisites
        FROM curriculum_course cc
        JOIN course c ON cc.course_id = c.id
        WHERE cc.degree_id = (SELECT id FROM degree_program WHERE code = ?)
      `;
      const params: unknown[] = [programMatch.code];
      
      if (args.year) {
        sql += ` AND cc.year = ?`;
        params.push(args.year);
      }
      if (args.semester) {
        sql += ` AND cc.semester = ?`;
        params.push(args.semester);
      }
      
      sql += ` ORDER BY cc.year, cc.semester, c.course_code`;
      
      const rows = db.prepare(sql).all(...params) as Array<{
        course_code: string; title: string; year: number; semester: number; prerequisites: string;
      }>;
      
      // Group by year and semester with proper structure
      const curriculum: Record<number, Record<number, Array<{code: string; title: string; prereqs?: string}>>> = {};
      
      for (const row of rows) {
        if (!curriculum[row.year]) curriculum[row.year] = {};
        if (!curriculum[row.year][row.semester]) curriculum[row.year][row.semester] = [];
        curriculum[row.year][row.semester].push({
          code: row.course_code,
          title: row.title,
          prereqs: row.prerequisites || undefined
        });
      }
      
      // Create summary per year
      const summary: Record<string, number> = {};
      for (const [year, semesters] of Object.entries(curriculum)) {
        for (const [sem, courses] of Object.entries(semesters)) {
          const key = `Year ${year} Sem ${sem}`;
          summary[key] = (courses as Array<unknown>).length;
        }
      }
      
      return { 
        program_code: programMatch.code.split('_')[0],
        program_name: programMatch.name,
        version: programMatch.code,
        curriculum,
        summary,
        total_courses: rows.length
      };
    }
    
    case 'list_degree_programs': {
      const searchLike = args.search ? `%${args.search}%` : '%';
      const rows = db.prepare(`
        SELECT code, name, 
               (SELECT COUNT(*) FROM curriculum_course cc WHERE cc.degree_id = dp.id) as course_count
        FROM degree_program dp
        WHERE name LIKE ? OR code LIKE ?
        ORDER BY code
        LIMIT ?
      `).all(searchLike, searchLike, limit) as Array<{code: string; name: string; course_count: number}>;
      
      return { programs: rows, total: rows.length };
    }
    
    case 'get_course_prerequisites': {
      const courseCode = args.course_code as string;
      const rows = db.prepare(`
        SELECT DISTINCT dp.code as program, c.course_code, cc.prerequisites_raw as prerequisites
        FROM curriculum_course cc
        JOIN degree_program dp ON cc.degree_id = dp.id
        JOIN course c ON cc.course_id = c.id
        WHERE c.course_code LIKE ?
        AND cc.prerequisites_raw IS NOT NULL 
        AND cc.prerequisites_raw != ''
        LIMIT 10
      `).all(`%${courseCode}%`) as Array<{program: string; course_code: string; prerequisites: string}>;
      
      if (rows.length === 0) {
        return { course: courseCode, message: 'No prerequisite information found for this course' };
      }
      
      return { course: courseCode, prerequisites: rows };
    }
    
    default:
      return { error: `Unknown function: ${name}` };
  }
}

// System prompt
const SYSTEM_PROMPT = `You are SISIA Assistant, an AI helper for Ateneo students to query class schedules, courses, instructors, and rooms.

CRITICAL RULES - DO NOT VIOLATE:
1. NEVER make up data. ONLY use information returned from function calls.
2. If a function returns empty results, say "I couldn't find..." - do NOT list random data.
3. When user says "list them all" or similar, remember what they asked about previously and pass that as a filter.
4. ALWAYS use search_instructors with the name parameter when looking for instructors.
5. For partial names like "Kath", search for it as-is - the function does fuzzy matching.

Current data: 2024-2025 academic year (terms 2024-2, 2025-0, 2025-1, 2025-2).
Database has: ~12,500 class sections, 3,600+ courses, 1,700+ instructors, 300+ rooms, 459 degree programs.

When displaying results:
- Format schedules as markdown tables when there are multiple entries
- Show instructor names in "LASTNAME, FIRSTNAME" format
- Include room codes and time slots
- If function returns similar_names, present those as options to the user

Be helpful, concise, and accurate. When unsure, ask for clarification rather than guessing.`;

// Chat endpoint
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, history = [] } = req.body;
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: functions }],
    });
    
    const chat = model.startChat({
      history: history.map((msg: { role: string; content: string }) => ({
        // Gemini uses 'model' instead of 'assistant'
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }],
      })),
    });
    
    let response = await chat.sendMessage(message);
    let result = response.response;
    
    // Handle function calls
    let functionCalls = result.functionCalls();
    while (functionCalls && functionCalls.length > 0) {
      const functionResponses = [];
      
      for (const call of functionCalls) {
        console.log(`Function call: ${call.name}`, call.args);
        const functionResult = handleFunctionCall(call.name, call.args as Record<string, unknown>);
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: functionResult,
          },
        });
      }
      
      response = await chat.sendMessage(functionResponses);
      result = response.response;
      functionCalls = result.functionCalls();
    }
    
    const text = result.text();
    res.json({ response: text });
    
  } catch (error: unknown) {
    console.error('Chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM class_section) as sections,
      (SELECT COUNT(*) FROM course) as courses,
      (SELECT COUNT(*) FROM instructor) as instructors
  `).get();
  res.json({ status: 'ok', database: stats });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🤖 SISIA Chat API running on http://localhost:${PORT}`);
});
