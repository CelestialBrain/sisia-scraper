/**
 * Get Time Slot Stats Tool
 * 
 * Show which time slots have the most/least classes.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_time_slot_stats',
  description: 'Get statistics on class distribution by time slot. Shows which times have the most or fewest classes.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      day: { 
        type: SchemaType.STRING, 
        description: 'Filter by day (Monday, Tuesday, etc.)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: [],
  },
};

export function handler(args: { day?: string; term?: string }) {
  const term = args.term || '2025-2';
  
  let dayFilter = '';
  const params: unknown[] = [term];
  
  if (args.day) {
    dayFilter = ' AND ss.day = ?';
    params.push(args.day);
  }
  
  // Get time slot distribution
  const timeStats = db.prepare(`
    SELECT 
      ss.start_time,
      ss.day,
      COUNT(*) as class_count
    FROM schedule_slot ss
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ?${dayFilter}
    GROUP BY ss.start_time, ss.day
    ORDER BY class_count DESC
  `).all(...params) as Array<{
    start_time: string;
    day: string;
    class_count: number;
  }>;
  
  // Get day distribution
  const dayStats = db.prepare(`
    SELECT 
      ss.day,
      COUNT(*) as class_count
    FROM schedule_slot ss
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ?
    GROUP BY ss.day
    ORDER BY class_count DESC
  `).all(term) as Array<{
    day: string;
    class_count: number;
  }>;
  
  // Get hour distribution
  const hourStats = db.prepare(`
    SELECT 
      SUBSTR(ss.start_time, 1, 2) as hour,
      COUNT(*) as class_count
    FROM schedule_slot ss
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ? AND ss.start_time != '00:00'
    GROUP BY hour
    ORDER BY class_count DESC
  `).all(term) as Array<{
    hour: string;
    class_count: number;
  }>;
  
  // Find busiest and quietest times
  const busiest = timeStats.slice(0, 5);
  const quietest = timeStats.slice(-5).reverse();
  
  return {
    term,
    day_filter: args.day || 'all days',
    by_day: Object.fromEntries(dayStats.map(d => [d.day, d.class_count])),
    by_hour: Object.fromEntries(hourStats.map(h => [`${h.hour}:00`, h.class_count])),
    busiest_slots: busiest.map(t => ({
      time: t.start_time,
      day: t.day,
      classes: t.class_count
    })),
    quietest_slots: quietest.map(t => ({
      time: t.start_time,
      day: t.day,
      classes: t.class_count
    }))
  };
}
