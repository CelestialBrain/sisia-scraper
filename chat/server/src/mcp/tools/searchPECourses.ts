/**
 * Search PE Courses Tool
 * 
 * Unified search for all Physical Education variants:
 * - PE (2018 curriculum)
 * - PHYED (2020 curriculum) 
 * - PATHFit (2024 curriculum requirement)
 * - PEPC (current class offerings - electives)
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'search_pe_courses',
  description: 'Search for Physical Education courses across all variants: PE, PHYED, PATHFit, PEPC. Ateneo uses different codes by curriculum year.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      activity_type: { 
        type: SchemaType.STRING, 
        description: 'Filter by activity: "swimming", "yoga", "basketball", "chess", etc.' 
      },
      show_current_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only show courses with sections this term (default: false)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 30)' 
      },
    },
    required: [],
  },
};

export function handler(args: { activity_type?: string; show_current_only?: boolean; term?: string; limit?: number }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 30, 50);
  const showCurrentOnly = args.show_current_only || false;
  
  let query: string;
  const params: unknown[] = [];
  
  if (showCurrentOnly) {
    // Only courses with current sections
    query = `
      SELECT DISTINCT 
        c.course_code,
        c.title,
        c.units,
        COUNT(cs.id) as sections,
        SUM(cs.free_slots) as total_slots
      FROM course c
      JOIN class_section cs ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      WHERE t.code = ?
      AND (c.course_code LIKE 'PE %' OR c.course_code LIKE 'PHYED%' 
           OR c.course_code LIKE 'PATHFit%' OR c.course_code LIKE 'PEPC%')
    `;
    params.push(term);
    
    if (args.activity_type) {
      query += ` AND UPPER(c.title) LIKE ?`;
      params.push(`%${args.activity_type.toUpperCase()}%`);
    }
    
    query += ` GROUP BY c.id ORDER BY sections DESC LIMIT ?`;
    params.push(limit);
  } else {
    // All PE courses in catalog
    query = `
      SELECT 
        c.course_code,
        c.title,
        c.units
      FROM course c
      WHERE c.course_code LIKE 'PE %' OR c.course_code LIKE 'PHYED%' 
           OR c.course_code LIKE 'PATHFit%' OR c.course_code LIKE 'PEPC%'
    `;
    
    if (args.activity_type) {
      query += ` AND UPPER(c.title) LIKE ?`;
      params.push(`%${args.activity_type.toUpperCase()}%`);
    }
    
    query += ` ORDER BY c.course_code LIMIT ?`;
    params.push(limit);
  }
  
  const courses = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    units: number;
    sections?: number;
    total_slots?: number;
  }>;
  
  // Group by type
  const byType: Record<string, typeof courses> = {
    'PE (2018 curriculum)': courses.filter(c => c.course_code.startsWith('PE ')),
    'PHYED (2020 curriculum)': courses.filter(c => c.course_code.startsWith('PHYED')),
    'PATHFit (2024 requirement)': courses.filter(c => c.course_code.startsWith('PATHFit')),
    'PEPC (current electives)': courses.filter(c => c.course_code.startsWith('PEPC')),
  };
  
  return {
    term,
    pe_curriculum_evolution: {
      '2018': 'PE 1-4',
      '2020': 'PHYED 1-4', 
      '2024': 'PATHFit 1-4 (required core)',
      'current_offerings': 'PEPC (elective activities)'
    },
    total_found: courses.length,
    by_type: Object.fromEntries(
      Object.entries(byType)
        .filter(([, arr]) => arr.length > 0)
        .map(([key, arr]) => [key, arr.length])
    ),
    courses: courses.map(c => ({
      code: c.course_code,
      title: c.title,
      units: c.units,
      ...(showCurrentOnly ? { sections: c.sections, available_slots: c.total_slots } : {})
    }))
  };
}
