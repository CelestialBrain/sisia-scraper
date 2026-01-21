/**
 * Compare Sections Tool
 * 
 * Compare all sections of a course by slots, time, or instructor.
 */

import { SchemaType } from '@google/generative-ai';
import { compareSections } from '../../models/Course.js';
import { normalizeCourseCode } from '../../utils/courseAliases.js';

export const definition = {
  name: 'compare_sections',
  description: 'Compare all sections of a course, sorted by available slots, time, or instructor. Common abbreviations like CS, Math, Eng are accepted.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Course code to compare sections of (e.g., "MATH 10", "CS 11")' 
      },
      sort_by: { 
        type: SchemaType.STRING, 
        description: 'Sort by: "slots" (most available), "time" (earliest), or "instructor" (alphabetical). Default: slots' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['course_code'],
  },
};

export function handler(args: { course_code: string; sort_by?: string; term?: string }) {
  // Normalize course code (CS -> CSCI, Math -> MATH, etc.)
  const normalizedCode = normalizeCourseCode(args.course_code);
  
  return compareSections(
    normalizedCode, 
    args.term || '2025-2', 
    args.sort_by || 'slots'
  );
}

