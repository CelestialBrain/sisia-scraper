/**
 * ClassSection Model
 * Complex queries for schedule building, time filtering, and conflicts
 */

import Database from 'better-sqlite3';

let db: Database.Database;

export function initClassSectionModel(database: Database.Database) {
  db = database;
}

interface ScheduleSlot {
  day: string;
  start_time: string;
  end_time: string;
}

interface SectionWithSchedule {
  course_code: string;
  section: string;
  instructor: string | null;
  schedule: ScheduleSlot[];
  free_slots: number;
}

/**
 * Search sections by natural time language
 * e.g., "morning MWF", "no 7am", "afternoon only"
 */
export function searchByNaturalTime(
  query: string,
  course_filter?: string,
  term: string = '2025-2',
  limit: number = 30
): { 
  interpretation: string; 
  sections: Array<{
    course_code: string; 
    section: string; 
    instructor: string; 
    schedule: string; 
    free_slots: number
  }> 
} {
  const lower = query.toLowerCase();
  let interpretation = '';
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Parse time preferences
  if (lower.includes('morning') || lower.includes('am only')) {
    conditions.push(`CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) < 12`);
    interpretation += 'Morning classes (before 12:00). ';
  }
  if (lower.includes('afternoon')) {
    conditions.push(`CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) BETWEEN 12 AND 17`);
    interpretation += 'Afternoon classes (12:00-17:00). ';
  }
  if (lower.includes('evening') || lower.includes('night')) {
    conditions.push(`CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) >= 17`);
    interpretation += 'Evening classes (after 17:00). ';
  }

  // Parse "no" preferences
  const noMatch = lower.match(/no\s+(\d{1,2})(?::?\d{2})?\s*(?:am)?/i);
  if (noMatch) {
    const avoidHour = parseInt(noMatch[1]);
    conditions.push(`CAST(SUBSTR(ss.start_time, 1, 2) AS INTEGER) != ${avoidHour}`);
    interpretation += `Avoiding ${avoidHour}:00. `;
  }

  // Parse day preferences
  const dayAbbrevs: Record<string, string> = {
    'm': 'Monday', 'mon': 'Monday',
    't': 'Tuesday', 'tu': 'Tuesday', 'tue': 'Tuesday',
    'w': 'Wednesday', 'wed': 'Wednesday',
    'th': 'Thursday', 'thu': 'Thursday',
    'f': 'Friday', 'fri': 'Friday',
    's': 'Saturday', 'sat': 'Saturday',
  };

  // Check for MWF or TTh patterns
  if (lower.includes('mwf') || (lower.includes('m') && lower.includes('w') && lower.includes('f'))) {
    conditions.push(`ss.day IN ('Monday', 'Wednesday', 'Friday')`);
    interpretation += 'MWF schedule. ';
  } else if (lower.includes('tth') || lower.includes('t-th') || lower.includes('t/th')) {
    conditions.push(`ss.day IN ('Tuesday', 'Thursday')`);
    interpretation += 'TTh schedule. ';
  }

  // Course filter
  let courseCondition = '';
  if (course_filter) {
    courseCondition = `AND c.course_code LIKE ?`;
    params.push(`%${course_filter}%`);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT DISTINCT c.course_code, cs.section, i.name as instructor, cs.free_slots,
           GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time, '; ') as schedule
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    WHERE t.code = ? ${courseCondition} ${whereClause}
    GROUP BY cs.id
    HAVING schedule IS NOT NULL
    ORDER BY cs.free_slots DESC
    LIMIT ?
  `).all(term, ...params, limit);

  return {
    interpretation: interpretation || 'All sections',
    sections: rows as any
  };
}

/**
 * Build conflict-free schedule from multiple courses
 */
export function buildSchedule(
  courseCodes: string[],
  preferences: { 
    morning_only?: boolean; 
    no_saturday?: boolean; 
    no_friday?: boolean;
    exclude_days?: string[];
    include_days?: string[];       // Prefer sections on these days
    max_gap_hours?: number;
    start_after?: string;          // e.g., "13:00" for afternoon only
    start_before?: string;         // e.g., "12:00" for morning only
    end_before?: string;           // e.g., "17:00" to finish by 5pm
    building_filter?: string;      // e.g., "SEC", "CTC", "G"
    prefer_breaks?: boolean;       // Prefer spaced out schedule
    prefer_compact?: boolean;      // Prefer back-to-back classes
  },
  term: string = '2025-2'
): {
  success: boolean;
  schedule: Array<{ course_code: string; section: string; instructor: string; slots: ScheduleSlot[] }>;
  weekly_grid: { columns: string[]; rows: string[]; data: Record<string, Record<string, string>> };
  total_hours: number;
  message: string;
} {
  // OPTIMIZATION 1: Timeout mechanism to prevent infinite hangs
  const startTime = Date.now();
  const TIMEOUT_MS = 5000; // 5 second timeout
  
  // OPTIMIZATION 2: Sort courses by section count (Most Constrained Variable first)
  const sortedCourseCodes = [...courseCodes];
  const sectionCounts = new Map<string, number>();
  
  for (const code of sortedCourseCodes) {
    const count = db.prepare(`
      SELECT COUNT(DISTINCT cs.id) as cnt
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      WHERE c.course_code = ? AND t.code = ? AND cs.free_slots > 0
    `).get(code, term) as { cnt: number } | undefined;
    sectionCounts.set(code, count?.cnt || 0);
  }
  
  // Sort: fewer sections first = prune search space earlier
  sortedCourseCodes.sort((a, b) => (sectionCounts.get(a) || 0) - (sectionCounts.get(b) || 0));
  
  // Get all sections for each course
  const courseSections = new Map<string, SectionWithSchedule[]>();

  for (const code of sortedCourseCodes) {
    // OPTIMIZATION 3: Filter out full sections (free_slots > 0) in SQL
    const rows = db.prepare(`
      SELECT cs.section, i.name as instructor, cs.free_slots,
             ss.day, ss.start_time, ss.end_time, r.code as room
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      LEFT JOIN instructor i ON cs.instructor_id = i.id
      LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
      LEFT JOIN room r ON ss.room_id = r.id
      WHERE c.course_code = ? AND t.code = ? AND cs.free_slots > 0
      ORDER BY cs.free_slots DESC, cs.section
    `).all(code, term) as Array<{
      section: string; instructor: string | null; free_slots: number;
      day: string; start_time: string; end_time: string; room: string | null;
    }>;

    // Group by section
    const sectionMap = new Map<string, SectionWithSchedule>();
    for (const row of rows) {
      if (!sectionMap.has(row.section)) {
        sectionMap.set(row.section, {
          course_code: code,
          section: row.section,
          instructor: row.instructor,
          schedule: [],
          free_slots: row.free_slots
        });
      }
      if (row.day && row.start_time) {
        sectionMap.get(row.section)!.schedule.push({
          day: row.day,
          start_time: row.start_time,
          end_time: row.end_time
        });
      }
    }

    // Build list of excluded days
    const excludedDays: string[] = preferences.exclude_days ? [...preferences.exclude_days] : [];
    if (preferences.no_saturday) excludedDays.push('Saturday');
    if (preferences.no_friday) excludedDays.push('Friday');

    // Apply preferences filter
    const filtered = Array.from(sectionMap.values()).filter(sec => {
      // Morning only filter (legacy - use start_before for more control)
      if (preferences.morning_only) {
        if (!sec.schedule.every(s => parseInt(s.start_time) < 12)) return false;
      }
      // Start after filter (e.g., "13:00" for afternoon only)
      if (preferences.start_after) {
        const afterTime = parseInt(preferences.start_after.replace(':', ''));
        if (!sec.schedule.every(s => parseInt(s.start_time.replace(':', '')) >= afterTime)) return false;
      }
      // Start before filter (e.g., "12:00" for morning only)
      if (preferences.start_before) {
        const beforeTime = parseInt(preferences.start_before.replace(':', ''));
        if (!sec.schedule.every(s => parseInt(s.start_time.replace(':', '')) < beforeTime)) return false;
      }
      // End before filter (e.g., "17:00" to finish by 5pm)
      if (preferences.end_before) {
        const endTime = parseInt(preferences.end_before.replace(':', ''));
        if (!sec.schedule.every(s => parseInt(s.end_time.replace(':', '')) <= endTime)) return false;
      }
      // Building filter (e.g., "SEC", "CTC", "G")
      if (preferences.building_filter) {
        const building = preferences.building_filter.toUpperCase();
        // Get rooms for this section
        const sectionRooms = rows.filter(r => r.section === sec.section).map(r => r.room);
        if (!sectionRooms.some(room => room && room.toUpperCase().startsWith(building))) return false;
      }
      // Day exclusion filter
      if (excludedDays.length > 0) {
        if (!sec.schedule.every(s => !excludedDays.includes(s.day))) return false;
      }
      // Include days preference (prefer but don't require)
      // This is handled in scoring, not filtering
      return true;
    });

    courseSections.set(code, filtered);
  }

  // Check for conflicts using backtracking
  function hasConflict(schedule1: ScheduleSlot[], schedule2: ScheduleSlot[]): boolean {
    for (const s1 of schedule1) {
      for (const s2 of schedule2) {
        if (s1.day === s2.day) {
          const start1 = parseInt(s1.start_time.replace(':', ''));
          const end1 = parseInt(s1.end_time.replace(':', ''));
          const start2 = parseInt(s2.start_time.replace(':', ''));
          const end2 = parseInt(s2.end_time.replace(':', ''));
          if (start1 < end2 && start2 < end1) return true;
        }
      }
    }
    return false;
  }

  // OPTIMIZATION: Forward Checking - prune remaining courses after each selection
  // This detects dead ends BEFORE exploring them, dramatically reducing search space
  function findValidCombinationWithForwardChecking(
    courseIndex: number,
    currentSchedule: SectionWithSchedule[],
    remainingSections: Map<string, SectionWithSchedule[]>
  ): SectionWithSchedule[] | null {
    // Check timeout
    if (Date.now() - startTime > TIMEOUT_MS) return null;
    
    if (courseIndex >= sortedCourseCodes.length) return currentSchedule;

    const code = sortedCourseCodes[courseIndex];
    const sections = remainingSections.get(code) || [];

    for (const section of sections) {
      if (Date.now() - startTime > TIMEOUT_MS) return null;
      
      const hasAnyConflict = currentSchedule.some(s => hasConflict(s.schedule, section.schedule));
      if (!hasAnyConflict) {
        // FORWARD CHECKING: Prune remaining courses' sections that conflict with this choice
        const prunedRemaining = new Map<string, SectionWithSchedule[]>();
        let hasFeasibleFuture = true;
        
        for (let i = courseIndex + 1; i < sortedCourseCodes.length; i++) {
          const futureCode = sortedCourseCodes[i];
          const futureSections = remainingSections.get(futureCode) || [];
          const validFutureSections = futureSections.filter(fs => 
            !hasConflict(fs.schedule, section.schedule)
          );
          
          if (validFutureSections.length === 0) {
            // Dead end detected - no valid sections left for a future course
            hasFeasibleFuture = false;
            break;
          }
          prunedRemaining.set(futureCode, validFutureSections);
        }
        
        if (hasFeasibleFuture) {
          const result = findValidCombinationWithForwardChecking(
            courseIndex + 1, 
            [...currentSchedule, section],
            prunedRemaining
          );
          if (result) return result;
        }
        // If not feasible, skip this section (pruned by forward checking)
      }
    }
    return null;
  }
  
  // Wrapper using forward checking
  function findValidCombination(
    courseIndex: number,
    currentSchedule: SectionWithSchedule[]
  ): SectionWithSchedule[] | null {
    // Build initial remaining sections map
    const initialRemaining = new Map<string, SectionWithSchedule[]>();
    for (const code of sortedCourseCodes) {
      initialRemaining.set(code, courseSections.get(code) || []);
    }
    return findValidCombinationWithForwardChecking(courseIndex, currentSchedule, initialRemaining);
  }

  // Calculate schedule "gap score" - total minutes between classes on same day
  function calculateGapScore(schedule: SectionWithSchedule[]): number {
    let totalGap = 0;
    const slotsByDay: Record<string, Array<{start: number; end: number}>> = {};
    
    for (const sec of schedule) {
      for (const slot of sec.schedule) {
        if (!slotsByDay[slot.day]) slotsByDay[slot.day] = [];
        slotsByDay[slot.day].push({
          start: parseInt(slot.start_time.replace(':', '')),
          end: parseInt(slot.end_time.replace(':', ''))
        });
      }
    }
    
    for (const day of Object.keys(slotsByDay)) {
      const daySlots = slotsByDay[day].sort((a, b) => a.start - b.start);
      for (let i = 1; i < daySlots.length; i++) {
        const gap = daySlots[i].start - daySlots[i-1].end;
        if (gap > 0) totalGap += gap;
      }
    }
    return totalGap;
  }

  // Find multiple valid combinations with Forward Checking (for prefer_breaks/prefer_compact)
  function findAllValidCombinationsFC(
    courseIndex: number,
    currentSchedule: SectionWithSchedule[],
    remainingSections: Map<string, SectionWithSchedule[]>,
    results: SectionWithSchedule[][],
    maxResults: number = 10
  ): void {
    if (Date.now() - startTime > TIMEOUT_MS) return;
    if (results.length >= maxResults) return;
    if (courseIndex >= sortedCourseCodes.length) {
      results.push([...currentSchedule]);
      return;
    }

    const code = sortedCourseCodes[courseIndex];
    const sections = remainingSections.get(code) || [];

    for (const section of sections) {
      if (results.length >= maxResults) return;
      if (Date.now() - startTime > TIMEOUT_MS) return;
      
      const hasAnyConflict = currentSchedule.some(s => hasConflict(s.schedule, section.schedule));
      if (!hasAnyConflict) {
        // Forward Checking: prune future courses
        const prunedRemaining = new Map<string, SectionWithSchedule[]>();
        let hasFeasibleFuture = true;
        
        for (let i = courseIndex + 1; i < sortedCourseCodes.length; i++) {
          const futureCode = sortedCourseCodes[i];
          const futureSections = remainingSections.get(futureCode) || [];
          const validFutureSections = futureSections.filter(fs => 
            !hasConflict(fs.schedule, section.schedule)
          );
          if (validFutureSections.length === 0) {
            hasFeasibleFuture = false;
            break;
          }
          prunedRemaining.set(futureCode, validFutureSections);
        }
        
        if (hasFeasibleFuture) {
          findAllValidCombinationsFC(
            courseIndex + 1, 
            [...currentSchedule, section], 
            prunedRemaining,
            results, 
            maxResults
          );
        }
      }
    }
  }
  
  // Wrapper for findAllValidCombinations
  function findAllValidCombinations(results: SectionWithSchedule[][], maxResults: number = 10): void {
    const initialRemaining = new Map<string, SectionWithSchedule[]>();
    for (const code of sortedCourseCodes) {
      initialRemaining.set(code, courseSections.get(code) || []);
    }
    findAllValidCombinationsFC(0, [], initialRemaining, results, maxResults);
  }

  // Choose best schedule based on preferences
  let result: SectionWithSchedule[] | null = null;
  
  if (preferences.prefer_breaks || preferences.prefer_compact) {
    // Find multiple valid schedules and score them
    const allResults: SectionWithSchedule[][] = [];
    findAllValidCombinations(allResults, 20);
    
    if (allResults.length > 0) {
      // Score each schedule
      const scored = allResults.map(sched => ({
        schedule: sched,
        gapScore: calculateGapScore(sched)
      }));
      
      // Sort based on preference
      if (preferences.prefer_breaks) {
        // Higher gap score = more breaks = better
        scored.sort((a, b) => b.gapScore - a.gapScore);
      } else if (preferences.prefer_compact) {
        // Lower gap score = fewer breaks = better
        scored.sort((a, b) => a.gapScore - b.gapScore);
      }
      
      result = scored[0].schedule;
    }
  } else {
    // Just find first valid combination
    result = findValidCombination(0, []);
  }

  if (!result) {
    return {
      success: false,
      schedule: [],
      weekly_grid: { columns: [], rows: [], data: {} },
      total_hours: 0,
      message: 'No conflict-free schedule found with the given preferences.'
    };
  }

  // Build weekly grid
  const columns = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timeSlots = new Set<string>();
  const gridData: Record<string, Record<string, string>> = {};

  for (const section of result) {
    for (const slot of section.schedule) {
      const timeKey = `${slot.start_time}-${slot.end_time}`;
      timeSlots.add(timeKey);
      if (!gridData[timeKey]) gridData[timeKey] = {};
      gridData[timeKey][slot.day] = `${section.course_code} (${section.section})`;
    }
  }

  const rows = Array.from(timeSlots).sort();

  return {
    success: true,
    schedule: result.map(s => ({
      course_code: s.course_code,
      section: s.section,
      instructor: s.instructor || 'TBA',
      slots: s.schedule
    })),
    weekly_grid: { columns, rows, data: gridData },
    total_hours: result.reduce((sum, s) => sum + s.schedule.length * 1.5, 0),
    message: `Found valid schedule for ${courseCodes.length} courses.`
  };
}
