/**
 * Models Index
 * Export all models and initialize with database
 */

import Database from 'better-sqlite3';
import { initCourseModel } from './Course.js';
import { initInstructorModel } from './Instructor.js';
import { initRoomModel } from './Room.js';
import { initCurriculumModel } from './Curriculum.js';
import { initClassSectionModel } from './ClassSection.js';

export * from './Course.js';
export * from './Instructor.js';
export * from './Room.js';
export * from './Curriculum.js';
export * from './ClassSection.js';

/**
 * Initialize all models with database connection
 */
export function initModels(db: Database.Database) {
  initCourseModel(db);
  initInstructorModel(db);
  initRoomModel(db);
  initCurriculumModel(db);
  initClassSectionModel(db);
}
