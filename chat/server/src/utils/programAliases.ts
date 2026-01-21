/**
 * Program Aliases
 * 
 * Maps common program queries to database program codes.
 * Used by curriculum lookup, schedule building, and program search.
 */

// Program alias expansion - maps common queries to database program codes
export const PROGRAM_ALIASES: Record<string, string[]> = {
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

/**
 * Expand program alias to all possible database matches
 */
export function expandProgramAlias(program: string): string[] {
  const lower = program.toLowerCase().trim();
  const aliases = PROGRAM_ALIASES[lower];
  if (aliases) return [program, ...aliases];
  return [program];
}

/**
 * Check if query matches honors program pattern
 */
export function isHonorsQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return lower.includes('honors') || lower.includes('honour') || lower.endsWith('-h');
}

/**
 * Extract track suffix from query
 */
export function extractTrackSuffix(query: string): string | null {
  const lower = query.toLowerCase();
  if (lower.includes('business')) return '-B';
  if (lower.includes('humanities')) return '-H';
  if (lower.includes('applied chinese')) return '-AC';
  if (lower.includes('social science')) return '-S';
  return null;
}
