-- AISIS Scraper Schema v2 - Normalized with Integer Keys
-- Migration: Drop old schema, create normalized tables

-- ============================================
-- DROP OLD TABLES (if migrating from v1)
-- ============================================
DROP TABLE IF EXISTS schedule_slots CASCADE;
DROP TABLE IF EXISTS curriculum_courses CASCADE;
DROP TABLE IF EXISTS class_sections CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS degree_programs CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- ============================================
-- LOOKUP TABLES (Small, frequently joined)
-- ============================================

-- Departments
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Academic Terms (2025-1, 2025-2, etc.)
CREATE TABLE terms (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,  -- "2025-2"
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,  -- 1, 2, or 0 (summer)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instructors (deduplicated teacher names)
CREATE TABLE instructors (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms (deduplicated room codes)
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,  -- "SEC A 301"
  building TEXT,              -- "SEC A"
  room_number TEXT,           -- "301"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MASTER DATA TABLES
-- ============================================

-- Courses (unique course catalog)
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  course_code TEXT UNIQUE NOT NULL,  -- "CSCI 21", "MATH 101"
  title TEXT NOT NULL,
  units NUMERIC(3,1) DEFAULT 0,
  department_id INTEGER REFERENCES departments(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Degree Programs
CREATE TABLE degree_programs (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,  -- "BS CS_2024_1"
  name TEXT NOT NULL,
  is_honors BOOLEAN DEFAULT FALSE,
  track TEXT,
  specialization TEXT,
  version_year INTEGER,
  version_semester INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RELATIONSHIP TABLES
-- ============================================

-- Curriculum: Which courses are in which degree programs
CREATE TABLE curriculum_courses (
  id SERIAL PRIMARY KEY,
  degree_id INTEGER NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  year INTEGER,          -- 1-5
  semester INTEGER,      -- 1, 2, or 0 (summer)
  prerequisites_raw TEXT,  -- Raw prerequisite text for parsing
  category TEXT,         -- "Core", "Elective", etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(degree_id, course_id)
);

-- Class Sections (schedule offerings)
CREATE TABLE class_sections (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  instructor_id INTEGER REFERENCES instructors(id),
  department_id INTEGER REFERENCES departments(id),
  section TEXT NOT NULL,       -- "A", "B-TH", etc.
  max_capacity INTEGER DEFAULT 0,
  free_slots INTEGER DEFAULT 0,
  lang TEXT,
  level TEXT,
  remarks TEXT,
  has_prerequisites BOOLEAN DEFAULT FALSE,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_id, term_id, section)
);

-- Schedule Slots (time/room for each section)
CREATE TABLE schedule_slots (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  day TEXT NOT NULL,           -- "Monday", "Tuesday", etc.
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  modality TEXT DEFAULT 'ONSITE'  -- "ONSITE", "ONLINE", "HYBRID"
);

-- ============================================
-- INDEXES for fast lookups
-- ============================================

-- Lookup table indexes
CREATE INDEX idx_instructors_name ON instructors(name);
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_courses_code ON courses(course_code);
CREATE INDEX idx_terms_code ON terms(code);

-- Foreign key indexes (for JOINs)
CREATE INDEX idx_sections_course ON class_sections(course_id);
CREATE INDEX idx_sections_term ON class_sections(term_id);
CREATE INDEX idx_sections_instructor ON class_sections(instructor_id);
CREATE INDEX idx_sections_dept ON class_sections(department_id);
CREATE INDEX idx_curriculum_degree ON curriculum_courses(degree_id);
CREATE INDEX idx_curriculum_course ON curriculum_courses(course_id);
CREATE INDEX idx_slots_section ON schedule_slots(section_id);
CREATE INDEX idx_slots_room ON schedule_slots(room_id);

-- Full-text search on courses
CREATE INDEX idx_courses_fts ON courses 
  USING GIN(to_tsvector('english', course_code || ' ' || title));

-- ============================================
-- HELPER VIEWS for common queries
-- ============================================

-- Full section info with all lookups
CREATE VIEW v_class_sections AS
SELECT 
  cs.id,
  c.course_code,
  c.title as course_title,
  c.units,
  cs.section,
  i.name as instructor,
  d.code as department,
  t.code as term,
  cs.max_capacity,
  cs.free_slots,
  cs.has_prerequisites
FROM class_sections cs
JOIN courses c ON cs.course_id = c.id
JOIN terms t ON cs.term_id = t.id
LEFT JOIN instructors i ON cs.instructor_id = i.id
LEFT JOIN departments d ON cs.department_id = d.id;

-- Full curriculum with course details
CREATE VIEW v_curriculum AS
SELECT
  dp.code as degree_code,
  dp.name as degree_name,
  c.course_code,
  c.title as course_title,
  c.units,
  cc.year,
  cc.semester,
  cc.prerequisites_raw,
  cc.category
FROM curriculum_courses cc
JOIN degree_programs dp ON cc.degree_id = dp.id
JOIN courses c ON cc.course_id = c.id;
