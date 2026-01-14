/**
 * Degree Code Parser
 * Parses AISIS degree codes to extract program, track, honors, and version info
 * 
 * Patterns discovered:
 * - Basic: "BS ME_2025_1" → Program: BS ME, Year: 2025, Sem: 1
 * - Honors: "AB EC-H_2024_1" → Honors program (suffix -H)
 * - Track in version: "BS LfSci_24CT_1" → Track: CT (24CT = year 24, track CT)
 * - Hyphenated track: "AB LIT(ENG)-LCS_24TB_0" → Specialization: LCS
 * - Combined program: "BS CS-DGDD_2024_1" → Combined degree
 */

export interface DegreeCodeParsed {
  raw: string;                // Original code
  programCode: string;        // "BS ME", "AB EC-H"
  programBase: string;        // Without honors suffix: "BS ME", "AB EC"
  isHonors: boolean;          // Has -H suffix
  track: string | null;       // Track code if present
  specialization: string | null; // Hyphenated specialization
  year: number | null;        // Version year
  semester: number | null;    // Version semester
  fullName: string;           // Display name
}

/**
 * Parse a degree code string into structured data
 */
export function parseDegreeCode(code: string, displayName?: string): DegreeCodeParsed {
  const result: DegreeCodeParsed = {
    raw: code,
    programCode: '',
    programBase: '',
    isHonors: false,
    track: null,
    specialization: null,
    year: null,
    semester: null,
    fullName: displayName || code
  };

  if (!code) return result;

  // Split by underscore: PROGRAM_VERSION_SEMESTER
  const parts = code.split('_');
  
  if (parts.length >= 1) {
    result.programCode = parts[0];
    
    // Check for honors (-H suffix)
    result.isHonors = result.programCode.includes('-H');
    result.programBase = result.programCode.replace(/-H$/, '');
    
    // Check for hyphenated specialization (e.g., LIT(ENG)-LCS, POS-MPM)
    const specMatch = result.programBase.match(/^(.+)-([A-Z]{2,5})$/);
    if (specMatch && !result.isHonors) {
      result.specialization = specMatch[2];
    }
  }
  
  if (parts.length >= 2) {
    const versionPart = parts[1];
    
    // Pattern 1: Pure year (2024, 2025)
    if (/^\d{4}$/.test(versionPart)) {
      result.year = parseInt(versionPart);
    }
    // Pattern 2: Short year + track (24CT, 24MT, 20BE)
    else if (/^\d{2}[A-Z]{2,4}$/.test(versionPart)) {
      const yearShort = versionPart.substring(0, 2);
      result.track = versionPart.substring(2);
      result.year = 2000 + parseInt(yearShort);
    }
    // Pattern 3: Year-like with letters (24TB)
    else if (/^\d{2,4}[A-Z]+$/.test(versionPart)) {
      const match = versionPart.match(/^(\d{2,4})([A-Z]+)$/);
      if (match) {
        const yearNum = parseInt(match[1]);
        result.year = yearNum < 100 ? 2000 + yearNum : yearNum;
        result.track = match[2];
      }
    }
  }
  
  if (parts.length >= 3) {
    const semPart = parts[2];
    if (/^\d$/.test(semPart)) {
      result.semester = parseInt(semPart);
    }
  }

  return result;
}

/**
 * Format degree info for display
 */
export function formatDegreeInfo(parsed: DegreeCodeParsed): string {
  let info = parsed.programBase;
  
  if (parsed.isHonors) {
    info += ' (Honors)';
  }
  
  if (parsed.track) {
    info += ` - Track ${parsed.track}`;
  }
  
  if (parsed.specialization) {
    info += ` - ${parsed.specialization}`;
  }
  
  if (parsed.year) {
    info += ` (Ver ${parsed.year})`;
  }
  
  return info;
}

/**
 * Extract track name from code if known
 */
export function getTrackFullName(trackCode: string): string {
  const trackNames: Record<string, string> = {
    'CT': 'Communication',
    'MT': 'Molecular Technology',
    'BE': 'Business Economics',
    'IR': 'International Relations',
    'LCS': 'Literary and Cultural Studies',
    'TB': 'Track B',
    'HUM': 'Humanities',
    'HON': 'Honors'
  };
  
  return trackNames[trackCode] || trackCode;
}
