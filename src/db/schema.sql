-- SISIA Database Schema v2 - Normalized with Integer Keys
-- SQLite version matching PostgreSQL schema

-- ============================================
-- LOOKUP TABLES (Small, frequently joined)
-- ============================================

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Academic Terms (2025-1, 2025-2, etc.)
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Instructors (deduplicated teacher names)
CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rooms (deduplicated room codes)
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  building TEXT,
  room_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MASTER DATA TABLES
-- ============================================

-- Courses (unique course catalog)
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  units REAL DEFAULT 0,
  department_id INTEGER REFERENCES departments(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Degree Programs
CREATE TABLE IF NOT EXISTS degree_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_honors INTEGER DEFAULT 0,
  track TEXT,
  specialization TEXT,
  version_year INTEGER,
  version_semester INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- RELATIONSHIP TABLES
-- ============================================

-- Curriculum: Which courses are in which degree programs
CREATE TABLE IF NOT EXISTS curriculum_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  degree_id INTEGER NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  year INTEGER,
  semester INTEGER,
  prerequisites_raw TEXT,
  category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(degree_id, course_id)
);

-- Class Sections (schedule offerings)
CREATE TABLE IF NOT EXISTS class_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  instructor_id INTEGER REFERENCES instructors(id),
  department_id INTEGER REFERENCES departments(id),
  section TEXT NOT NULL,
  max_capacity INTEGER DEFAULT 0,
  free_slots INTEGER DEFAULT 0,
  lang TEXT,
  level TEXT,
  remarks TEXT,
  has_prerequisites INTEGER DEFAULT 0,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, term_id, section)
);

-- Schedule Slots (time/room for each section)
CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  modality TEXT DEFAULT 'ONSITE'
);

-- ============================================
-- INDEXES for fast lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_instructors_name ON instructors(name);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(course_code);
CREATE INDEX IF NOT EXISTS idx_terms_code ON terms(code);

CREATE INDEX IF NOT EXISTS idx_sections_course ON class_sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_term ON class_sections(term_id);
CREATE INDEX IF NOT EXISTS idx_sections_instructor ON class_sections(instructor_id);
CREATE INDEX IF NOT EXISTS idx_sections_dept ON class_sections(department_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_degree ON curriculum_courses(degree_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_course ON curriculum_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_slots_section ON schedule_slots(section_id);
CREATE INDEX IF NOT EXISTS idx_slots_room ON schedule_slots(room_id);

-- Full-text search on courses
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
  course_code,
  title,
  content='courses',
  content_rowid='rowid'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS courses_ai AFTER INSERT ON courses BEGIN
  INSERT INTO courses_fts(rowid, course_code, title) VALUES (new.rowid, new.course_code, new.title);
END;

-- ============================================
-- SCRAPE METADATA
-- ============================================

-- Scrape runs - track each scrape session
CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  term_code TEXT,
  scrape_type TEXT NOT NULL, -- 'schedule', 'curriculum', 'all'
  
  -- Change counters
  inserted INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  unchanged INTEGER DEFAULT 0,
  removed INTEGER DEFAULT 0,
  
  -- Totals
  total_scraped INTEGER DEFAULT 0,
  total_in_db INTEGER DEFAULT 0,
  duration_ms INTEGER,
  
  -- Status
  status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed'
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_term ON scrape_runs(term_code);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started ON scrape_runs(started_at);

-- ============================================
-- CHATBOT-FRIENDLY VIEWS
-- ============================================

-- Index for day-based queries ("Friday classes")
CREATE INDEX IF NOT EXISTS idx_slots_day ON schedule_slots(day);

-- Full schedule view with all details (for chatbot)
CREATE VIEW IF NOT EXISTS v_full_schedule AS
SELECT 
  cs.id as section_id,
  c.course_code,
  c.title as course_title,
  c.units,
  cs.section,
  i.name as instructor,
  d.code as department,
  t.code as term,
  t.year as school_year,
  t.semester,
  ss.day,
  ss.start_time,
  ss.end_time,
  r.code as room,
  r.building,
  ss.modality,
  cs.max_capacity,
  cs.free_slots,
  cs.has_prerequisites
FROM class_sections cs
JOIN courses c ON cs.course_id = c.id
JOIN terms t ON cs.term_id = t.id
LEFT JOIN instructors i ON cs.instructor_id = i.id
LEFT JOIN departments d ON cs.department_id = d.id
LEFT JOIN schedule_slots ss ON ss.section_id = cs.id
LEFT JOIN rooms r ON ss.room_id = r.id;

-- Instructor schedule summary (for "how many classes does X have")
CREATE VIEW IF NOT EXISTS v_instructor_schedule AS
SELECT 
  i.name as instructor,
  t.code as term,
  ss.day,
  COUNT(DISTINCT cs.id) as class_count,
  GROUP_CONCAT(DISTINCT c.course_code) as courses
FROM class_sections cs
JOIN courses c ON cs.course_id = c.id
JOIN terms t ON cs.term_id = t.id
JOIN instructors i ON cs.instructor_id = i.id
JOIN schedule_slots ss ON ss.section_id = cs.id
GROUP BY i.name, t.code, ss.day;

-- Course room distribution (for "where are X classes held")
CREATE VIEW IF NOT EXISTS v_course_rooms AS
SELECT 
  c.course_code,
  c.title as course_title,
  r.code as room,
  r.building,
  t.code as term,
  COUNT(*) as slot_count
FROM schedule_slots ss
JOIN class_sections cs ON ss.section_id = cs.id
JOIN courses c ON cs.course_id = c.id
JOIN terms t ON cs.term_id = t.id
JOIN rooms r ON ss.room_id = r.id
GROUP BY c.course_code, r.code, t.code;

-- Term summary (for "how many classes in 24-25")
CREATE VIEW IF NOT EXISTS v_term_summary AS
SELECT 
  t.code as term,
  t.year,
  t.semester,
  COUNT(DISTINCT cs.id) as section_count,
  COUNT(DISTINCT c.id) as course_count,
  COUNT(DISTINCT i.id) as instructor_count,
  COUNT(DISTINCT r.id) as room_count
FROM terms t
LEFT JOIN class_sections cs ON cs.term_id = t.id
LEFT JOIN courses c ON cs.course_id = c.id
LEFT JOIN instructors i ON cs.instructor_id = i.id
LEFT JOIN schedule_slots ss ON ss.section_id = cs.id
LEFT JOIN rooms r ON ss.room_id = r.id
GROUP BY t.id;

