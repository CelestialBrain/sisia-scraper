/**
 * Find Open Sections Tool
 * 
 * Find sections with available slots across all courses.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'find_open_sections',
  description: 'Find sections that still have available enrollment slots. Can filter by department, units, time preference, or minimum slots.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code (e.g., "MATH", "CSCI", "ENGL")' 
      },
      units: { 
        type: SchemaType.NUMBER, 
        description: 'Filter by exact unit count (e.g., 3, 5)' 
      },
      min_units: { 
        type: SchemaType.NUMBER, 
        description: 'Filter by minimum units' 
      },
      max_units: { 
        type: SchemaType.NUMBER, 
        description: 'Filter by maximum units' 
      },
      min_slots: { 
        type: SchemaType.NUMBER, 
        description: 'Minimum available slots (default: 1)' 
      },
      morning_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only show classes before 12:00' 
      },
      afternoon_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only show classes between 12:00-17:00' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 30)' 
      },
    },
    required: [],
  },
};

export function handler(args: { 
  department?: string; 
  units?: number;
  min_units?: number;
  max_units?: number;
  min_slots?: number; 
  morning_only?: boolean;
  afternoon_only?: boolean;
  term?: string; 
  limit?: number 
}) {
  const term = args.term || '2025-2';
  const minSlots = args.min_slots || 1;
  const limit = Math.min(args.limit || 30, 50);
  
  let query = `
    SELECT c.course_code, c.title, c.units, cs.section, i.name as instructor, 
           cs.free_slots, cs.max_capacity, d.code as department,
           GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time, '; ') as schedule,
           MIN(ss.start_time) as earliest_time
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    WHERE t.code = ? AND cs.free_slots >= ?
  `;
  
  const params: unknown[] = [term, minSlots];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  // Units filtering
  if (args.units) {
    query += ` AND c.units = ?`;
    params.push(args.units);
  }
  if (args.min_units) {
    query += ` AND c.units >= ?`;
    params.push(args.min_units);
  }
  if (args.max_units) {
    query += ` AND c.units <= ?`;
    params.push(args.max_units);
  }
  
  if (args.morning_only) {
    query += ` AND CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) < 12`;
  }
  
  if (args.afternoon_only) {
    query += ` AND CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) BETWEEN 12 AND 17`;
  }
  
  query += ` GROUP BY cs.id ORDER BY cs.free_slots DESC, c.course_code LIMIT ?`;
  params.push(limit);
  
  const sections = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    units: number;
    section: string;
    instructor: string | null;
    free_slots: number;
    max_capacity: number;
    department: string | null;
    schedule: string | null;
    earliest_time: string | null;
  }>;
  
  // Group by department for summary
  const byDept: Record<string, number> = {};
  for (const s of sections) {
    const dept = s.department || 'Unknown';
    byDept[dept] = (byDept[dept] || 0) + 1;
  }
  
  return {
    filters: {
      department: args.department,
      units: args.units,
      min_units: args.min_units,
      max_units: args.max_units,
      min_slots: minSlots,
      morning_only: args.morning_only,
      afternoon_only: args.afternoon_only,
      term
    },
    total_found: sections.length,
    by_department: byDept,
    sections: sections.map(s => ({
      course: s.course_code,
      title: s.title,
      units: s.units,
      section: s.section,
      instructor: s.instructor || 'TBA',
      free_slots: s.free_slots,
      enrolled: s.max_capacity - s.free_slots,
      max_capacity: s.max_capacity,
      schedule: s.schedule
    })),
    _meta: sections.length === 0 ? { message: 'No open sections found matching your criteria' } : undefined
  };
}

