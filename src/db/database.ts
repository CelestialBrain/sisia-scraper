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
      .prepare("SELECT id FROM departments WHERE code = ?")
      .get(code) as { id: number } | undefined;

    if (existing) {
      this.cache.departments.set(code, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare("INSERT INTO departments (code, name) VALUES (?, ?)")
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
      .prepare("SELECT id FROM instructors WHERE name = ?")
      .get(trimmed) as { id: number } | undefined;

    if (existing) {
      this.cache.instructors.set(trimmed, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare("INSERT INTO instructors (name) VALUES (?)")
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
      .prepare("SELECT id FROM rooms WHERE code = ?")
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
        "INSERT INTO rooms (code, building, room_number) VALUES (?, ?, ?)"
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
      .prepare("SELECT id FROM terms WHERE code = ?")
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
      .prepare("INSERT INTO terms (code, year, semester) VALUES (?, ?, ?)")
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
      .prepare("SELECT id FROM courses WHERE course_code = ?")
      .get(courseCode) as { id: number } | undefined;

    if (existing) {
      this.cache.courses.set(courseCode, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare(
        "INSERT INTO courses (course_code, title, units, department_id) VALUES (?, ?, ?, ?)"
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
      .prepare("SELECT id FROM degree_programs WHERE code = ?")
      .get(program.code) as { id: number } | undefined;

    if (existing) {
      this.cache.degreePrograms.set(program.code, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare(
        `
      INSERT INTO degree_programs 
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
      INSERT OR REPLACE INTO class_sections 
        (course_id, term_id, instructor_id, department_id, section,
         max_capacity, free_slots, lang, level, remarks, has_prerequisites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const slotStmt = this.db.prepare(`
      INSERT INTO schedule_slots (section_id, room_id, day, start_time, end_time, modality)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteSlotsForSection = this.db.prepare(`
      DELETE FROM schedule_slots WHERE section_id = ?
    `);

    const findSection = this.db.prepare(`
      SELECT id FROM class_sections 
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
      INSERT OR REPLACE INTO curriculum_courses 
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
        .prepare("SELECT COUNT(*) as count FROM class_sections")
        .get() as any
    ).count;
    const courses = (
      this.db.prepare("SELECT COUNT(*) as count FROM courses").get() as any
    ).count;
    const programs = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM degree_programs")
        .get() as any
    ).count;
    const instructors = (
      this.db.prepare("SELECT COUNT(*) as count FROM instructors").get() as any
    ).count;
    const rooms = (
      this.db.prepare("SELECT COUNT(*) as count FROM rooms").get() as any
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
      SELECT c.* FROM courses c
      JOIN courses_fts fts ON c.id = fts.rowid
      WHERE courses_fts MATCH ?
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
      FROM class_sections cs
      JOIN courses c ON cs.course_id = c.id
      JOIN terms t ON cs.term_id = t.id
      LEFT JOIN instructors i ON cs.instructor_id = i.id
      LEFT JOIN departments d ON cs.department_id = d.id
      WHERE t.code = ?
    `
      )
      .all(termCode);
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
