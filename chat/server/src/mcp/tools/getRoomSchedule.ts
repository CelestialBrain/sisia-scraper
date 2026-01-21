/**
 * Get Room Schedule Tool
 * 
 * Get schedule for a specific room.
 */

import { SchemaType } from '@google/generative-ai';
import { getRoomSchedule } from '../../models/Room.js';

export const definition = {
  name: 'get_room_schedule',
  description: 'Get what classes are scheduled in a specific room AND when the room is free (breaks/gaps). When no day is specified or day="all", returns a weekly_grid organized by day with total hours used per day, plus a summary with busiest day and total weekly hours.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      room_code: { 
        type: SchemaType.STRING, 
        description: 'Room code. Use format: "SEC-A204" (with hyphen, no spaces), "CTC 215", "PLDT-328". For SEC building: SEC-A/B/C + room number, e.g., SEC-A118A, SEC-B205.' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      day: { 
        type: SchemaType.STRING, 
        description: 'Filter by day (Monday, Tuesday, etc.) or "all" for full week with weekly_grid' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default 100 for full week)' 
      },
    },
    required: ['room_code'],
  },
};

export function handler(args: { room_code: string; term?: string; day?: string; limit?: number }) {
  return getRoomSchedule(
    args.room_code,
    args.term || '2025-2',
    args.day,
    args.limit || 50
  );
}
