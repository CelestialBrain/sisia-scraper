/**
 * Get Course Sections Tool
 * 
 * STRICT: Only returns sections from database. Reports exact count.
 */

import { SchemaType } from '@google/generative-ai';
import { getCourseSections, getSimilarCourseCodes } from '../../models/Course.js';
import { normalizeCourseCode } from '../../utils/courseAliases.js';

export const definition = {
  name: 'get_course_sections',
  description: 'Get all sections for a specific course code. Returns ONLY database results with instructor, schedule, slots. If 0 sections found, report that - NEVER invent section data. Common abbreviations like CS, Math, Eng are accepted.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Course code (e.g., "CSCI 111", "CS 11", "Math 10")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['course_code'],
  },
};

export function handler(args: { course_code: string; term?: string }) {
  // Normalize course code (CS -> CSCI, Math -> MATH, etc.)
  const normalizedCode = normalizeCourseCode(args.course_code);
  
  const results = getCourseSections(
    normalizedCode,
    args.term || '2025-2'
  );
  
  // If no results, try to find similar course codes
  let suggestions: string[] = [];
  if (results.sections.length === 0) {
    suggestions = getSimilarCourseCodes(normalizedCode, args.term || '2025-2');
  }
  
  // Add enrolled count to each section
  const sectionsWithEnrolled = results.sections.map(s => ({
    ...s,
    enrolled: s.max_capacity - s.free_slots
  }));
  
  // Count unique instructors for accurate reporting
  const uniqueInstructors = new Set(
    sectionsWithEnrolled
      .map(s => s.instructor)
      .filter(i => i && i !== 'TBA, -')
  );
  
  return {
    sections: sectionsWithEnrolled,
    total: results.sections.length,
    unique_instructors_count: uniqueInstructors.size,
    course_code: normalizedCode,
    original_query: args.course_code !== normalizedCode ? args.course_code : undefined,
    similar_courses: suggestions.length > 0 ? suggestions : undefined,
    _format_hint: results.sections.length > 0 
      ? `This course has ${uniqueInstructors.size} unique instructors teaching ${results.sections.length} sections.`
      : undefined,
    _meta: results.sections.length === 0 
      ? { 
          message: suggestions.length > 0 
            ? `No exact match for "${normalizedCode}". Did you mean: ${suggestions.join(', ')}?`
            : `No sections found for ${normalizedCode}` 
        } 
      : undefined
  };
}

