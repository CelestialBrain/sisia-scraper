/**
 * Compare Instructors Tool
 * 
 * Side-by-side comparison of all instructors teaching the same course
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'compare_instructors',
  description: 'Compare all instructors teaching the same course side-by-side. Shows sections, times, rooms, and professor feedback scores. Useful for choosing the best section.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Course code to compare instructors for (e.g., "THEO 11", "CSCI 21")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['course_code'],
  },
};

interface InstructorSection {
  section: string;
  day: string;
  time: string;
  room: string;
  free_slots: number;
  max_capacity: number;
}

interface InstructorComparison {
  name: string;
  sections: InstructorSection[];
  section_count: number;
  feedback_score: number | null;
  feedback_count: number;
  sample_comments: string[];
}

export async function handler(args: { course_code: string; term?: string }) {
  const term = args.term || '2025-2';
  const courseCode = args.course_code.toUpperCase();
  
  // Get all sections for this course with instructor info
  const sections = db.prepare(`
    SELECT 
      cs.section,
      i.name as instructor,
      i.id as instructor_id,
      ss.day,
      ss.start_time,
      ss.end_time,
      r.code as room,
      cs.free_slots,
      cs.max_capacity
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    LEFT JOIN room r ON ss.room_id = r.id
    WHERE c.course_code = ? AND t.code = ?
    ORDER BY i.name, cs.section, ss.day
  `).all(courseCode, term) as {
    section: string;
    instructor: string | null;
    instructor_id: number | null;
    day: string | null;
    start_time: string | null;
    end_time: string | null;
    room: string | null;
    free_slots: number | null;
    max_capacity: number | null;
  }[];
  
  if (sections.length === 0) {
    return {
      course: courseCode,
      term,
      found: false,
      message: `No sections found for ${courseCode} in ${term}`
    };
  }
  
  // Group by instructor
  const instructorMap = new Map<string, InstructorComparison>();
  
  for (const row of sections) {
    const instrName = row.instructor || 'TBA';
    
    if (!instructorMap.has(instrName)) {
      instructorMap.set(instrName, {
        name: instrName,
        sections: [],
        section_count: 0,
        feedback_score: null,
        feedback_count: 0,
        sample_comments: []
      });
    }
    
    const instr = instructorMap.get(instrName)!;
    
    // Check if section already added
    const existingSection = instr.sections.find(s => s.section === row.section);
    if (!existingSection && row.section) {
      instr.sections.push({
        section: row.section,
        day: row.day || 'TBA',
        time: row.start_time && row.end_time ? `${row.start_time}-${row.end_time}` : 'TBA',
        room: row.room || 'TBA',
        free_slots: row.free_slots || 0,
        max_capacity: row.max_capacity || 0
      });
      instr.section_count = instr.sections.length;
    }
  }
  
  // Try to get feedback scores from profs scraper database
  // This assumes the feedback is in a separate database - we'll try to connect
  try {
    const Database = (await import('better-sqlite3')).default;
    const feedbackDb = new Database('/Users/angelonrevelo/Antigravity/sisia-chat/sisia-scraper/data/scraper.db', { readonly: true });
    
    for (const [name, instr] of instructorMap) {
      if (name === 'TBA') continue;
      
      // Get surname for matching
      const surname = name.split(',')[0]?.trim().toUpperCase();
      if (!surname) continue;
      
      const feedback = feedbackDb.prepare(`
        SELECT feedback_text, sentiment, reactions
        FROM professor_feedback
        WHERE UPPER(instructor_name_scraped) LIKE ?
        ORDER BY reactions DESC
        LIMIT 5
      `).all(`%${surname}%`) as { feedback_text: string; sentiment: string; reactions: number }[];
      
      if (feedback.length > 0) {
        instr.feedback_count = feedback.length;
        instr.sample_comments = feedback
          .slice(0, 3)
          .map(f => f.feedback_text?.substring(0, 100) || '')
          .filter(c => c.length > 10);
          
        // Calculate simple score based on sentiment
        const positiveCount = feedback.filter(f => f.sentiment === 'positive').length;
        instr.feedback_score = feedback.length > 0 ? Math.round((positiveCount / feedback.length) * 5 * 10) / 10 : null;
      }
    }
    
    feedbackDb.close();
  } catch {
    // Feedback database not available, continue without scores
  }
  
  // Convert to array and sort by feedback score (descending)
  const instructors = Array.from(instructorMap.values())
    .sort((a, b) => {
      if (a.feedback_score === null) return 1;
      if (b.feedback_score === null) return -1;
      return b.feedback_score - a.feedback_score;
    });
  
  return {
    course: courseCode,
    term,
    instructor_count: instructors.length,
    total_sections: sections.length,
    instructors,
    _format_hint: 'Present as a comparison table. Higher feedback_score is better (0-5 scale).'
  };
}
