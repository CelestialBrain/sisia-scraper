/**
 * Build Curriculum Schedule Tool
 * 
 * Automatically builds a schedule from a program's curriculum.
 * Combines curriculum lookup with schedule building.
 */

import { SchemaType } from '@google/generative-ai';
import { db } from './db.js';
import { buildSchedule } from '../../models/ClassSection.js';

export const definition = {
  name: 'build_curriculum_schedule',
  description: 'Automatically build a conflict-free schedule from a degree program curriculum. Specify program, year, and semester to get courses, then builds optimal schedule.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      program: { 
        type: SchemaType.STRING, 
        description: 'Program code or name (e.g., "BS CS", "BS Mathematics", "AB Economics")' 
      },
      year: { 
        type: SchemaType.NUMBER, 
        description: 'Year level (1-4)' 
      },
      semester: { 
        type: SchemaType.NUMBER, 
        description: 'Semester (1 or 2)' 
      },
      morning_only: { 
        type: SchemaType.BOOLEAN, 
        description: 'Only include morning classes' 
      },
      no_saturday: { 
        type: SchemaType.BOOLEAN, 
        description: 'Exclude Saturday classes' 
      },
      no_friday: { 
        type: SchemaType.BOOLEAN, 
        description: 'Exclude Friday classes' 
      },
      start_after: {
        type: SchemaType.STRING,
        description: 'Only classes starting at/after this time (e.g., "13:00" for afternoon only)'
      },
      start_before: {
        type: SchemaType.STRING,
        description: 'Only classes starting before this time (e.g., "12:00" for morning)'
      },
      building_filter: {
        type: SchemaType.STRING,
        description: 'Only rooms in this building (e.g., "SEC", "CTC", "G")'
      },
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code (default: 2025-2)' 
      },
    },
    required: ['program', 'year', 'semester'],
  },
};

// Program alias expansion - maps common queries to database program codes
const PROGRAM_ALIASES: Record<string, string[]> = {
  // Computer Science
  'cs': ['Computer Science', 'BSCS', 'BS CS'],
  'compsci': ['Computer Science', 'BSCS', 'BS CS'],
  'computer science': ['BS CS', 'BSCS'],
  
  // Mathematics
  'math': ['Mathematics', 'BS Mathematics', 'BSMA'],
  'maths': ['Mathematics', 'BS Mathematics', 'BSMA'],
  
  // Management Engineering
  'me': ['Management Engineering', 'BS ME', 'BSME'],
  'mgt eng': ['Management Engineering', 'BS ME'],
  'management engineering': ['BS ME', 'BSME'],
  'bs me': ['BS ME'],
  'bs management engineering': ['BS ME'],
  'bsme': ['BS ME'],
  
  // Management - regular and honors
  'management': ['BS Management', 'BS MGT', 'BSMGT'],
  'mgt': ['BS Management', 'BS MGT'],
  'management honors': ['BS MGT-H', 'BACHELOR OF SCIENCE IN MANAGEMENT (HONORS PROGRAM)'],
  'bs mgt honors': ['BS MGT-H'],
  'bsmgt-h': ['BS MGT-H'],
  
  // Economics - regular and honors
  'eco': ['Economics', 'AB Economics', 'ABEC'],
  'econ': ['Economics', 'AB Economics', 'ABEC'],
  'economics': ['AB Economics', 'AB EC'],
  'economics honors': ['AB EC-H', 'BACHELOR OF ARTS IN ECONOMICS (HONORS PROGRAM)'],
  'ab ec honors': ['AB EC-H'],
  'eco honors': ['AB EC-H'],
  
  // Psychology
  'psych': ['Psychology', 'AB Psychology', 'ABPS'],
  'psychology': ['AB Psychology', 'AB PSY'],
  
  // Communication
  'comm': ['Communication', 'AB Communication', 'ABCOMM'],
  'comms': ['Communication', 'AB Communication'],
  
  // Chinese Studies - all tracks
  'chinese studies': ['AB ChnS', 'BACHELOR OF ARTS IN CHINESE STUDIES'],
  'chns': ['AB ChnS'],
  'chinese studies business': ['AB ChnS-B', 'Chinese Studies Business Track'],
  'chns-b': ['AB ChnS-B'],
  'chinese studies humanities': ['AB ChnS-H'],
  'chns-h': ['AB ChnS-H'],
  'chinese studies applied chinese': ['AB ChnS-AC'],
  'chns-ac': ['AB ChnS-AC'],
  'chinese studies social sciences': ['AB ChnS-S'],
  'chns-s': ['AB ChnS-S'],
  
  // Humanities
  'humanities': ['AB HUM', 'AB Humanities', 'BACHELOR OF ARTS IN HUMANITIES'],
  'hum': ['AB HUM'],
  
  // Information Systems
  'mis': ['BS MIS', 'Management Information Systems'],
  'information systems': ['BS MIS', 'BSMIS'],
  
  // Chemistry
  'chem': ['BS Chemistry', 'BS CHE'],
  'chemistry': ['BS Chemistry', 'BS CHE'],
  'applied chemistry': ['BS MAC', 'Management of Applied Chemistry'],
  'mac': ['BS MAC'],
  
  // Physics
  'physics': ['BS Physics', 'BS PHY'],
  'phy': ['BS Physics'],
  
  // Biology
  'bio': ['BS Biology', 'BS BIO'],
  'biology': ['BS Biology'],
  
  // Legal Management
  'legal management': ['BS LM', 'BSLM'],
  'lm': ['BS LM'],
};

function expandProgramAlias(program: string): string[] {
  const lower = program.toLowerCase();
  const aliases = PROGRAM_ALIASES[lower];
  if (aliases) return [program, ...aliases];
  return [program];
}

export function handler(args: { 
  program: string; 
  year: number; 
  semester: number;
  morning_only?: boolean;
  no_saturday?: boolean;
  no_friday?: boolean;
  start_after?: string;
  start_before?: string;
  building_filter?: string;
  term?: string 
}) {
  const term = args.term || '2025-2';
  const programVariants = expandProgramAlias(args.program);
  
  // Find matching program
  const programConditions = programVariants.map(() => 'dp.name LIKE ?').join(' OR ');
  const programParams = programVariants.map(p => `%${p}%`);
  
  const curriculumCourses = db.prepare(`
    SELECT DISTINCT c.course_code, c.title, c.units, cc.year, cc.semester, cc.category
    FROM curriculum_course cc
    JOIN course c ON cc.course_id = c.id
    JOIN degree_program dp ON cc.degree_id = dp.id
    WHERE (${programConditions})
    AND cc.year = ? AND cc.semester = ?
    ORDER BY cc.category, c.course_code
  `).all(...programParams, args.year, args.semester) as Array<{
    course_code: string;
    title: string;
    units: number;
    year: number;
    semester: number;
    category: string | null;
  }>;
  
  if (curriculumCourses.length === 0) {
    return {
      error: `No curriculum found for ${args.program} Year ${args.year} Semester ${args.semester}`,
      suggestions: 'Try different program names like "BS CS", "BS Mathematics", "AB Economics"'
    };
  }
  
  // Get total units
  const totalUnits = curriculumCourses.reduce((sum, c) => sum + (c.units || 0), 0);
  
  // Check which courses are offered this term
  const courseCodes = curriculumCourses.map(c => c.course_code);
  const offeredCourses: string[] = [];
  const notOfferedCourses: string[] = [];
  
  // Course equivalency mapping - curriculum codes may differ from actual offered courses
  const COURSE_EQUIVALENTS: Record<string, string[]> = {
    // Natural Science equivalents
    'NatSc 10.01': ['ENVI 10.01', 'NSCI 10.01', 'CHEM 10.01', 'BIO 10.01', 'PHYS 10.01'],
    'NatSc 10.02': ['ENVI 10.02', 'NSCI 10.02', 'CHEM 10.02', 'BIO 10.02', 'PHYS 10.02'],
    // DECSC equivalents (older curriculum uses 22/23, newer uses just 22 or 23)
    'DECSC 22/23': ['DECSC 22', 'DECSC 23'],
    // Physical Education equivalents (PE, PHYED, PATHFit, PEPC are interchangeable)
    'PATHFit 1': ['PEPC 11.03', 'PEPC 11.04', 'PEPC 11.05', 'PEPC 11.06'],
    'PATHFit 2': ['PEPC 11.13', 'PEPC 11.14', 'PEPC 11.15', 'PEPC 11.02'],
    'PATHFit 3': ['PEPC 11.23', 'PEPC 11.24', 'PEPC 11.25'],
    'PATHFit 4': ['PEPC 11.30'],
    'PE 1': ['PEPC 11.03', 'PEPC 11.04', 'PEPC 11.05', 'PEPC 11.06'],
    'PE 2': ['PEPC 11.13', 'PEPC 11.14', 'PEPC 11.15', 'PEPC 11.02'],
    'PE 3': ['PEPC 11.23', 'PEPC 11.24', 'PEPC 11.25'],
    'PE 4': ['PEPC 11.30'],
    'PHYED 1': ['PEPC 11.03', 'PEPC 11.04', 'PEPC 11.05', 'PEPC 11.06'],
    'PHYED 2': ['PEPC 11.13', 'PEPC 11.14', 'PEPC 11.15', 'PEPC 11.02'],
    'PHYED 3': ['PEPC 11.23', 'PEPC 11.24', 'PEPC 11.25'],
    'PHYED 4': ['PEPC 11.30'],
  };
  
  for (const code of courseCodes) {
    // First try the exact course code
    const sections = db.prepare(`
      SELECT COUNT(*) as count
      FROM class_section cs
      JOIN course c ON cs.course_id = c.id
      JOIN term t ON cs.term_id = t.id
      WHERE c.course_code = ? AND t.code = ?
    `).get(code, term) as { count: number };
    
    if (sections.count > 0) {
      offeredCourses.push(code);
    } else {
      // Try equivalent courses
      const equivalents = COURSE_EQUIVALENTS[code];
      let foundEquivalent = false;
      
      if (equivalents) {
        for (const equiv of equivalents) {
          const equivSections = db.prepare(`
            SELECT COUNT(*) as count
            FROM class_section cs
            JOIN course c ON cs.course_id = c.id
            JOIN term t ON cs.term_id = t.id
            WHERE c.course_code = ? AND t.code = ?
          `).get(equiv, term) as { count: number };
          
          if (equivSections.count > 0) {
            offeredCourses.push(equiv); // Use the equivalent course code
            foundEquivalent = true;
            break;
          }
        }
      }
      
      if (!foundEquivalent) {
        notOfferedCourses.push(code);
      }
    }
  }
  
  // Build schedule only for offered courses
  if (offeredCourses.length === 0) {
    return {
      curriculum: curriculumCourses,
      total_units: totalUnits,
      offered_this_term: [],
      not_offered: notOfferedCourses,
      message: 'None of the curriculum courses are offered this term.',
      schedule: null
    };
  }
  
  // Build the schedule
  const scheduleResult = buildSchedule(
    offeredCourses,
    {
      morning_only: args.morning_only,
      no_saturday: args.no_saturday,
      no_friday: args.no_friday,
      start_after: args.start_after,
      start_before: args.start_before,
      building_filter: args.building_filter
    },
    term
  );
  
  return {
    program: args.program,
    year: args.year,
    semester: args.semester,
    curriculum: curriculumCourses.map(c => ({
      code: c.course_code,
      title: c.title,
      units: c.units,
      category: c.category
    })),
    total_units: totalUnits,
    offered_this_term: offeredCourses,
    not_offered: notOfferedCourses,
    schedule: scheduleResult.success ? scheduleResult : null,
    schedule_message: scheduleResult.message
  };
}
