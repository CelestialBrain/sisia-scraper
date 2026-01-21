/**
 * Search Instructors Tool
 * 
 * STRICT: Only returns instructors from database. Reports exact count.
 */

import { SchemaType } from '@google/generative-ai';
import { searchInstructors } from '../../models/Instructor.js';

export const definition = {
  name: 'search_instructors',
  description: 'Search for instructors by name. Returns ONLY database results. If 0 found, report that - NEVER guess instructor names.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      name: { 
        type: SchemaType.STRING, 
        description: 'Instructor name (partial match, e.g., "Garcia", "Juan")' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 20)' 
      },
    },
    required: ['name'],
  },
};

export function handler(args: { name: string; limit?: number }) {
  const results = searchInstructors(args.name, args.limit || 20);
  const count = results.instructors.length;
  
  return {
    instructors: results.instructors,
    total: count,
    query: args.name,
    _format_hint: count > 0 
      ? `Found exactly ${count} instructor${count === 1 ? '' : 's'}. List them as a numbered or bulleted list.`
      : undefined,
    _meta: count === 0 ? { message: `No instructors found matching "${args.name}"` } : undefined
  };
}
