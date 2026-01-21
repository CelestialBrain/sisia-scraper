/**
 * Search Courses Tool
 * 
 * Allows searching for courses by code or title.
 * STRICT: Only returns data from database - NEVER fabricate results.
 */

import { SchemaType } from '@google/generative-ai';
import { searchCourses } from '../../models/Course.js';

export const definition = {
  name: 'search_courses',
  description: 'Search for courses by code or title. ONLY returns actual database results - if empty, report 0 found. NEVER invent courses.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { 
        type: SchemaType.STRING, 
        description: 'Course code (e.g., "CSCI 111", "MATH 30.13") or title keyword' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 20)' 
      },
    },
    required: ['query'],
  },
};

export function handler(args: { query: string; term?: string; limit?: number }) {
  const results = searchCourses(
    args.query,
    args.term || '2025-2',
    args.limit || 20
  );
  
  // Add explicit count to help AI
  return {
    ...results,
    _meta: { 
      count: Array.isArray(results) ? results.length : 0,
      message: Array.isArray(results) && results.length === 0 
        ? 'No courses found matching this query.'
        : undefined
    }
  };
}
