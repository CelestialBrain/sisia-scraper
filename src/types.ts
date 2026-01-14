/**
 * AISIS Scraper Type Definitions
 */

// ============ Class Schedule Types ============

export interface ScheduleSlot {
  day: string;          // "M", "T", "W", "TH", "F", "S"
  startTime: string;    // "08:30"
  endTime: string;      // "10:00"
  room: string;         // "SEC A 301"
  modality: string;     // "FULLY ONSITE", "HYBRID", "FULLY ONLINE"
}

export interface ClassSection {
  id: string;           // Unique: subjectCode-section-term
  subjectCode: string;  // "CS 124"
  section: string;      // "A"
  courseTitle: string;  // "Introduction to Computer Science"
  units: number;
  schedule: ScheduleSlot[];
  instructor: string;
  maxCapacity: number;
  freeSlots: number;
  lang: string;         // "ENG", "FIL"
  level: string;        // "U" (Undergrad), "G" (Graduate)
  remarks: string;
  hasPrerequisites: boolean;
  term: string;         // "2025-2"
  department: string;   // "CS"
  scrapedAt: Date;
}

// ============ Curriculum Types ============

export interface Course {
  catNo: string;        // "CS 124"
  title: string;
  units: number;
  prerequisites: string[];  // ["CS 121", "MATH 101"]
  category: string;     // "Major", "Core", "Elective"
  year: number;         // 1, 2, 3, 4
  semester: number;     // 1, 2, 3 (summer)
}

export interface Curriculum {
  degreeCode: string;   // "BS CS_2024_1"
  degreeName: string;   // "BS Computer Science"
  courses: Course[];
  totalUnits: number;
}

export interface CurriculumCourse {
  degCode: string;      // "BS CS_2024_1"
  subjectCode: string;  // "CSCI 21"
  courseTitle: string;  // "Introduction to Programming I"
  units: number;
  prerequisites: string;
  category?: string;    // "C"=Core, "M"=Major, "E"=Elective, etc.
  year: number;         // 1, 2, 3, 4
  semester: number;     // 0 (summer), 1, 2
}

// ============ AISIS Session Types ============

export interface AISISSession {
  jsessionid: string;
  cookies: Record<string, string>;
  rnd?: string;
}

// ============ Scraper Options ============

export interface ScraperOptions {
  concurrentRequests: number;
  requestDelayMs: number;
  verbose: boolean;
  outputDir: string;
}

// ============ Department and Period Types ============

export interface Department {
  code: string;
  name: string;
}

export interface AcademicPeriod {
  value: string;        // "2025-2"
  label: string;        // "2nd Semester 2025-2026"
}

export interface DegreeProgram {
  code: string;         // "BS CS_2024_1"
  name: string;         // "BS Computer Science"
  isHonors: boolean;    // Has -H suffix
  track: string | null; // Track code (CT, MT, BE, etc.)
  specialization: string | null;
  year: number | null;
  semester: number | null;
}
