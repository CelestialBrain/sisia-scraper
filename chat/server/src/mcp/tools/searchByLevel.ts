/**
 * Search By Level Tool
 * 
 * Find courses by academic level (undergraduate/graduate).
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'search_by_level',
  description: 'Find courses by academic level - undergraduate (U) or graduate (G). Undergrad has ~9600 sections, Graduate has ~3000.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      level: { 
        type: SchemaType.STRING, 
        description: 'Level: "undergraduate", "undergrad", "U" or "graduate", "grad", "G"' 
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
    required: ['level'],
  },
};

export function handler(args: { level: string; department?: string; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 30, 50);
  
  // Normalize level input
  const levelUpper = args.level.toUpperCase();
  let levelCode = 'U'; // Default to undergraduate
  if (levelUpper.includes('GRAD') || levelUpper === 'G') {
    levelCode = 'G';
  }
  
  let query = `
    SELECT DISTINCT
      c.course_code, 
      c.title, 
      c.units,
      cs.section,
      i.name as instructor,
      cs.free_slots,
      cs.max_capacity,
      cs.level
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    WHERE t.code = ? AND cs.level = ?
  `;
  
  const params: unknown[] = [term, levelCode];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  query += ` ORDER BY c.course_code, cs.section LIMIT ?`;
  params.push(limit);
  
  const sections = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    units: number;
    section: string;
    instructor: string | null;
    free_slots: number;
    max_capacity: number;
    level: string;
  }>;
  
  // Get count by level
  const counts = db.prepare(`
    SELECT cs.level, COUNT(*) as count
    FROM class_section cs
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ? AND cs.level IN ('U', 'G')
    GROUP BY cs.level
  `).all(term) as Array<{ level: string; count: number }>;
  
  return {
    level_requested: args.level,
    level_matched: levelCode === 'U' ? 'Undergraduate' : 'Graduate',
    term,
    total_found: sections.length,
    level_counts: {
      undergraduate: counts.find(c => c.level === 'U')?.count || 0,
      graduate: counts.find(c => c.level === 'G')?.count || 0
    },
    sections: sections.map(s => ({
      course: s.course_code,
      title: s.title,
      units: s.units,
      section: s.section,
      instructor: s.instructor || 'TBA',
      free_slots: s.free_slots,
      enrolled: s.max_capacity - s.free_slots,
      level: s.level === 'U' ? 'Undergrad' : 'Graduate'
    }))
  };
}
