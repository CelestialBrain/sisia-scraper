/**
 * Search By Natural Time Tool
 * 
 * Search for classes using natural language time preferences.
 */

import { SchemaType } from '@google/generative-ai';
import { searchByNaturalTime } from '../../models/ClassSection.js';

export const definition = {
  name: 'search_by_natural_time',
  description: 'Search for classes using natural language like "morning MWF", "no 7am", "afternoon only".',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { 
        type: SchemaType.STRING, 
        description: 'Time preference query (e.g., "morning only", "no 7am", "MWF afternoon")' 
      },
      course_filter: { 
        type: SchemaType.STRING, 
        description: 'Filter by course code prefix (e.g., "CSCI", "MATH")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 30)' 
      },
    },
    required: ['query'],
  },
};

export function handler(args: { query: string; course_filter?: string; term?: string; limit?: number }) {
  return searchByNaturalTime(
    args.query,
    args.course_filter,
    args.term || '2025-2',
    args.limit || 30
  );
}
