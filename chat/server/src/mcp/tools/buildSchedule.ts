/**
 * Build Schedule Tool
 * 
 * Builds a conflict-free schedule from multiple courses.
 */

import { SchemaType } from '@google/generative-ai';
import { buildSchedule } from '../../models/ClassSection.js';
import { normalizeCourseCodes } from '../../utils/courseAliases.js';

export const definition = {
  name: 'build_schedule',
  description: 'Build a conflict-free class schedule from multiple courses. Returns weekly grid view. Supports time constraints, day preferences, and schedule style preferences.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      courses: { 
        type: SchemaType.STRING, 
        description: 'Comma-separated course codes (e.g., "CSCI 111, MATH 30.13, ENGL 11"). Common abbreviations like CS, Math, Eng are accepted.' 
      },
      morning_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only include morning classes (before 12:00)' 
      },
      no_saturday: { 
        type: SchemaType.BOOLEAN, 
        description: 'Exclude Saturday classes' 
      },
      no_friday: { 
        type: SchemaType.BOOLEAN, 
        description: 'Exclude Friday classes' 
      },
      exclude_days: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: 'List of specific days to exclude (e.g., ["Monday", "Wednesday"])'
      },
      include_days: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: 'Prefer sections on these specific days (e.g., ["Tuesday", "Friday"] for T/F schedule)'
      },
      start_after: {
        type: SchemaType.STRING,
        description: 'Only include classes starting at or after this time (e.g., "13:00" for afternoon only)'
      },
      start_before: {
        type: SchemaType.STRING,
        description: 'Only include classes starting before this time (e.g., "12:00" for morning only)'
      },
      end_before: {
        type: SchemaType.STRING,
        description: 'Only include classes that end before this time (e.g., "17:00" to finish by 5pm, "15:00" for early finish)'
      },
      building_filter: {
        type: SchemaType.STRING,
        description: 'Only include sections in this building (e.g., "SEC", "CTC", "G" for Gonzaga)'
      },
      prefer_breaks: {
        type: SchemaType.BOOLEAN,
        description: 'Prefer spaced out schedule with breaks between classes (avoid back-to-back classes)'
      },
      prefer_compact: {
        type: SchemaType.BOOLEAN,
        description: 'Prefer compact schedule with back-to-back classes (minimize waiting time)'
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['courses'],
  },
};

export function handler(args: { 
  courses: string; 
  morning_only?: boolean; 
  no_saturday?: boolean; 
  no_friday?: boolean;
  exclude_days?: string[];
  include_days?: string[];
  start_after?: string;
  start_before?: string;
  end_before?: string;
  building_filter?: string;
  prefer_breaks?: boolean;
  prefer_compact?: boolean;
  term?: string 
}) {
  // Normalize course codes to handle abbreviations like CS -> CSCI
  const normalizedCourses = normalizeCourseCodes(args.courses);
  const courseCodes = normalizedCourses.split(',').map(c => c.trim());
  
  return buildSchedule(
    courseCodes,
    { 
      morning_only: args.morning_only, 
      no_saturday: args.no_saturday,
      no_friday: args.no_friday,
      exclude_days: args.exclude_days,
      include_days: args.include_days,
      start_after: args.start_after,
      start_before: args.start_before,
      end_before: args.end_before,
      building_filter: args.building_filter,
      prefer_breaks: args.prefer_breaks,
      prefer_compact: args.prefer_compact
    },
    args.term || '2025-2'
  );
}
