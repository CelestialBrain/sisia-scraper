/**
 * List Degree Programs Tool
 * Returns all available degree programs (curricula)
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'list_programs',
  description: `List all available degree programs (curricula) in the database.
Use this when users ask about available majors, degrees, or want to browse programs.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      search: {
        type: SchemaType.STRING,
        description: 'Search term to filter programs (e.g., "Computer Science", "BS", "AB")'
      },
      degree_type: {
        type: SchemaType.STRING,
        description: 'Filter by degree type (undergraduate, graduate, or all). Default: all'
      },
      latest_only: {
        type: SchemaType.BOOLEAN,
        description: 'Only show latest version of each program (default: true)'
      }
    },
    required: []
  }
};

export function handler(args: { search?: string; degree_type?: string; latest_only?: boolean }) {
  const { search, degree_type = 'all', latest_only = true } = args;
  
  const whereConditions: string[] = [];
  const params: string[] = [];
  
  if (search) {
    whereConditions.push("(dp.name LIKE ? OR dp.code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  
  if (degree_type === 'undergraduate') {
    whereConditions.push("(dp.code LIKE 'AB%' OR dp.code LIKE 'BS%' OR dp.code LIKE 'BFA%')");
  } else if (degree_type === 'graduate') {
    whereConditions.push("(dp.code LIKE 'M%' OR dp.code LIKE 'PhD%' OR dp.code LIKE 'JD%')");
  }
  
  const whereClause = whereConditions.length > 0 
    ? 'WHERE ' + whereConditions.join(' AND ')
    : '';
  
  let query = `
    SELECT 
      dp.code,
      dp.name,
      dp.version_year,
      dp.version_semester,
      dp.is_honors,
      dp.track,
      dp.specialization,
      COUNT(cc.id) as course_count
    FROM degree_program dp
    LEFT JOIN curriculum_course cc ON dp.id = cc.degree_id
    ${whereClause}
    GROUP BY dp.id
    ORDER BY dp.name, dp.version_year DESC
    LIMIT 50
  `;
  
  const results = db.prepare(query).all(...params) as {
    code: string;
    name: string;
    version_year: number;
    version_semester: number;
    is_honors: number;
    track: string;
    specialization: string;
    course_count: number;
  }[];
  
  // If latest_only, filter to keep only latest version per program name
  let filtered = results;
  if (latest_only) {
    const seen = new Map<string, typeof results[0]>();
    for (const p of results) {
      const existing = seen.get(p.name);
      if (!existing || p.version_year > existing.version_year) {
        seen.set(p.name, p);
      }
    }
    filtered = Array.from(seen.values());
  }
  
  return {
    programs: filtered.map(p => ({
      code: p.code,
      name: p.name,
      version: `${p.version_year}-${p.version_semester}`,
      is_honors: p.is_honors === 1,
      track: p.track,
      specialization: p.specialization,
      course_count: p.course_count
    })),
    total_count: filtered.length,
    showing_latest_only: latest_only
  };
}
