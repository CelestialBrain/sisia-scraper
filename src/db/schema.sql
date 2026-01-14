-- SISIA Database Schema
-- SQLite database for storing scraped AISIS data

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Courses (from curriculum)
CREATE TABLE IF NOT EXISTS courses (
  cat_no TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  units INTEGER DEFAULT 0,
  department TEXT,
  category TEXT,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Prerequisites
CREATE TABLE IF NOT EXISTS prerequisites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL REFERENCES courses(cat_no),
  prerequisite_id TEXT NOT NULL,
  prereq_type TEXT DEFAULT 'required', -- 'required', 'or_group', 'consent'
  raw_text TEXT,
  UNIQUE(course_id, prerequisite_id)
);

-- Class sections (from schedule)
CREATE TABLE IF NOT EXISTS class_sections (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(cat_no),
  subject_code TEXT NOT NULL,
  section TEXT NOT NULL,
  course_title TEXT,
  units INTEGER DEFAULT 0,
  instructor TEXT,
  max_capacity INTEGER DEFAULT 0,
  free_slots INTEGER DEFAULT 0,
  lang TEXT,
  level TEXT,
  remarks TEXT,
  term TEXT NOT NULL,
  department TEXT,
  has_prerequisites INTEGER DEFAULT 0,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schedule slots (many per section)
CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL REFERENCES class_sections(id),
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room TEXT,
  modality TEXT DEFAULT 'ONSITE'
);

-- Degree programs
CREATE TABLE IF NOT EXISTS degree_programs (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  total_units INTEGER DEFAULT 0,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Curriculum courses (linking table)
CREATE TABLE IF NOT EXISTS curriculum_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  degree_code TEXT NOT NULL REFERENCES degree_programs(code),
  course_id TEXT NOT NULL REFERENCES courses(cat_no),
  year INTEGER,
  semester INTEGER,
  UNIQUE(degree_code, course_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_sections_term ON class_sections(term);
CREATE INDEX IF NOT EXISTS idx_sections_dept ON class_sections(department);
CREATE INDEX IF NOT EXISTS idx_sections_instructor ON class_sections(instructor);
CREATE INDEX IF NOT EXISTS idx_prereq_course ON prerequisites(course_id);
CREATE INDEX IF NOT EXISTS idx_slots_section ON schedule_slots(section_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_degree ON curriculum_courses(degree_code);

-- Full-text search (for RAG)
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
  cat_no,
  title,
  content='courses',
  content_rowid='rowid'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS courses_ai AFTER INSERT ON courses BEGIN
  INSERT INTO courses_fts(rowid, cat_no, title) VALUES (new.rowid, new.cat_no, new.title);
END;
