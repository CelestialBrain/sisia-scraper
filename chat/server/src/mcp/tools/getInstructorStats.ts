/**
 * Get Instructor Stats Tool
 * 
 * Returns instructors ranked by number of sections taught.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_instructor_stats',
  description: 'Get instructors ranked by number of sections/classes they teach. Shows workload distribution.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 20)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: [],
  },
};

export function handler(args: { department?: string; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 20, 50);
  
  let query = `
    SELECT 
      i.name,
      COUNT(DISTINCT cs.id) as section_count,
      COUNT(DISTINCT c.id) as unique_courses,
      SUM(cs.max_capacity - cs.free_slots) as total_students,
      GROUP_CONCAT(DISTINCT c.course_code) as courses_taught
    FROM instructor i
    JOIN class_section cs ON cs.instructor_id = i.id
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN department d ON cs.department_id = d.id
    WHERE t.code = ? AND i.name NOT LIKE '%TBA%'
  `;
  
  const params: unknown[] = [term];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  query += `
    GROUP BY i.id 
    ORDER BY section_count DESC 
    LIMIT ?
  `;
  params.push(limit);
  
  const instructors = db.prepare(query).all(...params) as Array<{
    name: string;
    section_count: number;
    unique_courses: number;
    total_students: number;
    courses_taught: string;
  }>;
  
  return {
    term,
    total_found: instructors.length,
    instructors: instructors.map((ins, i) => ({
      rank: i + 1,
      name: ins.name,
      sections: ins.section_count,
      unique_courses: ins.unique_courses,
      total_students: ins.total_students,
      courses: ins.courses_taught ? ins.courses_taught.split(',').slice(0, 5) : []
    }))
  };
}
