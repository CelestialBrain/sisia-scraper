/**
 * Instructor Model
 * All database queries related to instructors
 */

import Database from "better-sqlite3";

let db: Database.Database;

export function initInstructorModel(database: Database.Database) {
  db = database;
}

export interface InstructorScheduleResult {
  instructor: string;
  course_code: string;
  section: string;
  day: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  term: string;
}

/**
 * Parse a multi-instructor string into individual instructor names.
 * Handles formats like "NABLE, JOB A., BUOT, JUDE C." → ["NABLE, JOB A.", "BUOT, JUDE C."]
 * Also handles multi-word last names like "CHAN SHIO, CHRISTIAN PAUL O."
 */
function parseInstructorNames(combinedName: string): string[] {
  const names: string[] = [];

  // Strategy: Split on comma-space followed by ALL CAPS word that starts a new name
  // Pattern: Look for "LASTNAME (LASTNAME), Firstname..." format
  // Match: UPPERCASE_WORD(s), then Mixed/lowercase word(s), optionally ending with period
  const regex = /([A-Z][A-Z\-']+(?:\s+[A-Z][A-Z\-']+)*(?:\s+[IVX]+)?,\s+[A-Za-z]+(?:[.\s]+[A-Za-z]+)*\.?)/g;
  let match;

  while ((match = regex.exec(combinedName)) !== null) {
    const name = match[1].trim();
    if (name.length > 3) {
      // Avoid fragments
      names.push(name);
    }
  }

  // If regex didn't find anything, return the original name
  if (names.length === 0) {
    return [combinedName];
  }

  return names;
}

/**
 * Search instructors by name (fuzzy matching)
 * Parses multi-instructor entries and returns unique individual names
 */
export function searchInstructors(
  name: string,
  limit: number = 20,
): { instructors: Array<{ name: string; match_score: number }> } {
  const searchParts = name.toUpperCase().split(/\s+/);

  // Build fuzzy matching conditions
  const conditions = searchParts
    .map(() => `UPPER(i.name) LIKE ?`)
    .join(" AND ");
  const params = searchParts.map((p) => `%${p}%`);

  const rows = db
    .prepare(
      `
    SELECT i.id, i.name
    FROM instructor i
    WHERE ${conditions}
    ORDER BY i.name
    LIMIT ?
  `,
    )
    .all(...params, limit * 2); // Fetch more to account for duplicates after parsing

  // Extract and deduplicate individual instructor names
  const seenNames = new Set<string>();
  const results: Array<{ name: string; match_score: number }> = [];

  for (const row of rows as Array<{ id: number; name: string }>) {
    const individualNames = parseInstructorNames(row.name);

    for (const individualName of individualNames) {
      const normalizedName = individualName.toUpperCase().trim();

      // Check if this individual name matches the search and isn't a duplicate
      if (
        !seenNames.has(normalizedName) &&
        searchParts.every((part) => normalizedName.includes(part))
      ) {
        seenNames.add(normalizedName);

        // Calculate match score
        const matchScore =
          searchParts.filter((p) => normalizedName.includes(p)).length /
          searchParts.length;

        results.push({
          name: individualName.trim(),
          match_score: matchScore,
        });
      }
    }
  }

  // Sort by match score (best matches first) and limit results
  results.sort((a, b) => b.match_score - a.match_score);

  return { instructors: results.slice(0, limit) };
}

/**
 * Get instructor's teaching schedule
 */
export function getInstructorSchedule(
  instructorName: string,
  term: string = "2025-2",
  day?: string,
  limit: number = 50,
): { instructor: string; schedule: InstructorScheduleResult[] } {
  // Extract words from name for flexible matching
  const nameParts = instructorName
    .toUpperCase()
    .split(/[\s,]+/)
    .filter((p) => p.length > 1);

  // Build WHERE clause that matches all name parts (case-insensitive)
  const nameConditions = nameParts
    .map(() => "UPPER(i.name) LIKE ?")
    .join(" AND ");
  const nameParams = nameParts.map((p) => `%${p}%`);

  const queryParams: unknown[] = [...nameParams, term];

  let query = `
    SELECT i.name as instructor, c.course_code, cs.section, 
           ss.day, ss.start_time, ss.end_time, r.code as room, t.code as term
    FROM class_section cs
    JOIN instructor i ON cs.instructor_id = i.id
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    LEFT JOIN room r ON ss.room_id = r.id
    WHERE ${nameConditions} AND t.code = ?
  `;

  if (day) {
    query += ` AND ss.day = ?`;
    queryParams.push(day);
  }

  query += ` ORDER BY ss.day, ss.start_time LIMIT ?`;
  queryParams.push(limit);

  const rows = db
    .prepare(query)
    .all(...queryParams) as InstructorScheduleResult[];

  return { instructor: instructorName, schedule: rows };
}
