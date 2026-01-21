/**
 * Get Instructor Schedule Tool
 * 
 * Get an instructor's teaching schedule for a term.
 */

import { SchemaType } from '@google/generative-ai';
import { getInstructorSchedule } from '../../models/Instructor.js';

export const definition = {
  name: 'get_instructor_schedule',
  description: 'Get teaching schedule for an instructor - what courses they teach and when.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      instructor_name: { 
        type: SchemaType.STRING, 
        description: 'Instructor name (full or partial)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      day: { 
        type: SchemaType.STRING, 
        description: 'Filter by day (Monday, Tuesday, etc.)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 50)' 
      },
    },
    required: ['instructor_name'],
  },
};

export function handler(args: { instructor_name: string; term?: string; day?: string; limit?: number }) {
  return getInstructorSchedule(
    args.instructor_name,
    args.term || '2025-2',
    args.day,
    args.limit || 50
  );
}
