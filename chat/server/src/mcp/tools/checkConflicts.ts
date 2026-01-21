/**
 * Check Conflicts Tool
 * 
 * Detects schedule conflicts between two specific sections.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';
import { normalizeCourseCode } from '../../utils/courseAliases.js';

export const definition = {
  name: 'check_conflicts',
  description: 'Check if two class sections have a schedule conflict. Use this when comparing sections from different courses.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      section1: { 
        type: SchemaType.STRING, 
        description: 'First section in format "COURSE_CODE SECTION" (e.g., "MATH 10 A1")' 
      },
      section2: { 
        type: SchemaType.STRING, 
        description: 'Second section in format "COURSE_CODE SECTION" (e.g., "ENGL 11 B")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['section1', 'section2'],
  },
};

interface ScheduleSlot {
  day: string;
  start_time: string;
  end_time: string;
}

interface SectionInfo {
  course_code: string;
  section: string;
  instructor: string | null;
  schedule: ScheduleSlot[];
}

function parseSectionInput(input: string): { courseCode: string; section: string } | null {
  // Handle formats like "MATH 10 A1", "CSCI 11 B", "ENGL 11.1 C"
  const match = input.trim().match(/^([A-Z]+\s+\d+\.?\d*)\s+(.+)$/i);
  if (match) {
    return {
      courseCode: normalizeCourseCode(match[1]),
      section: match[2].trim().toUpperCase()
    };
  }
  return null;
}

function getSectionSchedule(courseCode: string, section: string, term: string): SectionInfo | null {
  const rows = db.prepare(`
    SELECT c.course_code, cs.section, i.name as instructor,
           ss.day, ss.start_time, ss.end_time
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    WHERE c.course_code = ? AND cs.section = ? AND t.code = ?
  `).all(courseCode, section, term) as Array<{
    course_code: string;
    section: string;
    instructor: string | null;
    day: string;
    start_time: string;
    end_time: string;
  }>;

  if (rows.length === 0) return null;

  return {
    course_code: rows[0].course_code,
    section: rows[0].section,
    instructor: rows[0].instructor,
    schedule: rows
      .filter(r => r.day && r.start_time)
      .map(r => ({ day: r.day, start_time: r.start_time, end_time: r.end_time }))
  };
}

function checkTimeConflict(s1: ScheduleSlot, s2: ScheduleSlot): boolean {
  if (s1.day !== s2.day) return false;
  
  const start1 = parseInt(s1.start_time.replace(':', ''));
  const end1 = parseInt(s1.end_time.replace(':', ''));
  const start2 = parseInt(s2.start_time.replace(':', ''));
  const end2 = parseInt(s2.end_time.replace(':', ''));
  
  // Overlap if one starts before the other ends
  return start1 < end2 && start2 < end1;
}

export function handler(args: { section1: string; section2: string; term?: string }) {
  const term = args.term || '2025-2';
  
  // Parse section inputs
  const parsed1 = parseSectionInput(args.section1);
  const parsed2 = parseSectionInput(args.section2);
  
  if (!parsed1) {
    return { 
      error: `Could not parse section1: "${args.section1}". Expected format: "COURSE_CODE SECTION" (e.g., "MATH 10 A1")`,
      has_conflict: null 
    };
  }
  
  if (!parsed2) {
    return { 
      error: `Could not parse section2: "${args.section2}". Expected format: "COURSE_CODE SECTION" (e.g., "ENGL 11 B")`,
      has_conflict: null 
    };
  }
  
  // Get section schedules
  const section1Info = getSectionSchedule(parsed1.courseCode, parsed1.section, term);
  const section2Info = getSectionSchedule(parsed2.courseCode, parsed2.section, term);
  
  if (!section1Info) {
    return { 
      error: `Section not found: ${parsed1.courseCode} ${parsed1.section} in term ${term}`,
      has_conflict: null,
      section1_found: false,
      section2_found: !!section2Info
    };
  }
  
  if (!section2Info) {
    return { 
      error: `Section not found: ${parsed2.courseCode} ${parsed2.section} in term ${term}`,
      has_conflict: null,
      section1_found: true,
      section2_found: false
    };
  }
  
  // Check for conflicts
  const conflicts: Array<{ slot1: ScheduleSlot; slot2: ScheduleSlot }> = [];
  
  for (const s1 of section1Info.schedule) {
    for (const s2 of section2Info.schedule) {
      if (checkTimeConflict(s1, s2)) {
        conflicts.push({ slot1: s1, slot2: s2 });
      }
    }
  }
  
  if (conflicts.length === 0) {
    return {
      has_conflict: false,
      message: `No conflict between ${section1Info.course_code} ${section1Info.section} and ${section2Info.course_code} ${section2Info.section}.`,
      section1: {
        course: section1Info.course_code,
        section: section1Info.section,
        instructor: section1Info.instructor || 'TBA',
        schedule: section1Info.schedule.map(s => `${s.day} ${s.start_time}-${s.end_time}`).join(', ')
      },
      section2: {
        course: section2Info.course_code,
        section: section2Info.section,
        instructor: section2Info.instructor || 'TBA',
        schedule: section2Info.schedule.map(s => `${s.day} ${s.start_time}-${s.end_time}`).join(', ')
      }
    };
  }
  
  // Format conflict details
  const conflictDetails = conflicts.map(c => 
    `${c.slot1.day}: ${c.slot1.start_time}-${c.slot1.end_time} overlaps with ${c.slot2.start_time}-${c.slot2.end_time}`
  ).join('; ');
  
  return {
    has_conflict: true,
    conflict_count: conflicts.length,
    message: `CONFLICT DETECTED between ${section1Info.course_code} ${section1Info.section} and ${section2Info.course_code} ${section2Info.section}.`,
    details: conflictDetails,
    section1: {
      course: section1Info.course_code,
      section: section1Info.section,
      instructor: section1Info.instructor || 'TBA'
    },
    section2: {
      course: section2Info.course_code,
      section: section2Info.section,
      instructor: section2Info.instructor || 'TBA'
    }
  };
}
