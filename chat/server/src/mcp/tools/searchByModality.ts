/**
 * Search By Modality Tool
 * 
 * Find classes by delivery mode (online/onsite).
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'search_by_modality',
  description: 'Find classes by delivery mode - online or face-to-face (onsite). Currently 77 online sections available.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      modality: { 
        type: SchemaType.STRING, 
        description: 'Delivery mode: "online" or "onsite"' 
      },
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code' 
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
    required: ['modality'],
  },
};

export function handler(args: { modality: string; department?: string; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 30, 50);
  
  // Normalize modality input
  const modalityUpper = args.modality.toUpperCase();
  let modalityFilter = 'ONSITE';
  if (modalityUpper.includes('ONLINE') || modalityUpper.includes('REMOTE') || modalityUpper.includes('VIRTUAL')) {
    modalityFilter = 'ONLINE';
  }
  
  let query = `
    SELECT DISTINCT
      c.course_code, 
      c.title, 
      cs.section,
      i.name as instructor,
      cs.free_slots,
      cs.max_capacity,
      ss.modality,
      GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time, '; ') as schedule
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    JOIN schedule_slot ss ON ss.section_id = cs.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    WHERE t.code = ? AND ss.modality = ?
  `;
  
  const params: unknown[] = [term, modalityFilter];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  query += ` GROUP BY cs.id ORDER BY c.course_code LIMIT ?`;
  params.push(limit);
  
  const sections = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    section: string;
    instructor: string | null;
    free_slots: number;
    max_capacity: number;
    modality: string;
    schedule: string;
  }>;
  
  // Get total counts
  const counts = db.prepare(`
    SELECT ss.modality, COUNT(DISTINCT cs.id) as count
    FROM schedule_slot ss
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ?
    GROUP BY ss.modality
  `).all(term) as Array<{ modality: string; count: number }>;
  
  return {
    modality_requested: args.modality,
    modality_matched: modalityFilter,
    term,
    total_found: sections.length,
    available_modalities: Object.fromEntries(counts.map(c => [c.modality, c.count])),
    sections: sections.map(s => ({
      course: s.course_code,
      title: s.title,
      section: s.section,
      instructor: s.instructor || 'TBA',
      free_slots: s.free_slots,
      enrolled: s.max_capacity - s.free_slots,
      modality: s.modality,
      schedule: s.schedule
    }))
  };
}
