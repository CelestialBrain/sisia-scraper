/**
 * Get Room Stats Tool
 * 
 * Aggregate statistics about room usage
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_room_stats',
  description: 'Get aggregate statistics about room usage: most used rooms, rooms by building, average occupancy, and utilization rates. Useful for finding busy or quiet areas on campus.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      building: { 
        type: SchemaType.STRING, 
        description: 'Filter by building (e.g., "CTC", "SEC", "PLDT")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      sort_by: { 
        type: SchemaType.STRING, 
        description: 'Sort by: "usage" (most classes), "hours" (most hours), or "name" (alphabetical)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 20)' 
      },
    },
    required: [],
  },
};

interface RoomUsageStat {
  room_code: string;
  building: string | null;
  class_count: number;
  total_hours: number;
  unique_courses: number;
  unique_instructors: number;
  days_used: string;
}

export function handler(args: { 
  building?: string; 
  term?: string; 
  sort_by?: string;
  limit?: number 
}) {
  const term = args.term || '2025-2';
  const limit = args.limit || 20;
  const sortBy = args.sort_by || 'usage';
  
  // Get room usage stats
  let query = `
    SELECT 
      r.code as room_code,
      r.building,
      COUNT(DISTINCT cs.id) as class_count,
      ROUND(SUM(
        (CAST(SUBSTR(ss.end_time, 1, 2) AS REAL) * 60 + CAST(SUBSTR(ss.end_time, 4, 2) AS REAL) -
         CAST(SUBSTR(ss.start_time, 1, 2) AS REAL) * 60 - CAST(SUBSTR(ss.start_time, 4, 2) AS REAL)) / 60.0
      ), 1) as total_hours,
      COUNT(DISTINCT c.id) as unique_courses,
      COUNT(DISTINCT i.id) as unique_instructors,
      GROUP_CONCAT(DISTINCT ss.day) as days_used
    FROM room r
    JOIN schedule_slot ss ON ss.room_id = r.id
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    WHERE t.code = ?
  `;
  
  const params: unknown[] = [term];
  
  if (args.building) {
    query += ` AND (r.building LIKE ? OR r.code LIKE ?)`;
    params.push(`%${args.building}%`, `${args.building}%`);
  }
  
  query += ` GROUP BY r.id`;
  
  // Sort order
  if (sortBy === 'hours') {
    query += ` ORDER BY total_hours DESC`;
  } else if (sortBy === 'name') {
    query += ` ORDER BY r.code ASC`;
  } else {
    query += ` ORDER BY class_count DESC`;
  }
  
  query += ` LIMIT ?`;
  params.push(limit);
  
  const stats = db.prepare(query).all(...params) as RoomUsageStat[];
  
  // Get building summary
  const buildingSummary = db.prepare(`
    SELECT 
      COALESCE(r.building, 'Unknown') as building,
      COUNT(DISTINCT r.id) as room_count,
      COUNT(DISTINCT cs.id) as total_classes
    FROM room r
    JOIN schedule_slot ss ON ss.room_id = r.id
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ?
    GROUP BY r.building
    ORDER BY total_classes DESC
  `).all(term) as { building: string; room_count: number; total_classes: number }[];
  
  // Get busiest and quietest rooms
  const busiest = stats[0];
  const quietest = stats.length > 0 ? stats[stats.length - 1] : null;
  
  return {
    query: { building: args.building, term, sort_by: sortBy },
    total_rooms: stats.length,
    rooms: stats.map(s => ({
      room: s.room_code,
      building: s.building,
      classes: s.class_count,
      hours_per_week: s.total_hours,
      courses: s.unique_courses,
      instructors: s.unique_instructors,
      days: s.days_used?.split(',') || []
    })),
    by_building: buildingSummary,
    highlights: {
      busiest_room: busiest ? `${busiest.room_code} (${busiest.class_count} classes, ${busiest.total_hours}h/week)` : null,
      quietest_room: quietest ? `${quietest.room_code} (${quietest.class_count} classes)` : null
    }
  };
}
