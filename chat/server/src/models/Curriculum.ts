/**
 * Curriculum Model
 * All database queries related to degree programs and curriculum
 */

import Database from 'better-sqlite3';

let db: Database.Database;


export function initCurriculumModel(database: Database.Database) {
  db = database;
}

/**
 * Get curriculum for a degree program using fuzzy word-based matching
 */
export function getCurriculum(
  program: string,
  version?: string,
  year?: number,
  semester?: number
): {
  program_code: string;
  program_name: string;
  version: string;
  curriculum: Record<number, Record<number, Array<{code: string; title: string; prereqs?: string}>>>;
  summary: Record<string, number>;
  total_courses: number;
} | { found: false; search: string; message: string; suggestions: Array<{code: string; name: string}>; hint: string } {
  
  // Expand program aliases first (e.g., "management honors" -> "BS MGT-H")
  const lower = program.toLowerCase().trim();
  // Check for common aliases - supports partial matching
  const aliasMap: Record<string, string[]> = {
    // Management Honors
    'management honors': ['BS MGT-H', 'MGT-H'],
    'mgt honors': ['BS MGT-H', 'MGT-H'],
    'bs mgt-h': ['BS MGT-H'],
    
    // Economics Honors
    'economics honors': ['AB EC-H', 'EC-H'],
    'econ honors': ['AB EC-H', 'EC-H'],
    'ab ec-h': ['AB EC-H'],
    
    // Chinese Studies tracks
    'chinese studies business': ['AB ChnS-B', 'ChnS-B'],
    'chinese business': ['AB ChnS-B', 'ChnS-B'],
    'chns-b': ['AB ChnS-B'],
    'chns business': ['AB ChnS-B'],
    
    'chinese studies humanities': ['AB ChnS-H', 'ChnS-H'],
    'chinese humanities': ['AB ChnS-H', 'ChnS-H'],
    'chns-h': ['AB ChnS-H'],
    
    'chinese studies applied chinese': ['AB ChnS-AC', 'ChnS-AC'],
    'chinese applied': ['AB ChnS-AC', 'ChnS-AC'],
    'chns-ac': ['AB ChnS-AC'],
    
    'chinese studies social sciences': ['AB ChnS-S', 'ChnS-S'],
    'chinese social': ['AB ChnS-S', 'ChnS-S'],
    'chns-s': ['AB ChnS-S'],
    
    // Regular Chinese Studies
    'chinese studies': ['AB ChnS'],
    'chinese': ['AB ChnS', 'ChnS'],
    
    // Computer Science (BS CS)
    'computer science': ['BS CS'],
    'compsci': ['BS CS'],
    'comp sci': ['BS CS'],
    'cs': ['BS CS'],
    'bs cs': ['BS CS'],
    'bscs': ['BS CS'],
    'bs computer science': ['BS CS'],
    
    // Computer Engineering (BS CpE/CoE)
    'computer engineering': ['BS CpE', 'BS CoE'],
    'compe': ['BS CpE'],
    'cpe': ['BS CpE'],
    'coe': ['BS CoE'],
    
    // Management Engineering
    'management engineering': ['BS ME'],
    'bs management engineering': ['BS ME'],
    'bs me': ['BS ME'],
    'bsme': ['BS ME'],
    'me': ['BS ME'],
  };
  
  let searchTerm = program;
  for (const [alias, codes] of Object.entries(aliasMap)) {
    // Check both exact match and partial contains
    if (lower === alias || lower.includes(alias) || alias.includes(lower)) {
      searchTerm = codes[0]; // Use the primary code
      break;
    }
  }
  
  // Split search into words for fuzzy matching
  const searchWords = searchTerm.toUpperCase().split(/\s+/).filter(w => w.length > 1);
  
  // Build dynamic WHERE clause: each word must match either code or name
  const conditions = searchWords.map(() => `(UPPER(code) LIKE ? OR UPPER(name) LIKE ?)`).join(' AND ');
  const params: string[] = [];
  for (const word of searchWords) {
    params.push(`%${word}%`, `%${word}%`);
  }
  
  // Add version filter if provided
  let sql = `
    SELECT code, name FROM degree_program 
    WHERE ${conditions}
    ${version ? 'AND code LIKE ?' : ''}
    ORDER BY version_year DESC
    LIMIT 1
  `;
  if (version) params.push(`%${version}%`);

  const programMatch = db.prepare(sql).get(...params) as {code: string; name: string} | null;

  if (!programMatch) {
    // Fallback: try simpler LIKE search for suggestions
    const suggestions = db.prepare(`
      SELECT DISTINCT code, name FROM degree_program 
      WHERE UPPER(code) LIKE ? OR UPPER(name) LIKE ?
      ORDER BY code LIMIT 10
    `).all(`%${program.toUpperCase()}%`, `%${program.toUpperCase()}%`) as Array<{code: string; name: string}>;

    return {
      found: false,
      search: program,
      message: `No program found matching "${program}".`,
      suggestions: suggestions.map(s => ({ code: s.code.split('_')[0], name: s.name })),
      hint: 'Try partial names like "learn", "computer", "management", or codes like "BS CS", "BS ME"'
    };
  }

  // Get courses for this program
  let courseSql = `
    SELECT c.course_code, c.title, cc.year, cc.semester, cc.prerequisites_raw as prerequisites
    FROM curriculum_course cc
    JOIN course c ON cc.course_id = c.id
    WHERE cc.degree_id = (SELECT id FROM degree_program WHERE code = ?)
  `;
  const courseParams: unknown[] = [programMatch.code];

  if (year) {
    courseSql += ` AND cc.year = ?`;
    courseParams.push(year);
  }
  if (semester) {
    courseSql += ` AND cc.semester = ?`;
    courseParams.push(semester);
  }

  courseSql += ` ORDER BY cc.year, cc.semester, c.course_code`;

  const rows = db.prepare(courseSql).all(...courseParams) as Array<{
    course_code: string; title: string; year: number; semester: number; prerequisites: string;
  }>;

  // Group by year and semester
  const curriculum: Record<number, Record<number, Array<{code: string; title: string; prereqs?: string}>>> = {};
  
  for (const row of rows) {
    if (!curriculum[row.year]) curriculum[row.year] = {};
    if (!curriculum[row.year][row.semester]) curriculum[row.year][row.semester] = [];
    curriculum[row.year][row.semester].push({
      code: row.course_code,
      title: row.title,
      prereqs: row.prerequisites || undefined
    });
  }

  // Create summary
  const summary: Record<string, number> = {};
  for (const [yr, semesters] of Object.entries(curriculum)) {
    for (const [sem, courses] of Object.entries(semesters)) {
      summary[`Year ${yr} Sem ${sem}`] = (courses as Array<unknown>).length;
    }
  }

  return {
    program_code: programMatch.code.split('_')[0],
    program_name: programMatch.name,
    version: programMatch.code,
    curriculum,
    summary,
    total_courses: rows.length
  };
}

/**
 * List degree programs
 */
export function listDegreePrograms(
  search?: string,
  limit: number = 50
): { programs: Array<{code: string; name: string; course_count: number}>; total: number } {
  const searchLike = search ? `%${search}%` : '%';
  
  const rows = db.prepare(`
    SELECT code, name, 
           (SELECT COUNT(*) FROM curriculum_course cc WHERE cc.degree_id = dp.id) as course_count
    FROM degree_program dp
    WHERE name LIKE ? OR code LIKE ?
    ORDER BY code
    LIMIT ?
  `).all(searchLike, searchLike, limit) as Array<{code: string; name: string; course_count: number}>;

  return { programs: rows, total: rows.length };
}
