/**
 * Database Module v2 - Normalized Schema
 * Uses integer primary keys and lookup tables for optimal performance
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type {
  ClassSection,
  Department,
  DegreeProgram,
  CurriculumCourse,
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache for lookup IDs to avoid repeated queries
interface LookupCache {
  departments: Map<string, number>;
  instructors: Map<string, number>;
  rooms: Map<string, number>;
  courses: Map<string, number>;
  terms: Map<string, number>;
  degreePrograms: Map<string, number>;
}

// Scrape statistics for change tracking
export interface ScrapeStats {
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  total: number;
}

// Scrape run record
export interface ScrapeRun {
  id: number;
  startedAt: Date;
  completedAt?: Date;
  termCode?: string;
  scrapeType: 'schedule' | 'curriculum' | 'all';
  stats: ScrapeStats;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
}

export class SISIADatabase {
  private db: Database.Database;
  private cache: LookupCache;

  constructor(dbPath: string = "sisia.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.cache = {
      departments: new Map(),
      instructors: new Map(),
      rooms: new Map(),
      courses: new Map(),
      terms: new Map(),
      degreePrograms: new Map(),
    };
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  initialize(): void {
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    this.db.exec(schema);
    console.log("📦 Database initialized");
  }

  // ============================================
  // LOOKUP HELPERS (Get or Create, returns ID)
  // ============================================

  /**
   * Get or create a department, returns its ID
   */
  getOrCreateDepartment(code: string, name: string): number {
    if (this.cache.departments.has(code)) {
      return this.cache.departments.get(code)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM department WHERE code = ?")
      .get(code) as { id: number } | undefined;

    if (existing) {
      this.cache.departments.set(code, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare("INSERT INTO department (code, name) VALUES (?, ?)")
      .run(code, name);

    const id = result.lastInsertRowid as number;
    this.cache.departments.set(code, id);
    return id;
  }

  /**
   * Get or create an instructor, returns its ID
   */
  getOrCreateInstructor(name: string | null): number | null {
    if (!name || name.trim() === "") return null;

    const trimmed = name.trim();
    if (this.cache.instructors.has(trimmed)) {
      return this.cache.instructors.get(trimmed)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM instructor WHERE name = ?")
      .get(trimmed) as { id: number } | undefined;

    if (existing) {
      this.cache.instructors.set(trimmed, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare("INSERT INTO instructor (name) VALUES (?)")
      .run(trimmed);

    const id = result.lastInsertRowid as number;
    this.cache.instructors.set(trimmed, id);
    return id;
  }

  /**
   * Get or create a room, returns its ID
   */
  getOrCreateRoom(code: string | null): number | null {
    if (!code || code.trim() === "") return null;

    const trimmed = code.trim();
    if (this.cache.rooms.has(trimmed)) {
      return this.cache.rooms.get(trimmed)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM room WHERE code = ?")
      .get(trimmed) as { id: number } | undefined;

    if (existing) {
      this.cache.rooms.set(trimmed, existing.id);
      return existing.id;
    }

    // Parse building and room number from code like "SEC A 301"
    const parts = trimmed.split(" ");
    const roomNumber = parts.pop() || "";
    const building = parts.join(" ");

    const result = this.db
      .prepare(
        "INSERT INTO room (code, building, room_number) VALUES (?, ?, ?)"
      )
      .run(trimmed, building, roomNumber);

    const id = result.lastInsertRowid as number;
    this.cache.rooms.set(trimmed, id);
    return id;
  }

  /**
   * Get or create a term, returns its ID
   */
  getOrCreateTerm(code: string): number {
    if (this.cache.terms.has(code)) {
      return this.cache.terms.get(code)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM term WHERE code = ?")
      .get(code) as { id: number } | undefined;

    if (existing) {
      this.cache.terms.set(code, existing.id);
      return existing.id;
    }

    // Parse year and semester from code like "2025-2"
    const [yearStr, semStr] = code.split("-");
    const year = parseInt(yearStr) || 0;
    const semester = parseInt(semStr) || 0;

    const result = this.db
      .prepare("INSERT INTO term (code, year, semester) VALUES (?, ?, ?)")
      .run(code, year, semester);

    const id = result.lastInsertRowid as number;
    this.cache.terms.set(code, id);
    return id;
  }

  /**
   * Get or create a course, returns its ID
   */
  getOrCreateCourse(
    courseCode: string,
    title: string,
    units: number,
    departmentId?: number | null
  ): number {
    if (this.cache.courses.has(courseCode)) {
      return this.cache.courses.get(courseCode)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM course WHERE course_code = ?")
      .get(courseCode) as { id: number } | undefined;

    if (existing) {
      this.cache.courses.set(courseCode, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare(
        "INSERT INTO course (course_code, title, units, department_id) VALUES (?, ?, ?, ?)"
      )
      .run(courseCode, title, units, departmentId || null);

    const id = result.lastInsertRowid as number;
    this.cache.courses.set(courseCode, id);
    return id;
  }

  /**
   * Get or create a degree program, returns its ID
   */
  getOrCreateDegreeProgram(program: DegreeProgram): number {
    if (this.cache.degreePrograms.has(program.code)) {
      return this.cache.degreePrograms.get(program.code)!;
    }

    const existing = this.db
      .prepare("SELECT id FROM degree_program WHERE code = ?")
      .get(program.code) as { id: number } | undefined;

    if (existing) {
      this.cache.degreePrograms.set(program.code, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare(
        `
      INSERT INTO degree_program 
        (code, name, is_honors, track, specialization, version_year, version_semester)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        program.code,
        program.name,
        program.isHonors ? 1 : 0,
        program.track || null,
        program.specialization || null,
        program.year || null,
        program.semester || null
      );

    const id = result.lastInsertRowid as number;
    this.cache.degreePrograms.set(program.code, id);
    return id;
  }

  // ============================================
  // SAVE METHODS (Bulk operations)
  // ============================================

  /**
   * Save departments
   */
  saveDepartments(departments: Department[]): void {
    const transaction = this.db.transaction((depts: Department[]) => {
      for (const dept of depts) {
        this.getOrCreateDepartment(dept.code, dept.name);
      }
    });

    transaction(departments);
    console.log(`  Saved ${departments.length} departments`);
  }

  /**
   * Save class sections with normalized lookups
   */
  saveClassSections(sections: ClassSection[]): void {
    const sectionStmt = this.db.prepare(`
      INSERT OR REPLACE INTO class_section 
        (course_id, term_id, instructor_id, department_id, section,
         max_capacity, free_slots, lang, level, remarks, has_prerequisites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const slotStmt = this.db.prepare(`
      INSERT INTO schedule_slot (section_id, room_id, day, start_time, end_time, modality)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteSlotsForSection = this.db.prepare(`
      DELETE FROM schedule_slot WHERE section_id = ?
    `);

    const findSection = this.db.prepare(`
      SELECT id FROM class_section 
      WHERE course_id = ? AND term_id = ? AND section = ?
    `);

    const transaction = this.db.transaction((sects: ClassSection[]) => {
      for (const section of sects) {
        // Get/create all lookup IDs
        const termId = this.getOrCreateTerm(section.term);
        const deptId = section.department
          ? this.getOrCreateDepartment(section.department, section.department)
          : null;
        const courseId = this.getOrCreateCourse(
          section.subjectCode,
          section.courseTitle,
          section.units,
          deptId
        );
        const instructorId = this.getOrCreateInstructor(section.instructor);

        // Insert section
        sectionStmt.run(
          courseId,
          termId,
          instructorId,
          deptId,
          section.section,
          section.maxCapacity,
          section.freeSlots,
          section.lang,
          section.level,
          section.remarks,
          section.hasPrerequisites ? 1 : 0
        );

        // Get the section ID (either from insert or existing)
        const sectionRow = findSection.get(
          courseId,
          termId,
          section.section
        ) as { id: number };
        const sectionId = sectionRow.id;

        // Clear old slots and insert new ones
        deleteSlotsForSection.run(sectionId);
        for (const slot of section.schedule) {
          const roomId = this.getOrCreateRoom(slot.room);
          slotStmt.run(
            sectionId,
            roomId,
            slot.day,
            slot.startTime,
            slot.endTime,
            slot.modality || "ONSITE"
          );
        }
      }
    });

    transaction(sections);
    console.log(`  Saved ${sections.length} class sections`);
  }

  /**
   * Save curriculum courses with normalized lookups
   */
  saveCurriculumCourses(
    degreeProgram: DegreeProgram,
    courses: CurriculumCourse[]
  ): void {
    const degreeId = this.getOrCreateDegreeProgram(degreeProgram);

    const curriculumStmt = this.db.prepare(`
      INSERT OR REPLACE INTO curriculum_course 
        (degree_id, course_id, year, semester, prerequisites_raw, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((cs: CurriculumCourse[]) => {
      for (const course of cs) {
        const courseId = this.getOrCreateCourse(
          course.subjectCode,
          course.courseTitle,
          course.units
        );

        curriculumStmt.run(
          degreeId,
          courseId,
          course.year,
          course.semester,
          course.prerequisites || null,
          course.category || null
        );
      }
    });

    transaction(courses);
  }

  // ============================================
  // QUERY METHODS
  // ============================================

  /**
   * Get statistics
   */
  getStats(): {
    sections: number;
    courses: number;
    programs: number;
    instructors: number;
    rooms: number;
  } {
    const sections = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM class_section")
        .get() as any
    ).count;
    const courses = (
      this.db.prepare("SELECT COUNT(*) as count FROM course").get() as any
    ).count;
    const programs = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM degree_program")
        .get() as any
    ).count;
    const instructors = (
      this.db.prepare("SELECT COUNT(*) as count FROM instructor").get() as any
    ).count;
    const rooms = (
      this.db.prepare("SELECT COUNT(*) as count FROM room").get() as any
    ).count;
    return { sections, courses, programs, instructors, rooms };
  }

  /**
   * Search courses using FTS
   */
  searchCourses(query: string, limit = 20) {
    return this.db
      .prepare(
        `
      SELECT c.* FROM course c
      JOIN course_fts fts ON c.id = fts.rowid
      WHERE course_fts MATCH ?
      LIMIT ?
    `
      )
      .all(query, limit);
  }

  /**
   * Get sections for a term using the view-like query
   */
  getSectionsForTerm(termCode: string) {
    return this.db
      .prepare(
        `
      SELECT 
        cs.id,
        c.course_code,
        c.title as course_title,
        c.units,
        cs.section,
        i.name as instructor,
        d.code as department,
        t.code as term,
        cs.max_capacity,
        cs.free_slots,
        cs.has_prerequisites
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      LEFT JOIN instructor i ON cs.instructor_id = i.id
      LEFT JOIN department d ON cs.department_id = d.id
      WHERE t.code = ?
    `
      )
      .all(termCode);
  }

  // ============================================
  // SCRAPE RUN TRACKING
  // ============================================

  /**
   * Start a new scrape run and return its ID
   */
  startScrapeRun(termCode: string | null, scrapeType: 'schedule' | 'curriculum' | 'all'): number {
    const result = this.db.prepare(`
      INSERT INTO scrape_run (started_at, term_code, scrape_type, status)
      VALUES (datetime('now'), ?, ?, 'running')
    `).run(termCode, scrapeType);
    
    return result.lastInsertRowid as number;
  }

  /**
   * Complete a scrape run with final stats
   */
  endScrapeRun(
    runId: number, 
    stats: ScrapeStats, 
    status: 'completed' | 'failed' = 'completed',
    errorMessage?: string
  ): void {
    const startRow = this.db.prepare(
      'SELECT started_at FROM scrape_run WHERE id = ?'
    ).get(runId) as { started_at: string } | undefined;
    
    const startedAt = startRow ? new Date(startRow.started_at) : new Date();
    const durationMs = Date.now() - startedAt.getTime();
    
    this.db.prepare(`
      UPDATE scrape_run 
      SET completed_at = datetime('now'),
          inserted = ?, updated = ?, unchanged = ?, removed = ?,
          total_scraped = ?, duration_ms = ?, status = ?, error_message = ?
      WHERE id = ?
    `).run(
      stats.inserted, stats.updated, stats.unchanged, stats.removed,
      stats.total, durationMs, status, errorMessage || null, runId
    );
  }

  /**
   * Get count of existing sections for a term (for change detection)
   */
  getExistingSectionKeys(termCode: string): Set<string> {
    const termId = this.cache.terms.get(termCode);
    if (!termId) return new Set();
    
    const rows = this.db.prepare(`
      SELECT c.course_code, cs.section
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      WHERE cs.term_id = ?
    `).all(termId) as { course_code: string; section: string }[];
    
    return new Set(rows.map(r => `${r.course_code}-${r.section}`));
  }

  /**
   * Save class sections and return change stats
   */
  saveClassSectionsWithStats(sections: ClassSection[]): ScrapeStats {
    const stats: ScrapeStats = { inserted: 0, updated: 0, unchanged: 0, removed: 0, total: sections.length };
    
    if (sections.length === 0) return stats;
    
    // Get existing section keys for this term
    const termCode = sections[0].term;
    const existingKeys = this.getExistingSectionKeys(termCode);
    const newKeys = new Set<string>();
    
    const checkExistingStmt = this.db.prepare(`
      SELECT cs.id, cs.max_capacity, cs.free_slots, i.name as instructor
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      LEFT JOIN instructor i ON cs.instructor_id = i.id
      WHERE c.course_code = ? AND t.code = ? AND cs.section = ?
    `);
    
    const sectionStmt = this.db.prepare(`
      INSERT OR REPLACE INTO class_section 
        (course_id, term_id, instructor_id, department_id, section,
         max_capacity, free_slots, lang, level, remarks, has_prerequisites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const slotStmt = this.db.prepare(`
      INSERT INTO schedule_slot (section_id, room_id, day, start_time, end_time, modality)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteSlotsForSection = this.db.prepare(`
      DELETE FROM schedule_slot WHERE section_id = ?
    `);

    const findSection = this.db.prepare(`
      SELECT id FROM class_section 
      WHERE course_id = ? AND term_id = ? AND section = ?
    `);

    const transaction = this.db.transaction((sects: ClassSection[]) => {
      for (const section of sects) {
        const sectionKey = `${section.subjectCode}-${section.section}`;
        newKeys.add(sectionKey);
        
        // Get/create all lookup IDs
        const termId = this.getOrCreateTerm(section.term);
        const deptId = section.department
          ? this.getOrCreateDepartment(section.department, section.department)
          : null;
        const courseId = this.getOrCreateCourse(
          section.subjectCode,
          section.courseTitle,
          section.units,
          deptId
        );
        const instructorId = this.getOrCreateInstructor(section.instructor);
        
        // Check if section exists and if data changed
        const existing = checkExistingStmt.get(section.subjectCode, section.term, section.section) as {
          id: number; max_capacity: number; free_slots: number; instructor: string | null;
        } | undefined;
        
        if (existing) {
          // Check if anything changed
          const hasChanged = existing.max_capacity !== section.maxCapacity ||
                            existing.free_slots !== section.freeSlots ||
                            existing.instructor !== section.instructor;
          
          if (hasChanged) {
            stats.updated++;
          } else {
            stats.unchanged++;
          }
        } else {
          stats.inserted++;
        }

        // Insert/update section
        sectionStmt.run(
          courseId,
          termId,
          instructorId,
          deptId,
          section.section,
          section.maxCapacity,
          section.freeSlots,
          section.lang,
          section.level,
          section.remarks,
          section.hasPrerequisites ? 1 : 0
        );

        // Get the section ID
        const sectionRow = findSection.get(courseId, termId, section.section) as { id: number };
        const sectionId = sectionRow.id;

        // Clear old slots and insert new ones
        deleteSlotsForSection.run(sectionId);
        for (const slot of section.schedule) {
          const roomId = this.getOrCreateRoom(slot.room);
          slotStmt.run(
            sectionId,
            roomId,
            slot.day,
            slot.startTime,
            slot.endTime,
            slot.modality || "ONSITE"
          );
        }
      }
    });

    transaction(sections);
    
    // Count removed sections (existed before but not in current scrape)
    for (const key of existingKeys) {
      if (!newKeys.has(key)) {
        stats.removed++;
      }
    }
    
    return stats;
  }

  /**
   * Get recent scrape runs
   */
  getRecentScrapeRuns(limit: number = 10): ScrapeRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM scrape_run 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(limit) as any[];
    
    return rows.map(r => ({
      id: r.id,
      startedAt: new Date(r.started_at),
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      termCode: r.term_code,
      scrapeType: r.scrape_type,
      stats: {
        inserted: r.inserted || 0,
        updated: r.updated || 0,
        unchanged: r.unchanged || 0,
        removed: r.removed || 0,
        total: r.total_scraped || 0,
      },
      durationMs: r.duration_ms,
      status: r.status,
      errorMessage: r.error_message,
    }));
  }

  /**
   * Clear cache (useful after bulk operations)
   */
  clearCache(): void {
    this.cache.departments.clear();
    this.cache.instructors.clear();
    this.cache.rooms.clear();
    this.cache.courses.clear();
    this.cache.terms.clear();
    this.cache.degreePrograms.clear();
  }

  /**
   * Close database
   */
  close(): void {
    this.db.close();
  }
}

export const db = new SISIADatabase();
