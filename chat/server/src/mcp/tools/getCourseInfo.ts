/**
 * Get Course Info Tool
 * 
 * Returns detailed information about a course (units, department, description).
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';
import { normalizeCourseCode } from '../../utils/courseAliases.js';

export const definition = {
  name: 'get_course_info',
  description: 'Get detailed information about a course including units, department, and whether it is offered this term. Common abbreviations like CS, Math, Eng are accepted.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Course code (e.g., "MATH 10", "CS 11", "PHILO 11")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term to check offering status (default: 2025-2)' 
      },
    },
    required: ['course_code'],
  },
};

export function handler(args: { course_code: string; term?: string }) {
  const term = args.term || '2025-2';
  const normalizedCode = normalizeCourseCode(args.course_code);
  
  // Get course details
  const course = db.prepare(`
    SELECT c.course_code, c.title, c.units, d.code as department, d.name as department_name
    FROM course c
    LEFT JOIN department d ON c.department_id = d.id
    WHERE c.course_code = ?
  `).get(normalizedCode) as { 
    course_code: string; 
    title: string; 
    units: number; 
    department: string | null;
    department_name: string | null;
  } | undefined;
  
  if (!course) {
    // Try partial match
    const partial = db.prepare(`
      SELECT c.course_code, c.title, c.units, d.code as department, d.name as department_name
      FROM course c
      LEFT JOIN department d ON c.department_id = d.id
      WHERE c.course_code LIKE ?
      LIMIT 5
    `).all(`%${normalizedCode}%`) as Array<{ 
      course_code: string; 
      title: string; 
      units: number; 
      department: string | null;
      department_name: string | null;
    }>;
    
    if (partial.length === 0) {
      return { 
        error: `Course not found: ${normalizedCode}`,
        original_query: args.course_code !== normalizedCode ? args.course_code : undefined
      };
    }
    
    return {
      message: `Exact match not found for "${normalizedCode}". Did you mean one of these?`,
      suggestions: partial.map(c => ({ code: c.course_code, title: c.title, units: c.units })),
      original_query: args.course_code !== normalizedCode ? args.course_code : undefined
    };
  }
  
  // Check if offered this term
  const sectionCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    WHERE c.course_code = ? AND t.code = ?
  `).get(normalizedCode, term) as { count: number };
  
  // Get prerequisite info if available
  const prereq = db.prepare(`
    SELECT cc.prerequisites_raw, cc.corequisites_raw
    FROM curriculum_course cc
    JOIN course c ON cc.course_id = c.id
    WHERE c.course_code = ?
    LIMIT 1
  `).get(normalizedCode) as { prerequisites_raw: string | null; corequisites_raw: string | null } | undefined;
  
  return {
    course_code: course.course_code,
    title: course.title,
    units: course.units,
    department: course.department,
    department_name: course.department_name,
    offered_this_term: sectionCount.count > 0,
    section_count: sectionCount.count,
    term_checked: term,
    prerequisites: prereq?.prerequisites_raw || null,
    corequisites: prereq?.corequisites_raw || null,
    original_query: args.course_code !== normalizedCode ? args.course_code : undefined
  };
}
