/**
 * List Departments Tool
 * Returns all departments and their courses
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'list_departments',
  description: `List all academic departments and optionally their course counts.
Use this when users ask about departments, schools, or which department offers a course.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      include_courses: {
        type: SchemaType.BOOLEAN,
        description: 'Include course count per department (default: false)'
      },
      search: {
        type: SchemaType.STRING,
        description: 'Optional search term to filter departments'
      }
    },
    required: []
  }
};

export function handler(args: { include_courses?: boolean; search?: string }) {
  const { include_courses = false, search } = args;
  
  let query: string;
  
  if (include_courses) {
    query = `
      SELECT 
        d.code,
        d.name,
        COUNT(DISTINCT c.id) as course_count,
        COUNT(DISTINCT cs.id) as section_count
      FROM department d
      LEFT JOIN course c ON c.department_id = d.id
      LEFT JOIN class_section cs ON cs.department_id = d.id
      ${search ? "WHERE d.name LIKE ? OR d.code LIKE ?" : ''}
      GROUP BY d.id
      ORDER BY d.name
    `;
  } else {
    query = `
      SELECT d.code, d.name
      FROM department d
      ${search ? "WHERE d.name LIKE ? OR d.code LIKE ?" : ''}
      ORDER BY d.name
    `;
  }
  
  const params = search ? [`%${search}%`, `%${search}%`] : [];
  const results = db.prepare(query).all(...params) as { 
    code: string; 
    name: string; 
    course_count?: number; 
    section_count?: number 
  }[];
  
  return {
    departments: results.map(d => ({
      code: d.code,
      name: d.name,
      ...(include_courses ? { 
        course_count: d.course_count,
        section_count: d.section_count
      } : {})
    })),
    total_count: results.length
  };
}
