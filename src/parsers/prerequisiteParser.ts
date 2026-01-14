/**
 * Prerequisite Parser
 * Handles complex prerequisite text parsing into structured data
 * 
 * Examples:
 * - "CS 121" -> ["CS 121"]
 * - "MATH 101 or MATH 102" -> ["MATH 101", "MATH 102"] (OR group)
 * - "CS 121 and MATH 101" -> ["CS 121", "MATH 101"] (both required)
 * - "Consent of instructor" -> [] (ignored)
 * - "None" -> []
 */

// Regex to match course codes (e.g., "CS 121", "ENGL 101", "PHILO 101.01")
const COURSE_CODE_REGEX = /\b([A-Z]{2,5})\s*(\d{2,3}(?:\.\d{1,2})?)\b/gi;

export interface PrerequisiteResult {
  courses: string[];
  raw: string;
  hasConsentClause: boolean;
}

/**
 * Parse prerequisite text into array of course codes
 */
export function parsePrerequisites(text: string): PrerequisiteResult {
  if (!text || text.trim() === '' || text.toLowerCase() === 'none') {
    return { courses: [], raw: text, hasConsentClause: false };
  }

  const normalized = text.trim();
  const hasConsentClause = /consent|permission|approval/i.test(normalized);

  // Extract all course codes
  const courses: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  COURSE_CODE_REGEX.lastIndex = 0;
  
  while ((match = COURSE_CODE_REGEX.exec(normalized)) !== null) {
    const dept = match[1].toUpperCase();
    const num = match[2];
    const courseCode = `${dept} ${num}`;
    
    // Avoid duplicates
    if (!courses.includes(courseCode)) {
      courses.push(courseCode);
    }
  }

  return {
    courses,
    raw: normalized,
    hasConsentClause
  };
}

/**
 * Parse prerequisite text with OR/AND logic
 * Returns array of arrays for OR groups
 * e.g., "CS 121 and (MATH 101 or MATH 102)" -> [["CS 121"], ["MATH 101", "MATH 102"]]
 */
export function parsePrerequisitesAdvanced(text: string): string[][] {
  const result = parsePrerequisites(text);
  
  if (result.courses.length === 0) {
    return [];
  }

  // For now, return flat list (can be enhanced with OR group parsing)
  // Each course is its own requirement (AND logic)
  return result.courses.map(c => [c]);
}

/**
 * Normalize course code format
 */
export function normalizeCourseCode(code: string): string {
  const match = code.match(/([A-Z]{2,5})\s*(\d{2,3}(?:\.\d{1,2})?)/i);
  if (match) {
    return `${match[1].toUpperCase()} ${match[2]}`;
  }
  return code.toUpperCase().trim();
}
