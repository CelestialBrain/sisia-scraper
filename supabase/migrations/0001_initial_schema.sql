-- AISIS Scraper Schema for Supabase (PostgreSQL)
-- Migration: Create initial tables

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Degree Programs
CREATE TABLE IF NOT EXISTS degree_programs (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_honors BOOLEAN DEFAULT FALSE,
  track TEXT,
  specialization TEXT,
  version_year INTEGER,
  version_semester INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Class Sections
CREATE TABLE IF NOT EXISTS class_sections (
  id TEXT PRIMARY KEY,  -- composite: term-subjectCode-section
  subject_code TEXT NOT NULL,
  section TEXT NOT NULL,
  course_title TEXT NOT NULL,
  units INTEGER DEFAULT 0,
  instructor TEXT,
  max_capacity INTEGER DEFAULT 0,
  free_slots INTEGER DEFAULT 0,
  lang TEXT,
  level TEXT,
  remarks TEXT,
  has_prerequisites BOOLEAN DEFAULT FALSE,
  term TEXT NOT NULL,
  department TEXT NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Schedule Slots (for class sections)
CREATE TABLE IF NOT EXISTS schedule_slots (
  id SERIAL PRIMARY KEY,
  class_section_id TEXT REFERENCES class_sections(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room TEXT,
  modality TEXT DEFAULT 'ONSITE'
);

-- Curriculum Courses (courses in a degree program)
CREATE TABLE IF NOT EXISTS curriculum_courses (
  id SERIAL PRIMARY KEY,
  degree_code TEXT REFERENCES degree_programs(code) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  course_title TEXT NOT NULL,
  units NUMERIC(3,1) DEFAULT 0,
  prerequisites TEXT,
  year INTEGER,
  semester INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(degree_code, subject_code)
);

-- Courses Master (unique courses across all curricula)
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  cat_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  units NUMERIC(3,1) DEFAULT 0,
  department TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_class_sections_term ON class_sections(term);
CREATE INDEX IF NOT EXISTS idx_class_sections_department ON class_sections(department);
CREATE INDEX IF NOT EXISTS idx_class_sections_subject_code ON class_sections(subject_code);
CREATE INDEX IF NOT EXISTS idx_curriculum_courses_degree ON curriculum_courses(degree_code);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_section ON schedule_slots(class_section_id);

-- Full-text search on courses
CREATE INDEX IF NOT EXISTS idx_courses_fts ON courses USING GIN(to_tsvector('english', cat_no || ' ' || title));
