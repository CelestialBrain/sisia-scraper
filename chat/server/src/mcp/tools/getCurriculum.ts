/**
 * Get Curriculum Tool
 * 
 * Returns curriculum for a degree program.
 */

import { SchemaType } from '@google/generative-ai';
import { getCurriculum } from '../../models/Curriculum.js';

export const definition = {
  name: 'get_curriculum',
  description: 'Get the curriculum/course plan for a degree program. If year and semester are omitted, returns the FULL curriculum for all years. For personal course status (passed/remaining) use get_my_ips instead.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      program: { 
        type: SchemaType.STRING, 
        description: 'Program code or name (e.g., "CS", "BS Management Engineering", "CSCI")' 
      },
      version: { 
        type: SchemaType.STRING, 
        description: 'Curriculum version year (e.g., "2020")' 
      },
      year: { 
        type: SchemaType.NUMBER, 
        description: 'Filter by year level (1-4)' 
      },
      semester: { 
        type: SchemaType.NUMBER, 
        description: 'Filter by semester (1 or 2)' 
      },
    },
    required: ['program'],
  },
};

export function handler(args: { program: string; version?: string; year?: number; semester?: number }) {
  return getCurriculum(args.program, args.version, args.year, args.semester);
}
