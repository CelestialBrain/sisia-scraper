/**
 * Database Module
 * Handles SQLite database operations
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ClassSection, Course, Curriculum, Department, DegreeProgram } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SISIADatabase {
  private db: Database.Database;

  constructor(dbPath: string = 'sisia.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Disable foreign keys - we scrape schedule before curriculum
    // and course_id references may not exist yet
    this.db.pragma('foreign_keys = OFF');
  }

  /**
   * Initialize database with schema
   */
  initialize(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    console.log('📦 Database initialized');
  }

  /**
   * Save departments
   */
  saveDepartments(departments: Department[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO departments (code, name, scraped_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);

    const transaction = this.db.transaction((depts: Department[]) => {
      for (const dept of depts) {
        stmt.run(dept.code, dept.name);
      }
    });

    transaction(departments);
    console.log(`  Saved ${departments.length} departments`);
  }

  /**
   * Save class sections
   */
  saveClassSections(sections: ClassSection[]): void {
    const sectionStmt = this.db.prepare(`
      INSERT OR REPLACE INTO class_sections 
      (id, course_id, subject_code, section, course_title, units, instructor, 
       max_capacity, free_slots, lang, level, remarks, term, department, 
       has_prerequisites, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const slotStmt = this.db.prepare(`
      INSERT INTO schedule_slots (section_id, day, start_time, end_time, room, modality)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteSlots = this.db.prepare(`DELETE FROM schedule_slots WHERE section_id = ?`);

    const transaction = this.db.transaction((sects: ClassSection[]) => {
      for (const section of sects) {
        sectionStmt.run(
          section.id,
          section.subjectCode,
          section.subjectCode,
          section.section,
          section.courseTitle,
          section.units,
          section.instructor,
          section.maxCapacity,
          section.freeSlots,
          section.lang,
          section.level,
          section.remarks,
          section.term,
          section.department,
          section.hasPrerequisites ? 1 : 0
        );

        // Clear old slots and insert new ones
        deleteSlots.run(section.id);
        for (const slot of section.schedule) {
          slotStmt.run(
            section.id,
            slot.day,
            slot.startTime,
            slot.endTime,
            slot.room,
            slot.modality
          );
        }
      }
    });

    transaction(sections);
    console.log(`  Saved ${sections.length} class sections`);
  }

  /**
   * Save curriculum data
   */
  saveCurriculum(curriculum: Curriculum): void {
    // Save degree program
    const degreeStmt = this.db.prepare(`
      INSERT OR REPLACE INTO degree_programs (code, name, total_units, scraped_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const courseStmt = this.db.prepare(`
      INSERT OR IGNORE INTO courses (cat_no, title, units, category, scraped_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const curriculumStmt = this.db.prepare(`
      INSERT OR REPLACE INTO curriculum_courses (degree_code, course_id, year, semester)
      VALUES (?, ?, ?, ?)
    `);

    const prereqStmt = this.db.prepare(`
      INSERT OR IGNORE INTO prerequisites (course_id, prerequisite_id, prereq_type)
      VALUES (?, ?, 'required')
    `);

    const transaction = this.db.transaction((cur: Curriculum) => {
      degreeStmt.run(cur.degreeCode, cur.degreeName, cur.totalUnits);

      for (const course of cur.courses) {
        courseStmt.run(course.catNo, course.title, course.units, course.category);
        curriculumStmt.run(cur.degreeCode, course.catNo, course.year, course.semester);

        for (const prereq of course.prerequisites) {
          prereqStmt.run(course.catNo, prereq);
        }
      }
    });

    transaction(curriculum);
    console.log(`  Saved curriculum: ${curriculum.degreeName} (${curriculum.courses.length} courses)`);
  }

  /**
   * Get all sections for a term
   */
  getSections(term: string): ClassSection[] {
    const rows = this.db.prepare(`
      SELECT * FROM class_sections WHERE term = ?
    `).all(term) as any[];

    return rows.map(row => ({
      id: row.id,
      subjectCode: row.subject_code,
      section: row.section,
      courseTitle: row.course_title,
      units: row.units,
      schedule: this.getScheduleSlots(row.id),
      instructor: row.instructor,
      maxCapacity: row.max_capacity,
      freeSlots: row.free_slots,
      lang: row.lang,
      level: row.level,
      remarks: row.remarks,
      hasPrerequisites: row.has_prerequisites === 1,
      term: row.term,
      department: row.department,
      scrapedAt: new Date(row.scraped_at)
    }));
  }

  /**
   * Get schedule slots for a section
   */
  private getScheduleSlots(sectionId: string) {
    const rows = this.db.prepare(`
      SELECT * FROM schedule_slots WHERE section_id = ?
    `).all(sectionId) as any[];

    return rows.map(row => ({
      day: row.day,
      startTime: row.start_time,
      endTime: row.end_time,
      room: row.room,
      modality: row.modality
    }));
  }

  /**
   * Search courses
   */
  searchCourses(query: string): Course[] {
    const rows = this.db.prepare(`
      SELECT c.* FROM courses c
      JOIN courses_fts fts ON c.rowid = fts.rowid
      WHERE courses_fts MATCH ?
      LIMIT 20
    `).all(query) as any[];

    return rows.map(row => ({
      catNo: row.cat_no,
      title: row.title,
      units: row.units,
      prerequisites: [],
      category: row.category || '',
      year: 0,
      semester: 0
    }));
  }

  /**
   * Get statistics
   */
  getStats(): { sections: number; courses: number; programs: number } {
    const sections = (this.db.prepare('SELECT COUNT(*) as count FROM class_sections').get() as any).count;
    const courses = (this.db.prepare('SELECT COUNT(*) as count FROM courses').get() as any).count;
    const programs = (this.db.prepare('SELECT COUNT(*) as count FROM degree_programs').get() as any).count;
    return { sections, courses, programs };
  }

  /**
   * Close database
   */
  close(): void {
    this.db.close();
  }
}

export const db = new SISIADatabase();
