/**
 * Get Popular Courses Tool
 * 
 * Returns courses ranked by enrollment or fill rate.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_popular_courses',
  description: 'Get courses ranked by enrollment or fill rate. Can show most or least popular.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code (e.g., "MATH", "CSCI")' 
      },
      sort_by: { 
        type: SchemaType.STRING, 
        description: 'Sort by: "enrolled_desc" (default), "enrolled_asc" (least popular), "fill_rate_desc", "fill_rate_asc"' 
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

export function handler(args: { department?: string; sort_by?: string; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 20, 50);
  
  // Determine sort order
  let orderBy = 'enrolled DESC';
  let sortLabel = 'most enrolled';
  const sortBy = (args.sort_by || 'enrolled_desc').toLowerCase();
  
  if (sortBy === 'enrolled_asc' || sortBy.includes('least')) {
    orderBy = 'enrolled ASC';
    sortLabel = 'least enrolled';
  } else if (sortBy === 'fill_rate_desc' || sortBy.includes('highest fill')) {
    orderBy = 'fill_rate DESC';
    sortLabel = 'highest fill rate';
  } else if (sortBy === 'fill_rate_asc' || sortBy.includes('lowest fill')) {
    orderBy = 'fill_rate ASC';
    sortLabel = 'lowest fill rate';
  }
  
  let query = `
    SELECT 
      c.course_code, 
      c.title, 
      c.units,
      d.code as department,
      SUM(cs.max_capacity - cs.free_slots) as enrolled,
      SUM(cs.max_capacity) as total_capacity,
      COUNT(cs.id) as section_count,
      ROUND(100.0 * SUM(cs.max_capacity - cs.free_slots) / SUM(cs.max_capacity), 1) as fill_rate
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN department d ON c.department_id = d.id
    WHERE t.code = ?
  `;
  
  const params: unknown[] = [term];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  query += `
    GROUP BY c.id 
    HAVING total_capacity > 0
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  params.push(limit);
  
  const courses = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    units: number;
    department: string | null;
    enrolled: number;
    total_capacity: number;
    section_count: number;
    fill_rate: number;
  }>;
  
  return {
    term,
    sorted_by: sortLabel,
    total_found: courses.length,
    courses: courses.map((c, i) => ({
      rank: i + 1,
      course_code: c.course_code,
      title: c.title,
      units: c.units,
      department: c.department,
      enrolled: c.enrolled,
      capacity: c.total_capacity,
      fill_rate: `${c.fill_rate}%`,
      sections: c.section_count
    }))
  };
}

