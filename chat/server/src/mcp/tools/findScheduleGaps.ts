/**
 * Find Schedule Gaps Tool
 * 
 * Find free time slots in a personal schedule or between specified sections
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'find_schedule_gaps',
  description: 'Find free time gaps in a schedule. Can find gaps between classes on specific days, useful for finding study time or lunch breaks. Also suggests free rooms during those gaps.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sections: { 
        type: SchemaType.ARRAY,
        description: 'Array of enrolled sections (e.g., ["CSCI 21 A", "THEO 11 D2"])',
        items: { type: SchemaType.STRING }
      },
      day: { 
        type: SchemaType.STRING, 
        description: 'Filter by specific day (e.g., "Monday")' 
      },
      min_duration_minutes: { 
        type: SchemaType.NUMBER, 
        description: 'Minimum gap duration to report (default: 30)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      suggest_rooms: { 
        type: SchemaType.BOOLEAN, 
        description: 'Include nearby free rooms during gaps (default: true)' 
      },
    },
    required: ['sections'],
  },
};

interface ScheduleSlot {
  course: string;
  section: string;
  day: string;
  start_time: string;
  end_time: string;
  room: string;
}

interface Gap {
  day: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  before_class: string | null;
  after_class: string | null;
  free_rooms?: string[];
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function handler(args: { 
  sections: string[]; 
  day?: string;
  min_duration_minutes?: number;
  term?: string;
  suggest_rooms?: boolean;
}) {
  const term = args.term || '2025-2';
  const minDuration = args.min_duration_minutes || 30;
  const suggestRooms = args.suggest_rooms !== false;
  
  // Parse sections input
  const sectionQueries = args.sections.map(s => {
    const parts = s.trim().split(/\s+/);
    const section = parts.pop();
    const courseCode = parts.join(' ');
    return { courseCode, section };
  });
  
  // Get schedule for all sections
  const schedule: ScheduleSlot[] = [];
  
  for (const query of sectionQueries) {
    const rows = db.prepare(`
      SELECT 
        c.course_code as course,
        cs.section,
        ss.day,
        ss.start_time,
        ss.end_time,
        r.code as room
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
      LEFT JOIN room r ON ss.room_id = r.id
      WHERE c.course_code = ? AND cs.section = ? AND t.code = ?
    `).all(query.courseCode, query.section, term) as ScheduleSlot[];
    
    schedule.push(...rows.filter(r => r.day && r.start_time));
  }
  
  if (schedule.length === 0) {
    return {
      success: false,
      message: 'No schedule data found for the specified sections',
      sections_requested: args.sections
    };
  }
  
  // Group by day
  const byDay = new Map<string, ScheduleSlot[]>();
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (const slot of schedule) {
    if (args.day && slot.day !== args.day) continue;
    const existing = byDay.get(slot.day) || [];
    existing.push(slot);
    byDay.set(slot.day, existing);
  }
  
  // Find gaps for each day
  const gaps: Gap[] = [];
  const dayStart = 7 * 60;  // 7:00 AM
  const dayEnd = 21 * 60;   // 9:00 PM
  
  for (const [day, slots] of byDay) {
    // Sort by start time
    const sorted = [...slots].sort((a, b) => 
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
    );
    
    // Find gaps between classes
    let prevEnd = dayStart;
    let prevClass: string | null = null;
    
    for (const slot of sorted) {
      const start = timeToMinutes(slot.start_time);
      const end = timeToMinutes(slot.end_time);
      
      if (start > prevEnd) {
        const gapDuration = start - prevEnd;
        if (gapDuration >= minDuration) {
          const gap: Gap = {
            day,
            start_time: minutesToTime(prevEnd),
            end_time: minutesToTime(start),
            duration_minutes: gapDuration,
            before_class: prevClass,
            after_class: `${slot.course} ${slot.section}`
          };
          
          // Find free rooms during this gap
          if (suggestRooms) {
            const midTime = prevEnd + Math.floor(gapDuration / 2);
            const freeRooms = db.prepare(`
              SELECT r.code
              FROM room r
              WHERE r.id NOT IN (
                SELECT DISTINCT ss.room_id
                FROM schedule_slot ss
                JOIN class_section cs ON ss.section_id = cs.id
                JOIN term t ON cs.term_id = t.id
                WHERE t.code = ? AND ss.day = ?
                AND CAST(REPLACE(ss.start_time, ':', '') AS INTEGER) <= ?
                AND CAST(REPLACE(ss.end_time, ':', '') AS INTEGER) > ?
              )
              AND r.code LIKE 'CTC%' OR r.code LIKE 'SEC%'
              LIMIT 5
            `).all(term, day, midTime * 100 / 60, midTime * 100 / 60) as { code: string }[];
            
            gap.free_rooms = freeRooms.map(r => r.code);
          }
          
          gaps.push(gap);
        }
      }
      
      prevEnd = Math.max(prevEnd, end);
      prevClass = `${slot.course} ${slot.section}`;
    }
    
    // Check gap at end of day
    if (prevEnd < dayEnd) {
      const gapDuration = dayEnd - prevEnd;
      if (gapDuration >= minDuration && gapDuration < 12 * 60) { // Don't report overnight
        gaps.push({
          day,
          start_time: minutesToTime(prevEnd),
          end_time: minutesToTime(dayEnd),
          duration_minutes: gapDuration,
          before_class: prevClass,
          after_class: null
        });
      }
    }
  }
  
  // Sort by day then time
  gaps.sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
  
  // Calculate summary
  const totalGapMinutes = gaps.reduce((sum, g) => sum + g.duration_minutes, 0);
  const longestGap = gaps.reduce((max, g) => g.duration_minutes > max.duration_minutes ? g : max, gaps[0]);
  
  return {
    sections_analyzed: args.sections,
    gaps_found: gaps.length,
    gaps,
    summary: {
      total_free_time: `${Math.floor(totalGapMinutes / 60)}h ${totalGapMinutes % 60}m`,
      longest_gap: longestGap ? {
        day: longestGap.day,
        duration: `${Math.floor(longestGap.duration_minutes / 60)}h ${longestGap.duration_minutes % 60}m`,
        time: `${longestGap.start_time}-${longestGap.end_time}`
      } : null,
      days_with_gaps: [...new Set(gaps.map(g => g.day))]
    },
    _format_hint: 'Present gaps as a table with day, time range, duration, and what classes are before/after.'
  };
}
