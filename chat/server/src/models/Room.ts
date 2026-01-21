/**
 * Room Model
 * All database queries related to rooms
 */

import Database from 'better-sqlite3';

let db: Database.Database;

export function initRoomModel(database: Database.Database) {
  db = database;
}

export interface RoomScheduleResult {
  room: string;
  course_code: string;
  section: string;
  instructor: string | null;
  day: string;
  start_time: string;
  end_time: string;
  term: string;
}

export interface FreePeriod {
  day: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight back to HH:MM format
 */
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Normalize room code to match database format
 * Handles building aliases and various input formats
 */
function normalizeRoomCode(input: string): string {
  // Trim and uppercase
  let code = input.trim().toUpperCase();
  
  // Building name to code mappings (only full names that need abbreviating)
  const buildingAliases: Record<string, string> = {
    'KOSTKA': 'K',
    'BELLARMINE': 'BEL',
    'FAURA': 'F',
    'GONZAGA': 'G',
    'BERCH': 'B',
    'BERCHMANS': 'B',
    'CLAVERIA': 'C',
    'DELATORRE': 'D',
  };
  
  // Replace full building names with abbreviations
  for (const [fullName, abbrev] of Object.entries(buildingAliases)) {
    const pattern = new RegExp(`^${fullName}\\s*`, 'i');
    if (pattern.test(code)) {
      code = code.replace(pattern, `${abbrev}-`);
      break;
    }
  }
  
  // Handle SEC building variations: SEC A 204, SECA204, SEC A204, etc.
  const secMatch = code.match(/^SEC[\s-]?([A-C])[\s-]?(\d+[A-Z]?)$/i);
  if (secMatch) {
    return `SEC-${secMatch[1]}${secMatch[2]}`;
  }
  
  // Handle single-letter building codes: K 303, K303, K-303 → K-303
  const singleLetterMatch = code.match(/^([BKFGCD])[\s-]?(\d+[A-Z]?)$/i);
  if (singleLetterMatch) {
    return `${singleLetterMatch[1]}-${singleLetterMatch[2]}`;
  }
  
  // Handle BEL building: BEL 103, BEL103 → BEL-103
  const belMatch = code.match(/^BEL[\s-]?(\d+[A-Z]?)$/i);
  if (belMatch) {
    return `BEL-${belMatch[1]}`;
  }
  
  // Handle CTC/SOM/PLDT with space: CTC 215, SOM 204 → CTC 215 (keep space)
  const spacedMatch = code.match(/^(CTC|SOM|PLDT)[\s-](\d+[A-Z]?)$/i);
  if (spacedMatch) {
    return `${spacedMatch[1]} ${spacedMatch[2]}`;
  }
  
  // Replace multiple spaces with single space
  code = code.replace(/\s+/g, ' ');
  
  return code;
}

/**
 * Calculate free periods (breaks) between classes for a room
 */
function calculateFreePeriods(
  schedule: RoomScheduleResult[],
  dayStart: number = 7 * 60, // 7:00 AM
  dayEnd: number = 21 * 60   // 9:00 PM
): FreePeriod[] {
  const freePeriods: FreePeriod[] = [];
  
  // Group schedule by day
  const scheduleByDay = new Map<string, RoomScheduleResult[]>();
  for (const slot of schedule) {
    const existing = scheduleByDay.get(slot.day) || [];
    existing.push(slot);
    scheduleByDay.set(slot.day, existing);
  }
  
  // Calculate gaps for each day
  for (const [day, slots] of scheduleByDay) {
    // Sort slots by start time
    const sortedSlots = [...slots].sort((a, b) => 
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
    );
    
    // Merge overlapping slots
    const mergedSlots: { start: number; end: number }[] = [];
    for (const slot of sortedSlots) {
      const start = timeToMinutes(slot.start_time);
      const end = timeToMinutes(slot.end_time);
      
      if (mergedSlots.length === 0) {
        mergedSlots.push({ start, end });
      } else {
        const last = mergedSlots[mergedSlots.length - 1];
        if (start <= last.end) {
          // Overlapping or adjacent - extend
          last.end = Math.max(last.end, end);
        } else {
          mergedSlots.push({ start, end });
        }
      }
    }
    
    // Find gaps between merged slots
    let currentTime = dayStart;
    for (const slot of mergedSlots) {
      if (slot.start > currentTime) {
        // Gap found
        const duration = slot.start - currentTime;
        if (duration >= 30) { // Only report gaps of 30+ minutes
          freePeriods.push({
            day,
            start_time: minutesToTime(currentTime),
            end_time: minutesToTime(slot.start),
            duration_minutes: duration
          });
        }
      }
      currentTime = Math.max(currentTime, slot.end);
    }
    
    // Check for gap at end of day
    if (currentTime < dayEnd) {
      const duration = dayEnd - currentTime;
      if (duration >= 30) {
        freePeriods.push({
          day,
          start_time: minutesToTime(currentTime),
          end_time: minutesToTime(dayEnd),
          duration_minutes: duration
        });
      }
    }
  }
  
  return freePeriods.sort((a, b) => {
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day) || 
           timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
}

/**
 * Get room schedule with free periods
 */
export function getRoomSchedule(
  roomCode: string,
  term: string = '2025-2',
  day?: string,
  limit: number = 100 // Increased default for full week
): { 
  room: string; 
  schedule: RoomScheduleResult[]; 
  free_periods: FreePeriod[];
  weekly_grid?: Record<string, { classes: RoomScheduleResult[]; total_hours: number }>;
  summary?: { total_classes: number; busiest_day: string; total_hours: number };
} {
  const normalizedCode = normalizeRoomCode(roomCode);
  // Use LIKE with wildcards to find multi-room entries like "SEC-A202; CTC 407"
  const queryParams: unknown[] = [`%${normalizedCode}%`, term];

  let query = `
    SELECT r.code as room, c.course_code, cs.section, i.name as instructor,
           ss.day, ss.start_time, ss.end_time, t.code as term
    FROM schedule_slot ss
    JOIN room r ON ss.room_id = r.id
    JOIN class_section cs ON ss.section_id = cs.id
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    WHERE r.code LIKE ? AND t.code = ?
  `;

  if (day && day.toLowerCase() !== 'all') {
    query += ` AND ss.day = ?`;
    queryParams.push(day);
  }

  query += ` ORDER BY ss.day, ss.start_time LIMIT ?`;
  queryParams.push(limit);

  const rows = db.prepare(query).all(...queryParams) as RoomScheduleResult[];
  
  // Calculate free periods
  const freePeriods = calculateFreePeriods(rows);
  
  // If full week (no day filter), add weekly grid format
  if (!day || day.toLowerCase() === 'all') {
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weeklyGrid: Record<string, { classes: RoomScheduleResult[]; total_hours: number }> = {};
    
    for (const dayName of dayOrder) {
      const dayClasses = rows.filter(r => r.day === dayName);
      const totalMinutes = dayClasses.reduce((sum, c) => {
        return sum + (timeToMinutes(c.end_time) - timeToMinutes(c.start_time));
      }, 0);
      
      if (dayClasses.length > 0) {
        weeklyGrid[dayName] = {
          classes: dayClasses,
          total_hours: Math.round(totalMinutes / 60 * 10) / 10
        };
      }
    }
    
    // Summary stats
    const busiest = Object.entries(weeklyGrid)
      .sort((a, b) => b[1].classes.length - a[1].classes.length)[0];
    
    const totalHours = Object.values(weeklyGrid)
      .reduce((sum, d) => sum + d.total_hours, 0);
    
    return {
      room: roomCode,
      schedule: rows,
      free_periods: freePeriods,
      weekly_grid: weeklyGrid,
      summary: {
        total_classes: rows.length,
        busiest_day: busiest?.[0] || 'None',
        total_hours: Math.round(totalHours * 10) / 10
      }
    };
  }

  return { room: roomCode, schedule: rows, free_periods: freePeriods };
}
