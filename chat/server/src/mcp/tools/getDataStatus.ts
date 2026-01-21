/**
 * Get Data Status Tool
 * Returns when schedule/curriculum data was last updated
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_data_status',
  description: `Get information about when the class schedule or curriculum data was last updated.
Use this when users ask about data freshness, last update time, or database status.
SECURITY: Only returns aggregated statistics, never user data or system internals.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      data_type: {
        type: SchemaType.STRING,
        description: 'Type of data to check (schedule, curriculum, or all). Default: all'
      }
    },
    required: []
  }
};

export function handler(args: { data_type?: string }) {
  const { data_type = 'all' } = args;
  
  const results: Record<string, unknown> = {};
  
  if (data_type === 'all' || data_type === 'schedule') {
    const scheduleRun = db.prepare(`
      SELECT 
        started_at,
        completed_at,
        term_code,
        total_scraped,
        inserted,
        updated,
        status
      FROM scrape_run 
      WHERE scrape_type = 'schedule' AND status = 'completed'
      ORDER BY completed_at DESC 
      LIMIT 1
    `).get() as { started_at: string; completed_at: string; term_code: string; total_scraped: number; inserted: number; updated: number; status: string } | undefined;
    
    const scheduleStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT cs.id) as total_sections,
        COUNT(DISTINCT c.id) as total_courses,
        COUNT(DISTINCT i.id) as total_instructors
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      LEFT JOIN instructor i ON cs.instructor_id = i.id
    `).get() as { total_sections: number; total_courses: number; total_instructors: number };
    
    results.schedule = {
      last_updated: scheduleRun?.completed_at || 'Never',
      term: scheduleRun?.term_code || 'Unknown',
      total_sections: scheduleStats?.total_sections || 0,
      total_courses: scheduleStats?.total_courses || 0,
      total_instructors: scheduleStats?.total_instructors || 0
    };
  }
  
  if (data_type === 'all' || data_type === 'curriculum') {
    const curriculumRun = db.prepare(`
      SELECT 
        started_at,
        completed_at,
        total_scraped,
        status
      FROM scrape_run 
      WHERE scrape_type = 'curriculum' AND status = 'completed'
      ORDER BY completed_at DESC 
      LIMIT 1
    `).get() as { started_at: string; completed_at: string; total_scraped: number; status: string } | undefined;
    
    const curriculumStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT dp.id) as total_programs,
        COUNT(DISTINCT cc.id) as total_curriculum_entries
      FROM degree_program dp
      LEFT JOIN curriculum_course cc ON dp.id = cc.degree_id
    `).get() as { total_programs: number; total_curriculum_entries: number };
    
    results.curriculum = {
      last_updated: curriculumRun?.completed_at || 'Never',
      total_programs: curriculumStats?.total_programs || 0,
      total_curriculum_entries: curriculumStats?.total_curriculum_entries || 0
    };
  }
  
  // Add available terms
  const terms = db.prepare(`
    SELECT code, year, semester FROM term ORDER BY year DESC, semester DESC LIMIT 5
  `).all() as { code: string; year: number; semester: number }[];
  
  results.available_terms = terms.map(t => ({
    code: t.code,
    label: `${t.year}-${t.semester === 1 ? '1st' : '2nd'} Semester`
  }));
  
  return results;
}
