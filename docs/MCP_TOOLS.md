# MCP Tools Reference

AI-constrained tools for the SISIA chatbot. The AI can ONLY use these functions - no arbitrary database access.

## AI Configuration

| Setting       | Value            | Purpose                    |
| ------------- | ---------------- | -------------------------- |
| Model         | gemini-2.0-flash | Fast, accurate             |
| Temperature   | 0.1              | Low = fewer hallucinations |
| topP          | 0.7              | Focused responses          |
| Session Cache | 30 min           | Reuse AISIS logins         |

---

## Public Tools (26 Total)

Used for general AISIS data queries (database lookups).

### search_courses

Search for courses by code or title.

```typescript
{ query: "CSCI 111", term?: "2025-2", limit?: 20 }
→ { courses: [...], total: 5 }
```

### get_course_sections

Get all sections for a specific course with **slots, schedule, instructor**.

```typescript
{ course_code: "CSCI 111", term?: "2025-2" }
→ { sections: [{ section: "A", free_slots: 10, instructor: "...", schedule: [...] }] }
```

### compare_sections

Compare multiple sections of the same course, sorted by slots.

```typescript
{ course_code: "ENGL 11", term?: "2025-2", sort_by?: "slots" }
→ { comparison: [...] }
```

### search_instructors

Search instructors by name. **Supports fuzzy, case-insensitive matching with deduplication.**

```typescript
{ name: "Nable", limit?: 20 }
→ { instructors: [{ name: "NABLE, JOB A.", match_score: 1.0 }], total: 1 }
```

**Deduplication:** Co-teaching teams stored as combined entries (e.g., "GO, CLARK KENDRICK C., NABLE, JOB A.") are now parsed into individual names and deduplicated, so searching for "Nable" returns only the unique instructor, not duplicates from different co-teaching combinations.

### get_instructor_schedule

Get all classes taught by an instructor. **Supports fuzzy, case-insensitive matching.**

```typescript
{ instructor_name: "Job Nable", term?: "2025-2" }
→ { schedule: [{ course_code: "MATH 31.2", section: "K2", day: "T", start_time: "09:30", ... }] }
```

Note: Names like "Job Nable" will match "NABLE, JOB A." in the database.

### get_room_schedule

Get classes in a specific room.

```typescript
{ room_name: "SEC A 301", term?: "2025-2" }
→ { slots: [...] }
```

### get_curriculum

Get degree program curriculum with **prerequisites**.

```typescript
{ program: "BS CS", year?: 2024, semester?: 1 }
→ { courses: [{ course_code, prerequisites, year, semester }] }
```

### build_schedule ⭐ ENHANCED

Build conflict-free schedule from course list. **Highly optimized with Forward Checking!**

```typescript
{
  courses: ["CSCI 111", "MATH 30.13"],
  start_after?: "13:00",       // Afternoon only
  start_before?: "12:00",      // Morning only
  end_before?: "17:00",        // Finish by 5pm
  building_filter?: "SEC",     // Only SEC building rooms
  no_friday?: true,            // No Friday classes
  exclude_days?: ["Saturday"],
  include_days?: ["Tuesday", "Friday"],  // Prefer T/F pattern
  prefer_breaks?: true,        // Spaced out schedule
  prefer_compact?: true,       // Back-to-back classes
  term?: "2025-2"
}
→ { schedule: [...], weekly_grid: {...}, total_hours: 6 }
```

**Parameters:**

| Parameter         | Description                                         |
| ----------------- | --------------------------------------------------- |
| `start_after`     | Only classes starting at/after time (e.g., "13:00") |
| `start_before`    | Only classes starting before time (e.g., "12:00")   |
| `end_before`      | Only classes ending by this time (e.g., "15:00")    |
| `building_filter` | Only rooms in building (e.g., "SEC", "CTC", "G")    |
| `prefer_breaks`   | Prefer spaced out schedule with breaks              |
| `prefer_compact`  | Prefer back-to-back classes, no waiting             |
| `include_days`    | Prefer sections on specific days                    |

**Performance:** 10-course schedule completes in ~12ms (with Forward Checking optimization).

### search_by_natural_time

Find classes by time preference ("morning only", "MWF").

```typescript
{ query: "morning only", term?: "2025-2" }
→ { sections: [...] }
```

### get_prerequisites ⭐ NEW

Get prerequisite courses for a specific course.

```typescript
{ course_code: "MATH 31.3" }
→ { prerequisites: "MATH 31.2", programs: ["BS ME", "AB EC-H", ...] }
```

### get_data_status ⭐ NEW

Get when schedule/curriculum data was last updated.

```typescript
{ data_type?: "schedule" | "curriculum" | "all" }
→ { schedule: { last_updated: "2026-01-15 10:05:42", total_sections: 12595 }, ... }
```

### list_departments ⭐ NEW

List all academic departments.

```typescript
{ include_courses?: true, search?: "Computer" }
→ { departments: [{ code: "ISCS", name: "Information Systems and Computer Science" }] }
```

### list_programs

List degree programs in the database.

```typescript
{ search?: "Computer", degree_type?: "undergraduate" | "graduate", latest_only?: true }
→ { programs: [{ code: "BS CS", name: "..." }] }
```

### check_conflicts ⭐ NEW

Check if two sections from different courses have a schedule conflict.

```typescript
{ section1: "MATH 10 A1", section2: "ENGL 11 B", term?: "2025-2" }
→ { has_conflict: false, section1: {...}, section2: {...} }
```

### find_free_rooms ⭐ NEW

Find rooms that are NOT in use at a specific day and time.

```typescript
{ day: "Monday", time: "10:00", building?: "SEC", term?: "2025-2" }
→ { free_rooms_count: 45, by_building: { "SEC": [...] }, rooms: [...] }
```

### get_course_info ⭐ NEW

Get detailed course information including units, department, and offering status.

```typescript
{ course_code: "MATH 10", term?: "2025-2" }
→ { course_code: "MATH 10", title: "...", units: 3, department: "MATH", offered_this_term: true }
```

### find_open_sections ⭐ NEW

Find sections with available enrollment slots across all courses. Now supports **unit filtering**.

```typescript
{ department?: "CSCI", units?: 3, min_units?: 3, max_units?: 5, min_slots?: 5, morning_only?: true, term?: "2025-2" }
→ { total_found: 30, sections: [{ course: "CSCI 111", units: 3, free_slots: 10, enrolled: 25, ... }] }
```

### get_popular_courses ⭐ NEW

Get courses ranked by enrollment. Shows most enrolled first.

```typescript
{ department?: "CSCI", limit?: 20, term?: "2025-2" }
→ { courses: [{ rank: 1, course_code: "INTACT 12", enrolled: 2737, fill_rate: "84.6%" }] }
```

### get_instructor_stats ⭐ NEW

Get instructors ranked by number of sections taught.

```typescript
{ department?: "MATH", limit?: 20, term?: "2025-2" }
→ { instructors: [{ name: "DE JESUS", sections: 81, unique_courses: 5 }] }
```

### search_by_modality ⭐ NEW

Find classes by delivery mode (online/onsite). 77 online sections available.

```typescript
{ modality: "online" | "onsite", department?: "PHILO" }
→ { sections: [...], available_modalities: { ONLINE: 77, ONSITE: 14399 } }
```

### search_by_level ⭐ NEW

Find courses by academic level (undergraduate/graduate).

```typescript
{ level: "graduate", department?: "MATH" }
→ { level_counts: { undergraduate: 9613, graduate: 2982 }, sections: [...] }
```

### find_courses_without_prereqs ⭐ NEW

Find courses with no prerequisites. ~1400 sections available.

```typescript
{ department?: "CSCI", min_slots?: 5 }
→ { total_no_prereq_sections: 1415, sections: [...] }
```

### get_restricted_sections ⭐ NEW

Find sections with restrictions (majors only, cross-reg, dissolved).

```typescript
{ restriction_type?: "majors" | "cross_reg" | "dissolved", department?: "CSCI" }
→ { categories: { majors_only: 15 }, sections: [{ restriction: "FOR AB IS MAJORS" }] }
```

### get_time_slot_stats ⭐ NEW

Get class distribution by time slot. Shows busiest/quietest times.

```typescript
{ day?: "Monday", term?: "2025-2" }
→ { busiest_slots: [{ time: "09:30", day: "Friday", classes: 160 }], by_hour: {...} }
```

### search_pe_courses ⭐ NEW

Unified search across all Physical Education variants (PE, PHYED, PATHFit, PEPC).

```typescript
{ activity_type?: "swimming", show_current_only?: true }
→ { pe_curriculum_evolution: { 2018: "PE", 2020: "PHYED", 2024: "PATHFit" }, courses: [...] }
```

**PE Curriculum Evolution:**

- 2018: `PE 1-4`
- 2020: `PHYED 1-4`
- 2024: `PATHFit 1-4` (requirement)
- Current: `PEPC` (elective activities)

---

## Personal Tools (5 Total, Auth Required)

Requires linked AISIS account. Scrapes user-specific data.

### get_my_enrolled_classes

Get enrolled classes **with instructor names** (J_VCEC.do).

```typescript
{} → { classes: [{ course: "LLAW 113", section: "UV1A", instructor: "AGUILA, Eirene Jhone" }] }
```

Use this for "who are my teachers" queries.

### get_my_schedule

Get personal class schedule with times/rooms (J_VMCS.do).

```typescript
{} → { schedule: [...], weekly_grid: {...} }
```

Does NOT include instructor names.

### get_my_ips ⭐ ENHANCED

Get Individual Plan of Study progress (J_VIPS.do).

```typescript
{} → {
  program: "BS ME (Version 1, 2025)",
  year_level: 3,
  total_units: 189,
  units_taken: 23,
  remaining_units: 166,
  progress_percentage: 12,
  courses_by_year: {
    1: {
      1: [{ course: "ENLIT 12", status: "passed" }],  // Semester 1
      2: [{ course: "ENGL 11", status: "passed" }]    // Semester 2
    },
    2: {
      0: [{ course: "ArtAp 10", status: "not_taken" }],  // Intersession
      1: [{ course: "FLC 11", status: "not_taken" }],    // Semester 1
      2: [{ course: "ECON 110", status: "not_taken" }]   // Semester 2
    },
    // Years 3, 4 follow same pattern with Intersession(0), Sem1(1), Sem2(2)
  }
}
```

**Note:** Intersessions appear in Years 2, 3, and 4 only. Semester 0 = Intersession.

### get_my_grades

Get final grades and QPI (J_VG.do).

```typescript
{ term?: "2025-2" } → { grades: [...], qpi_summary: {...} }
```

### get_my_hold_orders

Check for hold orders (J_VHOR.do).

```typescript
{} → { has_hold: false, orders: [] }
```

---

## Architecture

```
┌──────────────────────┐
│   Gemini AI Model    │
│   (temp=0.1)         │
└──────────┬───────────┘
           │ Function Call
           ▼
┌──────────────────────┐
│   MCP Tools Index    │
│   (index.ts)         │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────────────┐
│ SQLite  │ │ AISIS Scrapers  │
│ (public)│ │ (personal)      │
└─────────┘ └─────────────────┘
```

---

## Database Tables (Queryable)

| Table               | Key Columns                                   |
| ------------------- | --------------------------------------------- |
| `course`            | course_code, title, units                     |
| `class_section`     | section, free_slots, max_capacity, remarks    |
| `schedule_slot`     | day, start_time, end_time, modality           |
| `instructor`        | name, department_id                           |
| `room`              | code, building, room_number                   |
| `degree_program`    | code, name, version_year                      |
| `curriculum_course` | year, semester, prerequisites_raw, category   |
| `department`        | code, name                                    |
| `scrape_run`        | started_at, completed_at, scrape_type, status |

---

## Files

| File                                  | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `chat/server/src/mcp/tools/index.ts`  | Tool registry & handler         |
| `chat/server/src/mcp/tools/*.ts`      | Individual tool implementations |
| `chat/server/src/mcp/tools/db.ts`     | Shared database connection      |
| `chat/server/src/scrapers/*.ts`       | AISIS scrapers                  |
| `chat/server/src/utils/normalizer.ts` | Course code normalization       |

---

## API Endpoints

| Endpoint                       | Method | Description                    |
| ------------------------------ | ------ | ------------------------------ |
| `/api/chat`                    | POST   | Public chat (25 tools)         |
| `/api/chat/personal`           | POST   | Authenticated chat (30 tools)  |
| `/api/chat/stream`             | POST   | Streaming SSE chat             |
| `/api/chat/history/:sessionId` | GET    | Get conversation history       |
| `/api/usage`                   | GET    | API usage stats & quota limits |
| `/api/health`                  | GET    | API status & tool list         |

### `/api/usage` Response Example

```json
{
  "current": {
    "requestsPerMinute": 5,
    "requestsPerDay": 120,
    "tokensPerDay": 45000
  },
  "limits": {
    "requestsPerMinute": 60,
    "requestsPerDay": 1500,
    "tokensPerDay": 1500000
  },
  "percentUsed": { "requestsPerDay": 8, "tokensPerDay": 3 },
  "resetIn": { "minute": 45, "hour": 2830, "day": 72000 }
}
```

---

## Changelog

### 2026-01-21 (Latest)

**IPS Scraper Fix:**

- **Fixed** IPS courses being assigned to wrong semesters (Intersession courses appeared under Semester 1)
- **Fixed** phantom 5th year appearing for 4-year programs (BS ME)
- **Added** proper Intersession detection for Years 2, 3, and 4
- **Added** detailed IPS output with `courses_by_year` structure showing year → semester → courses

**Technical Details:**

- IPS parsing now correctly traverses DOM to find parent `<td>` containing semester label
- Year detection uses previous sibling `<tr>` elements with `td.text06` class
- Semester values: 0 = Intersession, 1 = First Semester, 2 = Second Semester

---

### 2026-01-17

**Performance:**

- **Fixed** slow loading (80s → 1.5s) by removing blocking AISIS schedule prefetch
- **Added** concurrent AISIS data caching - fetches schedule, grades, IPS in parallel on first access
- **Added** `unique_instructors_count` field to section responses for accurate counting

**Program Aliases:**

- **Added** 20+ program aliases for better curriculum lookup:
  - "Management Honors" → BS MGT-H
  - "Economics Honors" → AB EC-H
  - "Chinese Studies Business" → AB ChnS-B
  - "Chinese Studies Humanities" → AB ChnS-H
  - And more tracks (ChnS-AC, ChnS-S)

**Fixes:**

- **Fixed** `search_instructors` returning duplicate instructor names (co-teaching entries now parsed)
- **Fixed** partial course code matching ("MATH 31" suggests MATH 31.1, 31.2, 31.3, 31.4)
- **Fixed** instructor count accuracy (MATH 10 now correctly shows 20 instructors)
- **Improved** response formatting with `_format_hint` fields for lists and grouped data

---

### 2026-01-16 (Phase 2)

\*\*New Tools (7 added this session, now 25 public + 5 personal = 30 total):

- `get_popular_courses` - Courses ranked by enrollment, supports reverse sort for least popular
- `get_instructor_stats` - Instructors ranked by sections taught
- `search_by_modality` - Filter by online/onsite (77 online, 14.4K onsite)
- `search_by_level` - Filter by undergrad/graduate (9.6K/3K)
- `find_courses_without_prereqs` - Courses with no prerequisites (~1400)
- `get_restricted_sections` - Sections with restrictions (majors only, cross-reg)
- `get_time_slot_stats` - Class distribution by time (busiest: 9:30 with 160 classes)

**Database Enhancements:**

- Room table now has: `capacity`, `has_ac`, `has_projector`, `room_type` columns
- Ready for room amenities search when data is populated

**Fixes:**

- `get_popular_courses` now supports `sort_by` for least popular/fill rate sorting
- Enrolled count now included in all section responses

### 2026-01-17 (Performance Optimizations)

**New Schedule Preferences:**

| Parameter        | Description                 | Example             |
| ---------------- | --------------------------- | ------------------- |
| `prefer_breaks`  | Spaced schedule with breaks | "I want big breaks" |
| `prefer_compact` | Back-to-back classes        | "Compact schedule"  |
| `end_before`     | Finish by specific time     | "Done by 3pm"       |
| `include_days`   | Prefer specific days        | "T/F schedule"      |

**Algorithm Optimizations:**

| Optimization                    | Impact                           |
| ------------------------------- | -------------------------------- |
| Filter full sections in SQL     | `WHERE cs.free_slots > 0`        |
| Most Constrained Variable First | Sort courses by section count    |
| Forward Checking                | Prune dead ends before exploring |
| 5-second timeout                | Graceful failure instead of hang |

**Performance Gains:**

| Scenario           | Before       | After    |
| ------------------ | ------------ | -------- |
| 10 courses         | Hung forever | **12ms** |
| 8 courses          | 5 seconds    | **6ms**  |
| 6 courses + breaks | 3.6 seconds  | **2ms**  |

### 2026-01-17 (Schedule Improvements)

**New Features:**

- **Course Equivalency Mapping** - Curriculum codes auto-substituted with actual offered courses:
  - `NatSc 10.01` → `ENVI 10.01` (Environmental Science)
  - `NatSc 10.02` → `ENVI 10.02` (Environmental Science Lab)
  - `PATHFit 1-4` → `PEPC 11.xx` (Physical Education)
  - `PE 1-4 / PHYED 1-4` → `PEPC 11.xx`

- **Schedule Formatting Options** - AI now formats schedules contextually:
  - Bullet list for 1-3 courses
  - Markdown table for 4+ courses
  - Weekly grid view when requested ("show as grid", "calendar view")

- **Program Alias Expansion** - Added aliases:
  - `bs management engineering` → `BS ME`
  - `management honors` → `BS MGT-H`
  - `economics honors` → `AB EC-H`
  - Chinese Studies tracks (B, H, AC, S)

- **Schedule Update Capability** - AI can now update schedules mid-conversation:
  - "Drop FILI 12, add THEO 11" works correctly
  - Maintains user constraints across turns

**Fixes:**

- **Fixed** BS ME curriculum now correctly includes ENVI and PEPC courses
- **Fixed** Total units calculation matches actual enrolled courses
- **Fixed** "No curriculum found" errors for common program aliases

### 2026-01-16 (Earlier - Phase 1)

**New Tools (4 added):**

- `check_conflicts` - Detect schedule conflicts between two sections from different courses
- `find_free_rooms` - Search for unoccupied rooms at specific day/time
- `get_course_info` - Get course details (units, department, prerequisites, offering status)
- `find_open_sections` - Find sections with available enrollment slots

**Enhancements:**

- `build_schedule` now supports `no_friday` and `exclude_days` parameters
- Course code aliasing: "CS 11" → "CSCI 11", "Math" → "MATH", "Fil" → "FILI"
- System prompt hardened with stricter anti-hallucination rules

**Fixes:**

- **Fixed** `get_course_sections` now returns correct section count
- **Fixed** Schedule filters apply correctly (morning_only + day exclusions)

### 2026-01-16 (Earlier)

**Features:**

- **Added** `/api/usage` endpoint for API quota tracking (requests/tokens per minute/day)
- **Added** Message logging to track user interactions with Supabase (`chat_message` table)
- **Added** Time slot consolidation in personal schedule (30-min slots → full class periods)
- **Added** Word-based fuzzy matching for curriculum/program lookups
- **Added** Privacy rules: AI no longer discloses tool names or implementation details

**Fixes:**

- **Fixed** `search_instructors` returning 0 results (double-wrapping bug in handler)
- **Fixed** `get_instructor_schedule` case-sensitivity (now fuzzy, case-insensitive)
- **Fixed** Schedule end times (e.g., ENGL 11 now shows 2:00-3:30 PM, not 2:00-3:00 PM)
- **Fixed** AISIS session caching (30-min TTL to avoid repeated logins)

**New Tools (earlier in day):**

- `get_prerequisites` - Query course prerequisites and corequisites
- `get_data_status` - Check data freshness (last scrape times, counts)
- `list_departments` - List all academic departments with course counts
- `list_programs` - Browse degree programs with curriculum counts

**Prompt Updates:**

- AI identifies unique instructors (not co-teaching combinations)
- AI never asks about AISIS linking confirmation
- AI responds naturally to "what are your tools" without revealing internals
