/**
 * Course Code Aliasing Utility
 * 
 * Normalizes common abbreviations to database format.
 * Examples: "CS 11" → "CSCI 11", "Math10" → "MATH 10"
 */

// Common prefix aliases - maps user input to database format
const PREFIX_ALIASES: Record<string, string> = {
  // Computer Science
  'cs': 'CSCI',
  'comp': 'CSCI',
  'comsci': 'CSCI',
  
  // Mathematics
  'math': 'MATH',
  'ma': 'MATH',
  
  // Sciences
  'chem': 'CHEM',
  'bio': 'BIO',
  'phys': 'PHYS',
  'physics': 'PHYS',
  
  // Philosophy & Theology
  'phil': 'PHILO',
  'philo': 'PHILO',
  'ph': 'PHILO',  // Note: database actually uses PHILO, not PH
  'theo': 'THEO',
  'th': 'THEO',
  
  // Languages
  'eng': 'ENGL',
  'engl': 'ENGL',
  'english': 'ENGL',
  'en': 'ENGL',
  'fil': 'FILI',
  'fili': 'FILI',
  'filip': 'FILI',
  'filipino': 'FILI',
  
  // Social Sciences
  'econ': 'ECON',
  'eco': 'ECON',
  'psych': 'PSYC',
  'psy': 'PSYC',
  'psyc': 'PSYC',
  'polsci': 'POLSC',
  'pol': 'POLSC',
  'socio': 'SOCIO',
  'soc': 'SOCIO',
  'hist': 'HISTO',
  'histo': 'HISTO',
  'history': 'HISTO',
  
  // Engineering
  'engg': 'ENGG',
  'engr': 'ENGG',
  'engineering': 'ENGG',
  
  // Others
  'comm': 'COMM',
  'communication': 'COMM',
  
  // Physical Education - all variants
  'pe': 'PEPC',          // Current offerings
  'phyed': 'PHYED',      // 2020 curriculum
  'phy ed': 'PHYED',
  'physed': 'PHYED',
  'pathfit': 'PATHFit',  // 2024 curriculum requirement
  'path fit': 'PATHFit',
  'pepc': 'PEPC',        // Current elective offerings
  
  'env': 'ENVI',
  'envi': 'ENVI',
  'environmental': 'ENVI',
};

/**
 * Normalize a course code to database format.
 * Handles spacing, casing, and prefix aliasing.
 * 
 * @example
 * normalizeCourseCode("CS 11") → "CSCI 11"
 * normalizeCourseCode("math10") → "MATH 10"
 * normalizeCourseCode("ENGL 11") → "ENGL 11" (no change)
 */
export function normalizeCourseCode(code: string): string {
  if (!code) return code;
  
  // Trim and handle basic cleanup
  const normalized = code.trim();
  
  // Split into prefix and number parts
  // Handle cases like "CS11", "CS 11", "CS-11"
  const match = normalized.match(/^([A-Za-z-]+)\s*[-]?\s*(\d+\.?\d*\w*)?$/);
  
  if (!match) {
    // Can't parse, return uppercase version
    return normalized.toUpperCase();
  }
  
  const [, prefix, number] = match;
  const normalizedPrefix = prefix.toLowerCase().replace(/-/g, '');
  
  // Check for alias
  const aliasedPrefix = PREFIX_ALIASES[normalizedPrefix] || normalizedPrefix.toUpperCase();
  
  // Reconstruct with proper spacing
  if (number) {
    return `${aliasedPrefix} ${number}`;
  }
  
  return aliasedPrefix;
}

/**
 * Normalize multiple comma-separated course codes
 */
export function normalizeCourseCodes(codes: string): string {
  return codes
    .split(',')
    .map(c => normalizeCourseCode(c.trim()))
    .join(', ');
}

/**
 * Check if a course code looks valid (has prefix + number pattern)
 */
export function isValidCourseCode(code: string): boolean {
  const normalized = normalizeCourseCode(code);
  return /^[A-Z-]+\s+\d+/.test(normalized);
}

// Export the alias map for reference in prompts
export const KNOWN_PREFIXES = [
  'CSCI', 'MATH', 'CHEM', 'BIO', 'PHYS', 'PHILO', 'THEO',
  'ENGL', 'FILI', 'ECON', 'PSYC', 'POLSC', 'SOCIO', 'HISTO',
  'ENGG', 'COMM', 'PEPC', 'PHYED', 'ENVI', 'LAS', 'EURO',
  'DEV', 'CSP', 'MTHED', 'EDUC', 'BI', 'PS', 'PNTKN'
];
