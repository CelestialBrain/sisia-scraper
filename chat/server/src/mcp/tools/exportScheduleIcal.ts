/**
 * Export Schedule to iCal Tool
 * 
 * Export personal schedule to iCal format for calendar apps
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'export_schedule_ical',
  description: 'Export a class schedule to iCal (.ics) format. Can export personal schedule or any course schedule. The resulting iCal can be imported into Google Calendar, Apple Calendar, Outlook, etc.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sections: { 
        type: SchemaType.ARRAY,
        description: 'Array of sections to export (e.g., ["CSCI 21 A", "THEO 11 D2"]). If not provided, will try to generate sample.',
        items: { type: SchemaType.STRING }
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      semester_start: { 
        type: SchemaType.STRING, 
        description: 'Semester start date in YYYY-MM-DD format (default: 2025-01-13)' 
      },
      semester_end: { 
        type: SchemaType.STRING, 
        description: 'Semester end date in YYYY-MM-DD format (default: 2025-05-16)' 
      },
      include_location: { 
        type: SchemaType.BOOLEAN, 
        description: 'Include room as location (default: true)' 
      },
    },
    required: ['sections'],
  },
};

const DAY_MAP: Record<string, number> = {
  'Monday': 0,
  'Tuesday': 1,
  'Wednesday': 2,
  'Thursday': 3,
  'Friday': 4,
  'Saturday': 5,
  'Sunday': 6
};

const DAY_ABBREV: Record<string, string> = {
  'Monday': 'MO',
  'Tuesday': 'TU',
  'Wednesday': 'WE',
  'Thursday': 'TH',
  'Friday': 'FR',
  'Saturday': 'SA',
  'Sunday': 'SU'
};

function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

export function handler(args: { 
  sections: string[]; 
  term?: string;
  semester_start?: string;
  semester_end?: string;
  include_location?: boolean;
}) {
  const term = args.term || '2025-2';
  const semesterStart = new Date(args.semester_start || '2025-01-13');
  const semesterEnd = new Date(args.semester_end || '2025-05-16');
  const includeLocation = args.include_location !== false;
  
  // Parse sections input (e.g., "CSCI 21 A" -> course_code: "CSCI 21", section: "A")
  const sectionQueries = args.sections.map(s => {
    const parts = s.trim().split(/\s+/);
    const section = parts.pop();
    const courseCode = parts.join(' ');
    return { courseCode, section };
  });
  
  // Get schedule data for all sections
  const events: {
    course: string;
    section: string;
    instructor: string;
    room: string;
    day: string;
    startTime: string;
    endTime: string;
  }[] = [];
  
  for (const query of sectionQueries) {
    const rows = db.prepare(`
      SELECT 
        c.course_code,
        cs.section,
        i.name as instructor,
        r.code as room,
        ss.day,
        ss.start_time,
        ss.end_time
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      LEFT JOIN instructor i ON cs.instructor_id = i.id
      LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
      LEFT JOIN room r ON ss.room_id = r.id
      WHERE c.course_code = ? AND cs.section = ? AND t.code = ?
    `).all(query.courseCode, query.section, term) as {
      course_code: string;
      section: string;
      instructor: string | null;
      room: string | null;
      day: string | null;
      start_time: string | null;
      end_time: string | null;
    }[];
    
    for (const row of rows) {
      if (row.day && row.start_time && row.end_time) {
        events.push({
          course: row.course_code,
          section: row.section,
          instructor: row.instructor || 'TBA',
          room: row.room || 'TBA',
          day: row.day,
          startTime: row.start_time,
          endTime: row.end_time
        });
      }
    }
  }
  
  if (events.length === 0) {
    return {
      success: false,
      message: 'No schedule data found for the specified sections',
      sections_requested: args.sections
    };
  }
  
  // Generate iCal content
  const icalLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SISIA Chat//Class Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Class Schedule ${term}`
  ];
  
  const now = new Date();
  const dtstamp = formatICalDate(now);
  
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const dayOffset = DAY_MAP[event.day];
    if (dayOffset === undefined) continue;
    
    // Find first occurrence of this day after semester start
    const firstDate = new Date(semesterStart);
    const currentDay = firstDate.getDay();
    const targetDay = (dayOffset + 1) % 7; // Adjust for Sunday = 0
    const daysToAdd = (targetDay - currentDay + 7) % 7;
    firstDate.setDate(firstDate.getDate() + daysToAdd);
    
    // Set start and end times
    const startParts = parseTime(event.startTime);
    const endParts = parseTime(event.endTime);
    
    const startDate = new Date(firstDate);
    startDate.setHours(startParts.hours, startParts.minutes, 0, 0);
    
    const endDate = new Date(firstDate);
    endDate.setHours(endParts.hours, endParts.minutes, 0, 0);
    
    const uid = `sisia-${term}-${event.course.replace(/\s/g, '')}-${event.section}-${event.day}-${i}@sisia.chat`;
    
    icalLines.push('BEGIN:VEVENT');
    icalLines.push(`UID:${uid}`);
    icalLines.push(`DTSTAMP:${dtstamp}`);
    icalLines.push(`DTSTART;TZID=Asia/Manila:${formatLocalDate(startDate)}`);
    icalLines.push(`DTEND;TZID=Asia/Manila:${formatLocalDate(endDate)}`);
    icalLines.push(`RRULE:FREQ=WEEKLY;UNTIL=${formatICalDate(semesterEnd)};BYDAY=${DAY_ABBREV[event.day]}`);
    icalLines.push(`SUMMARY:${event.course} ${event.section}`);
    icalLines.push(`DESCRIPTION:Instructor: ${event.instructor}`);
    if (includeLocation && event.room !== 'TBA') {
      icalLines.push(`LOCATION:${event.room}`);
    }
    icalLines.push('END:VEVENT');
  }
  
  icalLines.push('END:VCALENDAR');
  
  const icalContent = icalLines.join('\r\n');
  
  return {
    success: true,
    events_count: events.length,
    sections_included: [...new Set(events.map(e => `${e.course} ${e.section}`))],
    semester: {
      start: args.semester_start || '2025-01-13',
      end: args.semester_end || '2025-05-16'
    },
    ical_content: icalContent,
    _format_hint: 'The ical_content can be saved as a .ics file and imported into any calendar app. You can also provide this as a downloadable link.'
  };
}
