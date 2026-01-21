/**
 * Find Free Rooms Tool
 * 
 * Search for rooms that are unoccupied at a specific day/time.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'find_free_rooms',
  description: 'Find rooms that are NOT in use at a specific day and time. Useful for finding study spaces or available classrooms.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      day: { 
        type: SchemaType.STRING, 
        description: 'Day of week (e.g., "Monday", "Tuesday")' 
      },
      time: { 
        type: SchemaType.STRING, 
        description: 'Time to check (e.g., "10:00", "14:30")' 
      },
      building: { 
        type: SchemaType.STRING, 
        description: 'Optional building filter (e.g., "SEC", "CTC", "PLDT")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['day', 'time'],
  },
};

export function handler(args: { day: string; time: string; building?: string; term?: string }) {
  const term = args.term || '2025-2';
  const day = args.day.charAt(0).toUpperCase() + args.day.slice(1).toLowerCase();
  const timeStr = args.time.replace(':', '');
  const timeNum = parseInt(timeStr.length === 3 ? '0' + timeStr : timeStr);
  
  // Get all rooms
  let roomQuery = `SELECT id, code, building FROM room WHERE 1=1`;
  const roomParams: unknown[] = [];
  
  if (args.building) {
    roomQuery += ` AND (building LIKE ? OR code LIKE ?)`;
    roomParams.push(`%${args.building}%`, `${args.building}%`);
  }
  
  const allRooms = db.prepare(roomQuery).all(...roomParams) as { id: number; code: string; building: string | null }[];
  
  // Get occupied rooms at the specified time
  const occupiedRooms = db.prepare(`
    SELECT DISTINCT r.id
    FROM room r
    JOIN schedule_slot ss ON ss.room_id = r.id
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code = ?
    AND ss.day = ?
    AND CAST(REPLACE(ss.start_time, ':', '') AS INTEGER) <= ?
    AND CAST(REPLACE(ss.end_time, ':', '') AS INTEGER) > ?
  `).all(term, day, timeNum, timeNum) as { id: number }[];
  
  const occupiedIds = new Set(occupiedRooms.map(r => r.id));
  
  // Filter to free rooms
  const freeRooms = allRooms.filter(r => !occupiedIds.has(r.id));
  
  // Group by building
  const byBuilding: Record<string, string[]> = {};
  for (const room of freeRooms) {
    const bldg = room.building || 'Unknown';
    if (!byBuilding[bldg]) byBuilding[bldg] = [];
    byBuilding[bldg].push(room.code);
  }
  
  return {
    query: { day, time: args.time, building: args.building },
    free_rooms_count: freeRooms.length,
    total_rooms_checked: allRooms.length,
    by_building: byBuilding,
    rooms: freeRooms.slice(0, 50).map(r => r.code), // Limit to 50
    _format_hint: freeRooms.length > 0 
      ? `Present results grouped by building. Use 'by_building' field for organized output.`
      : undefined,
    _meta: freeRooms.length === 0 ? { message: `No free rooms found for ${day} at ${args.time}` } : undefined
  };
}
