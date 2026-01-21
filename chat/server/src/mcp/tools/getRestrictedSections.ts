/**
 * Get Restricted Sections Tool
 * 
 * Find sections with restrictions (majors only, cross-reg, etc.)
 * Uses the remarks field from class_section.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_restricted_sections',
  description: 'Find sections with enrollment restrictions like "for majors only" or "cross-registration slots". Parses the remarks field.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      restriction_type: { 
        type: SchemaType.STRING, 
        description: 'Type: "majors" (for majors only), "cross_reg" (cross-registration), "dissolved" (will be dissolved), or "all"' 
      },
      department: { 
        type: SchemaType.STRING, 
        description: 'Filter by department code' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 30)' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: [],
  },
};

export function handler(args: { restriction_type?: string; department?: string; limit?: number; term?: string }) {
  const term = args.term || '2025-2';
  const limit = Math.min(args.limit || 30, 50);
  const restrictionType = (args.restriction_type || 'all').toLowerCase();
  
  let remarkFilter = "cs.remarks IS NOT NULL AND cs.remarks != '' AND cs.remarks != '-'";
  let filterLabel = 'all restrictions';
  
  if (restrictionType === 'majors' || restrictionType.includes('major')) {
    remarkFilter += " AND (UPPER(cs.remarks) LIKE '%MAJOR%' OR UPPER(cs.remarks) LIKE '%FOR%MAJORS%')";
    filterLabel = 'for majors only';
  } else if (restrictionType === 'cross_reg' || restrictionType.includes('cross')) {
    remarkFilter += " AND UPPER(cs.remarks) LIKE '%CROSS REG%'";
    filterLabel = 'cross-registration';
  } else if (restrictionType === 'dissolved' || restrictionType.includes('dissolve')) {
    remarkFilter += " AND UPPER(cs.remarks) LIKE '%DISSOLVE%'";
    filterLabel = 'will be dissolved';
  }
  
  let query = `
    SELECT 
      c.course_code, 
      c.title, 
      cs.section,
      i.name as instructor,
      cs.free_slots,
      cs.max_capacity,
      cs.remarks,
      d.code as department
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    WHERE t.code = ? AND ${remarkFilter}
  `;
  
  const params: unknown[] = [term];
  
  if (args.department) {
    query += ` AND (d.code LIKE ? OR c.course_code LIKE ?)`;
    params.push(`%${args.department}%`, `${args.department}%`);
  }
  
  query += ` ORDER BY c.course_code, cs.section LIMIT ?`;
  params.push(limit);
  
  const sections = db.prepare(query).all(...params) as Array<{
    course_code: string;
    title: string;
    section: string;
    instructor: string | null;
    free_slots: number;
    max_capacity: number;
    remarks: string;
    department: string | null;
  }>;
  
  // Categorize restrictions
  const categories: Record<string, number> = {};
  for (const s of sections) {
    const upper = s.remarks.toUpperCase();
    if (upper.includes('MAJOR')) categories['majors_only'] = (categories['majors_only'] || 0) + 1;
    if (upper.includes('CROSS REG')) categories['cross_reg'] = (categories['cross_reg'] || 0) + 1;
    if (upper.includes('DISSOLVE')) categories['dissolved'] = (categories['dissolved'] || 0) + 1;
  }
  
  return {
    term,
    filter: filterLabel,
    total_found: sections.length,
    categories,
    sections: sections.map(s => ({
      course: s.course_code,
      title: s.title,
      section: s.section,
      instructor: s.instructor || 'TBA',
      free_slots: s.free_slots,
      enrolled: s.max_capacity - s.free_slots,
      restriction: s.remarks
    }))
  };
}
