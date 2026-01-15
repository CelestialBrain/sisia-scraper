-- SISIA Database Schema v2 - Normalized with Integer Keys
-- SQLite version matching PostgreSQL schema
-- Using singular table names (best practice)

-- ============================================
-- LOOKUP TABLES (Small, frequently joined)
-- ============================================

-- Department
CREATE TABLE IF NOT EXISTS department (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Academic Term (2025-1, 2025-2, etc.)
CREATE TABLE IF NOT EXISTS term (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  year INTEGER NOT NULL,
  semester INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Instructor (deduplicated teacher names)
CREATE TABLE IF NOT EXISTS instructor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES department(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Room (deduplicated room codes)
CREATE TABLE IF NOT EXISTS room (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  building TEXT,
  room_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MASTER DATA TABLES
-- ============================================

-- Course (unique course catalog)
CREATE TABLE IF NOT EXISTS course (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  units REAL DEFAULT 0,
  department_id INTEGER REFERENCES department(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Degree Program
CREATE TABLE IF NOT EXISTS degree_program (
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

-- Curriculum Course: Which courses are in which degree programs
CREATE TABLE IF NOT EXISTS curriculum_course (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  degree_id INTEGER NOT NULL REFERENCES degree_program(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  year INTEGER,
  semester INTEGER,
  prerequisites_raw TEXT,
  corequisites_raw TEXT,
  category TEXT,
  is_elective INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(degree_id, course_id)
);

-- Class Section: A specific offering of a course
CREATE TABLE IF NOT EXISTS class_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES course(id),
  term_id INTEGER NOT NULL REFERENCES term(id),
  instructor_id INTEGER REFERENCES instructor(id),
  department_id INTEGER REFERENCES department(id),
  section TEXT NOT NULL,
  max_capacity INTEGER DEFAULT 0,
  free_slots INTEGER DEFAULT 0,
  lang TEXT,
  level TEXT,
  remarks TEXT,
  has_prerequisites INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, term_id, section)
);

-- Schedule Slot: Day/time/room for a section
CREATE TABLE IF NOT EXISTS schedule_slot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES class_section(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES room(id),
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  modality TEXT DEFAULT 'ONSITE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_instructor_name ON instructor(name);
CREATE INDEX IF NOT EXISTS idx_room_code ON room(code);
CREATE INDEX IF NOT EXISTS idx_course_code ON course(course_code);
CREATE INDEX IF NOT EXISTS idx_term_code ON term(code);

CREATE INDEX IF NOT EXISTS idx_section_course ON class_section(course_id);
CREATE INDEX IF NOT EXISTS idx_section_term ON class_section(term_id);
CREATE INDEX IF NOT EXISTS idx_section_instructor ON class_section(instructor_id);
CREATE INDEX IF NOT EXISTS idx_section_dept ON class_section(department_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_degree ON curriculum_course(degree_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_course ON curriculum_course(course_id);
CREATE INDEX IF NOT EXISTS idx_slot_section ON schedule_slot(section_id);
CREATE INDEX IF NOT EXISTS idx_slot_room ON schedule_slot(room_id);
CREATE INDEX IF NOT EXISTS idx_slot_day ON schedule_slot(day);

-- Full-text search on course
CREATE VIRTUAL TABLE IF NOT EXISTS course_fts USING fts5(
  course_code,
  title,
  content='course',
  content_rowid='rowid'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS course_ai AFTER INSERT ON course BEGIN
  INSERT INTO course_fts(rowid, course_code, title) VALUES (new.rowid, new.course_code, new.title);
END;

-- ============================================
-- SCRAPE METADATA
-- ============================================

-- Scrape Run: Track each scrape session
CREATE TABLE IF NOT EXISTS scrape_run (
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

CREATE INDEX IF NOT EXISTS idx_scrape_run_term ON scrape_run(term_code);
CREATE INDEX IF NOT EXISTS idx_scrape_run_started ON scrape_run(started_at);

-- ============================================
-- CHATBOT-FRIENDLY VIEWS
-- ============================================

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
FROM class_section cs
JOIN course c ON cs.course_id = c.id
JOIN term t ON cs.term_id = t.id
LEFT JOIN instructor i ON cs.instructor_id = i.id
LEFT JOIN department d ON cs.department_id = d.id
LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
LEFT JOIN room r ON ss.room_id = r.id;

-- Instructor schedule summary (for "how many classes does X have")
CREATE VIEW IF NOT EXISTS v_instructor_schedule AS
SELECT 
  i.name as instructor,
  t.code as term,
  ss.day,
  COUNT(DISTINCT cs.id) as class_count,
  GROUP_CONCAT(DISTINCT c.course_code) as courses
FROM class_section cs
JOIN course c ON cs.course_id = c.id
JOIN term t ON cs.term_id = t.id
JOIN instructor i ON cs.instructor_id = i.id
JOIN schedule_slot ss ON ss.section_id = cs.id
GROUP BY i.name, t.code, ss.day;

-- Course room distribution (for "where are X classes held")
CREATE VIEW IF NOT EXISTS v_course_room AS
SELECT 
  c.course_code,
  c.title as course_title,
  r.code as room,
  r.building,
  t.code as term,
  COUNT(*) as slot_count
FROM schedule_slot ss
JOIN class_section cs ON ss.section_id = cs.id
JOIN course c ON cs.course_id = c.id
JOIN term t ON cs.term_id = t.id
JOIN room r ON ss.room_id = r.id
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
FROM term t
LEFT JOIN class_section cs ON cs.term_id = t.id
LEFT JOIN course c ON cs.course_id = c.id
LEFT JOIN instructor i ON cs.instructor_id = i.id
LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
LEFT JOIN room r ON ss.room_id = r.id
GROUP BY t.id;
