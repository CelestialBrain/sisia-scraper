/**
 * Course Model
 * All database queries related to courses
 */

import Database from 'better-sqlite3';

let db: Database.Database;

export function initCourseModel(database: Database.Database) {
  db = database;
}

export interface CourseResult {
  course_code: string;
  title: string;
  units: number;
  department: string | null;
  section_count: number;
}

export interface SectionResult {
  section: string;
  instructor: string | null;
  max_capacity: number;
  free_slots: number;
  remarks: string | null;
  term: string;
  schedule: string | null;
}

/**
 * Search courses by code or title
 */
export function searchCourses(
  query: string,
  term: string = '2025-2',
  limit: number = 20
): { courses: CourseResult[]; total: number } {
  // Normalize course code (CSCI111 → CSCI 111)
  const normalized = query.replace(/([A-Za-z]+)(\d)/, '$1 $2').toUpperCase();
  const queryPattern = `%${normalized}%`;
  const queryLower = `%${query.toLowerCase()}%`;

  const rows = db.prepare(`
    SELECT DISTINCT c.course_code, c.title, c.units, d.code as department,
           (SELECT COUNT(*) FROM class_section cs 
            JOIN term t ON cs.term_id = t.id 
            WHERE cs.course_id = c.id AND t.code = ?) as section_count
    FROM course c
    LEFT JOIN department d ON c.department_id = d.id
    WHERE c.course_code LIKE ? OR c.course_code LIKE ? OR LOWER(c.title) LIKE ?
    ORDER BY c.course_code
    LIMIT ?
  `).all(term, queryPattern, `%${query}%`, queryLower, limit) as CourseResult[];

  return { courses: rows, total: rows.length };
}

/**
 * Get all sections for a specific course
 */
export function getCourseSections(
  courseCode: string,
  term: string = '2025-2'
): { course: string; term: string; sections: SectionResult[] } {
  const rows = db.prepare(`
    SELECT cs.section, i.name as instructor, cs.max_capacity, cs.free_slots,
           cs.remarks, t.code as term,
           GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time || ' ' || COALESCE(r.code, ''), '; ') as schedule
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    LEFT JOIN room r ON ss.room_id = r.id
    WHERE c.course_code = ? AND t.code = ?
    GROUP BY cs.id
    ORDER BY cs.section
  `).all(courseCode, term) as SectionResult[];

  return { course: courseCode, term, sections: rows };
}

/**
 * Compare sections by available slots, time, or instructor
 */
export function compareSections(
  courseCode: string,
  term: string = '2025-2',
  sortBy: string = 'slots'
): {
  course: string;
  sections: Array<{
    section: string;
    instructor: string | null;
    free_slots: number;
    max_capacity: number;
    schedule: string | null;
  }>;
} {
  let orderBy = 'cs.free_slots DESC';
  if (sortBy === 'time') orderBy = 'MIN(ss.start_time) ASC';
  if (sortBy === 'instructor') orderBy = 'i.name ASC';

  const rows = db.prepare(`
    SELECT cs.section, i.name as instructor, cs.free_slots, cs.max_capacity,
           GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time, '; ') as schedule
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
    WHERE c.course_code = ? AND t.code = ?
    GROUP BY cs.id
    ORDER BY ${orderBy}
  `).all(courseCode, term);

  return { course: courseCode, sections: rows as any };
}

/**
 * Find similar course codes when exact match fails
 * E.g., "MATH 31" → ["MATH 31.1", "MATH 31.2", "MATH 31.3"]
 */
export function getSimilarCourseCodes(
  courseCode: string,
  term: string = '2025-2',
  limit: number = 10
): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT c.course_code
    FROM course c
    JOIN class_section cs ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    WHERE c.course_code LIKE ? AND t.code = ?
    ORDER BY c.course_code
    LIMIT ?
  `).all(`${courseCode}%`, term, limit) as Array<{ course_code: string }>;

  return rows.map(r => r.course_code);
}
