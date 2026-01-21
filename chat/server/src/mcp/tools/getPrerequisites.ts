/**
 * Get Prerequisites Tool
 * Returns prerequisites for a course from curriculum data
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';
import { normalizeCourseCode } from '../../utils/courseAliases.js';

export const definition = {
  name: 'get_prerequisites',
  description: `Get prerequisites for a course. Returns the prerequisite courses and which programs require them. Common abbreviations like CS, Math, Eng are accepted.
IMPORTANT: Only report prerequisites that exist in the results. Do not hallucinate.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: {
        type: SchemaType.STRING,
        description: 'Course code (e.g., "MATH 31.3", "CS 30", "Phil 11")'
      }
    },
    required: ['course_code']
  }
};

export function handler(args: { course_code: string }) {
  // Normalize course code (CS -> CSCI, Math -> MATH, etc.)
  const course_code = normalizeCourseCode(args.course_code);
  
  const results = db.prepare(`
    SELECT 
      c.course_code,
      c.title,
      cc.prerequisites_raw,
      cc.corequisites_raw,
      cc.year,
      cc.semester,
      dp.name as program_name
    FROM curriculum_course cc
    JOIN course c ON cc.course_id = c.id
    JOIN degree_program dp ON cc.degree_id = dp.id
    WHERE c.course_code LIKE ?
    AND (cc.prerequisites_raw IS NOT NULL AND cc.prerequisites_raw != '')
    LIMIT 20
  `).all(`%${course_code}%`) as {
    course_code: string;
    title: string;
    prerequisites_raw: string;
    corequisites_raw: string;
    year: number;
    semester: number;
    program_name: string;
  }[];
  
  if (results.length === 0) {
    // Check if course exists
    const course = db.prepare(`
      SELECT course_code, title FROM course WHERE course_code LIKE ?
    `).get(`%${course_code}%`) as { course_code: string; title: string } | undefined;
    
    if (course) {
      return {
        course_code: course.course_code,
        title: course.title,
        message: 'No prerequisite information found in curriculum data for this course.'
      };
    }
    return { error: 'Course not found' };
  }
  
  return {
    course_code: results[0].course_code,
    title: results[0].title,
    prerequisites: results.map(r => ({
      program: r.program_name,
      prerequisites: r.prerequisites_raw,
      corequisites: r.corequisites_raw,
      year: r.year,
      semester: r.semester
    })),
    result_count: results.length
  };
}
