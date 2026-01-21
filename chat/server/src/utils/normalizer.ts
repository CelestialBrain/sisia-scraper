/**
 * Course Code & Data Normalizer
 * 
 * Standardizes course codes and instructor names across different AISIS pages.
 * 
 * Course Code Formats:
 * - Database: "LLAW 113" (normalized)
 * - J_VCEC.do: "LLAW 11312018" (with term suffix)
 * - Curriculum: "LLAW 113.03" (with variant)
 */

/**
 * Normalize a course code to the standard format: "SUBJ CATALOG"
 * 
 * @example
 * normalizeCourseCode("LLAW 11312018") // "LLAW 113"
 * normalizeCourseCode("MATH 31.212018") // "MATH 31.2"
 * normalizeCourseCode("LLAW 113.03")   // "LLAW 113.03"
 * normalizeCourseCode("LLAW 113")      // "LLAW 113"
 */
export function normalizeCourseCode(raw: string): string {
  if (!raw) return '';
  
  const trimmed = raw.trim();
  
  // Handle joint courses like "ANTH/SOCIO 141.2"
  if (trimmed.includes('/')) {
    return trimmed.toUpperCase();
  }
  
  // Match: SUBJECT CATALOG[OPTIONAL_TERM_SUFFIX]
  // Term suffix is typically 5 digits (e.g., 12018 = 1st sem 2018)
  const match = trimmed.match(/^([A-Z]+)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return trimmed.toUpperCase();
  
  const subject = match[1];
  let catalogPart = match[2];
  
  // Check if there's a 5-digit term suffix after the number
  // For "31.212018" → decimal part is ".2" + term "12018"
  if (catalogPart.includes('.')) {
    const [intPart, decPart] = catalogPart.split('.');
    // If decimal part is longer than 3 digits, it likely has term suffix
    if (decPart.length > 3) {
      // Extract just the variant (first 1-2 chars) and remove term
      const variant = decPart.slice(0, decPart.length - 5);
      catalogPart = variant ? `${intPart}.${variant}` : intPart;
    }
    // Also handle letter suffixes like "i" in "185.65i"
  } else if (catalogPart.length > 4) {
    // No decimal, but longer than 4 digits - has term suffix
    catalogPart = catalogPart.slice(0, -5);
  }
  
  return `${subject.toUpperCase()} ${catalogPart}`;
}

/**
 * Extract term code from a course code with embedded term
 * 
 * @example
 * extractTermFromCode("LLAW 11312018") // "2018-1" (1st sem 2018-2019)
 * extractTermFromCode("LLAW 11322025") // "2025-2" (2nd sem 2025-2026)
 */
export function extractTermFromCode(raw: string): string | null {
  if (!raw) return null;
  
  const match = raw.match(/^[A-Z]+\s*\d+(\d{5})$/i);
  if (!match) return null;
  
  const termSuffix = match[1];
  const semCode = termSuffix[0]; // 0=summer, 1=1st sem, 2=2nd sem
  const year = termSuffix.slice(1); // e.g., "2018"
  
  const semMap: Record<string, string> = {
    '0': '0', // Summer
    '1': '1', // 1st Semester
    '2': '2', // 2nd Semester
  };
  
  return `${year}-${semMap[semCode] || semCode}`;
}

/**
 * Normalize instructor name to standard format: "LAST, First Middle"
 * 
 * AISIS uses various formats:
 * - "First LAST" (J_VCEC.do)
 * - "LAST, First Middle" (public schedule)
 * - "First Middle LAST" (some pages)
 */
export function normalizeInstructorName(raw: string): string {
  if (!raw) return '';
  
  const trimmed = raw.trim();
  
  // Already in "LAST, First" format
  if (trimmed.includes(',')) {
    return trimmed;
  }
  
  // Find the LAST all-caps word that's likely the surname
  // Must be >2 chars to exclude middle initials like "A." or "M."
  const words = trimmed.split(/\s+/);
  let lastNameIndex = -1;
  
  // Find the LAST word that is all-caps and longer than 2 chars (surname)
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    // Check if word is all-caps (excluding periods) and is a real word (not just initials)
    const cleanWord = word.replace(/\./g, '');
    if (cleanWord.length >= 2 && cleanWord === cleanWord.toUpperCase()) {
      lastNameIndex = i;
      break;
    }
  }
  
  if (lastNameIndex === -1) {
    // No all-caps word found, assume last word is last name
    if (words.length >= 2) {
      const lastName = words.pop()!;
      return `${lastName.toUpperCase()}, ${words.join(' ')}`;
    }
    return trimmed;
  }
  
  // Reconstruct as "LAST, First Middle"
  const lastName = words[lastNameIndex];
  const otherNames = [...words.slice(0, lastNameIndex), ...words.slice(lastNameIndex + 1)];
  
  if (otherNames.length > 0) {
    return `${lastName}, ${otherNames.join(' ')}`;
  }
  
  return lastName;
}

/**
 * Match a course code query to database format
 * Handles partial matches and fuzzy input
 * 
 * @example
 * matchCourseCode("llaw") // pattern for LIKE: "LLAW%"
 * matchCourseCode("math 31") // pattern: "MATH 31%"
 */
export function matchCourseCode(query: string): string {
  const normalized = normalizeCourseCode(query);
  return normalized.toUpperCase() + '%';
}
