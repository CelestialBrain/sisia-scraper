/**
 * Find Courses Without Prerequisites Tool
 * 
 * Find courses that have no prerequisites - good for freshmen or electives.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'find_courses_without_prereqs',
  description: 'Find courses with no prerequisites. Good for freshmen, transfer students, or picking electives. About 1400 sections available.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code (e.g., "MATH", "CSCI")' 
      },
      min_slots: { 
        type: SchemaType.NUMBER, 
        description: 'Minimum available slots (default: 1)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 30)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: [],
  },
};

export function handler(args: { department?: string; min_slots?: number; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const minSlots = args.min_slots || 1;
  const limit = Math.min(args.limit || 30, 50);
  
  let query = `
    SELECT DISTINCT
      c.course_code, 
      c.title, 
      c.units,
      cs.section,
      i.name as instructor,
      cs.free_slots,
      cs.max_capacity,
      d.code as department,
      GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time, '; ') as schedule
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    WHERE t.code = ? 
    AND cs.has_prerequisites = 0
    AND cs.free_slots >= ?
  `;
  
  const params: unknown[] = [term, minSlots];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
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
  }>;
  
  // Get total count
  const totalCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM class_section cs
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ? AND cs.has_prerequisites = 0
  `).get(term) as { count: number };
  
  return {
    term,
    total_no_prereq_sections: totalCount.count,
    showing: sections.length,
    sections: sections.map(s => ({
      course: s.course_code,
      title: s.title,
      units: s.units,
      section: s.section,
      instructor: s.instructor || 'TBA',
      free_slots: s.free_slots,
      enrolled: s.max_capacity - s.free_slots,
      department: s.department,
      schedule: s.schedule
    })),
    _meta: sections.length === 0 ? { message: 'No courses without prerequisites found matching criteria' } : undefined
  };
}
