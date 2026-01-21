/**
 * Get Enrollment Stats Tool
 * 
 * Aggregate enrollment statistics for courses/sections
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';

export const definition = {
  name: 'get_enrollment_stats',
  description: 'Get enrollment statistics showing capacity, enrolled count, and fill rates for courses or departments. Useful for finding less crowded sections or popular courses.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Specific course code (e.g., "THEO 11")' 
      },
      department: { 
        type: SchemaType.STRING, 
        description: 'Department code (e.g., "CS", "TH", "PH")' 
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
      sort_by: { 
        type: SchemaType.STRING, 
        description: 'Sort by: "fill_rate" (most full), "available" (most open), "capacity" (largest)' 
      },
      show_full_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only show sections that are full or nearly full (>90%)' 
      },
      show_open_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only show sections with available slots' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max results (default: 30)' 
      },
    },
    required: [],
  },
};

interface EnrollmentRow {
  course_code: string;
  section: string;
  instructor: string | null;
  max_capacity: number | null;
  free_slots: number | null;
  department: string;
}

export function handler(args: { 
  course_code?: string;
  department?: string;
  term?: string;
  sort_by?: string;
  show_full_only?: boolean;
  show_open_only?: boolean;
  limit?: number;
}) {
  const term = args.term || '2025-2';
  const limit = args.limit || 30;
  const sortBy = args.sort_by || 'fill_rate';
  
  let query = `
    SELECT 
      c.course_code,
      cs.section,
      i.name as instructor,
      cs.max_capacity,
      cs.free_slots,
      d.code as department
    FROM class_section cs
    JOIN course c ON cs.course_id = c.id
    JOIN term t ON cs.term_id = t.id
    LEFT JOIN instructor i ON cs.instructor_id = i.id
    LEFT JOIN department d ON c.department_id = d.id
    WHERE t.code = ?
  `;
  
  const params: unknown[] = [term];
  
  if (args.course_code) {
    query += ` AND c.course_code = ?`;
    params.push(args.course_code.toUpperCase());
  }
  
  if (args.department) {
    query += ` AND (d.code = ? OR c.course_code LIKE ?)`;
    params.push(args.department.toUpperCase(), `${args.department.toUpperCase()}%`);
  }
  
  const rows = db.prepare(query).all(...params) as EnrollmentRow[];
  
  // Calculate enrollment stats
  const sections = rows.map(row => {
    const capacity = row.max_capacity || 0;
    const freeSlots = row.free_slots || 0;
    const enrolled = capacity - freeSlots;
    const fillRate = capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0;
    
    return {
      course: row.course_code,
      section: row.section,
      instructor: row.instructor || 'TBA',
      capacity,
      enrolled,
      free_slots: freeSlots,
      fill_rate: fillRate,
      status: fillRate >= 100 ? 'FULL' : fillRate >= 90 ? 'ALMOST FULL' : fillRate >= 50 ? 'FILLING' : 'OPEN'
    };
  });
  
  // Apply filters
  let filtered = sections;
  
  if (args.show_full_only) {
    filtered = filtered.filter(s => s.fill_rate >= 90);
  }
  
  if (args.show_open_only) {
    filtered = filtered.filter(s => s.free_slots > 0);
  }
  
  // Sort
  if (sortBy === 'available') {
    filtered.sort((a, b) => b.free_slots - a.free_slots);
  } else if (sortBy === 'capacity') {
    filtered.sort((a, b) => b.capacity - a.capacity);
  } else {
    filtered.sort((a, b) => b.fill_rate - a.fill_rate);
  }
  
  // Limit
  filtered = filtered.slice(0, limit);
  
  // Calculate aggregate stats
  const totalCapacity = sections.reduce((sum, s) => sum + s.capacity, 0);
  const totalEnrolled = sections.reduce((sum, s) => sum + s.enrolled, 0);
  const fullSections = sections.filter(s => s.fill_rate >= 100).length;
  const openSections = sections.filter(s => s.free_slots > 0).length;
  
  // Group by course for summary
  const byCourse = new Map<string, { sections: number; total_capacity: number; total_enrolled: number }>();
  for (const s of sections) {
    const existing = byCourse.get(s.course) || { sections: 0, total_capacity: 0, total_enrolled: 0 };
    existing.sections++;
    existing.total_capacity += s.capacity;
    existing.total_enrolled += s.enrolled;
    byCourse.set(s.course, existing);
  }
  
  const courseSummary = Array.from(byCourse.entries())
    .map(([course, stats]) => ({
      course,
      sections: stats.sections,
      total_capacity: stats.total_capacity,
      total_enrolled: stats.total_enrolled,
      avg_fill_rate: stats.total_capacity > 0 
        ? Math.round((stats.total_enrolled / stats.total_capacity) * 100) 
        : 0
    }))
    .sort((a, b) => b.avg_fill_rate - a.avg_fill_rate)
    .slice(0, 10);
  
  return {
    query: {
      course_code: args.course_code,
      department: args.department,
      term,
      sort_by: sortBy
    },
    summary: {
      total_sections: sections.length,
      total_capacity: totalCapacity,
      total_enrolled: totalEnrolled,
      overall_fill_rate: totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0,
      full_sections: fullSections,
      open_sections: openSections,
      sections_shown: filtered.length
    },
    sections: filtered,
    by_course: args.course_code ? undefined : courseSummary,
    _format_hint: 'Present as a table with course, section, capacity, enrolled, fill rate, and status. Highlight FULL sections.'
  };
}
