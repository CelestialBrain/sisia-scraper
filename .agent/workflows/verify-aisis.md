---
description: Verify AISIS database accuracy by comparing scraped data against live AISIS
---

# AISIS Database Verification Skill

This skill helps verify that the scraped AISIS data in `sisia.db` matches the live AISIS system.

## When to Use

- After running `npm run fast` (HTTP scraper)
- When users report discrepancies in room assignments or instructor names
- For periodic data integrity checks

## Prerequisites

1. AISIS must be accessible (logged in via browser or have valid session)
2. Database `sisia.db` must exist
3. Browser access to AISIS class schedule page

## Verification Steps

### Step 1: Pick a Sample to Verify

Choose one of these verification targets:

- **Room Schedule**: Pick a room (e.g., CTC 106) and a day
- **Instructor Schedule**: Pick an instructor name
- **Course Sections**: Pick a course code (e.g., THEO 11)

### Step 2: Query the Local Database

Run SQLite queries to get the scraped data:

```bash
# Room schedule verification
sqlite3 -header -column sisia.db "
SELECT c.course_code, cs.section, i.name as instructor,
       ss.day, ss.start_time, ss.end_time, r.code as room
FROM class_section cs
JOIN course c ON cs.course_id = c.id
JOIN instructor i ON cs.instructor_id = i.id
JOIN schedule_slot ss ON ss.section_id = cs.id
JOIN room r ON ss.room_id = r.id
WHERE r.code LIKE '%CTC 106%' AND ss.day = 'Monday'
ORDER BY ss.start_time;"

# Course verification
sqlite3 -header -column sisia.db "
SELECT c.course_code, cs.section, i.name as instructor,
       r.code as room, ss.day, ss.start_time
FROM class_section cs
JOIN course c ON cs.course_id = c.id
JOIN instructor i ON cs.instructor_id = i.id
JOIN schedule_slot ss ON ss.section_id = cs.id
JOIN room r ON ss.room_id = r.id
WHERE c.course_code = 'THEO 11'
ORDER BY cs.section, ss.day;"
```

### Step 3: Verify Against AISIS

1. Open AISIS class schedule page: https://aisis.ateneo.edu/j_aisis/classSkeds.do
2. Select the appropriate department
3. Click "Display Class Schedule"
4. Search/filter for the specific course or room
5. Compare instructor names, room assignments, and time slots

### Step 4: Document Discrepancies

Create a table comparing DB vs AISIS:

| Field      | Database         | AISIS            | Match? |
| ---------- | ---------------- | ---------------- | ------ |
| Course     | THEO 11 D2       | THEO 11 D2       | ✅     |
| Room       | F-114            | CTC 106          | ❌     |
| Instructor | CORTEZ, Kenjie   | CORTEZ, Kenjie   | ✅     |
| Time       | M/TH 12:30-14:00 | M/TH 12:30-14:00 | ✅     |

## Known Scraper Issues

### 1. Global `formInitialized` Variable (Session Bleed Risk)

**Location**: `src/httpScraper.ts:58`

```typescript
let formInitialized = false;
```

**Risk**: This global variable persists across department scrapes and could cause form state issues if the server expects fresh initialization per department.

**Impact**: May cause incorrect data to be returned for subsequent departments if AISIS tracks state server-side.

### 2. Concurrent Request Ordering

**Location**: `src/httpScraper.ts:269-362`

- Scraper uses 8 concurrent requests by default
- AISIS might not handle concurrent form submissions correctly
- Responses could get mixed between departments

### 3. Column Index Assumptions

**Location**: `src/httpScraper.ts:111-122`

```typescript
const subjectCode = cellTexts[0] || "";
const room = cellTexts[5] || "";
// etc.
```

**Risk**: If AISIS table columns vary by department, fixed indices could read wrong data.

## Recommended Fixes

### Fix 1: Move `formInitialized` Inside Function

```typescript
// Move to scrapeAllSchedulesHTTP and pass as parameter
export async function scrapeAllSchedulesHTTP(..., options) {
  let formInitialized = false; // Now scoped to this run
  // ...
}
```

### Fix 2: Add Post-Scrape Verification

After scraping, verify 3-5 random sections against AISIS:

```typescript
async function verifyScrapeIntegrity(
  sections: ClassSection[],
  session: HTTPSession,
) {
  const samples = sections.slice(0, 5);
  for (const sample of samples) {
    const live = await fetchSingleSection(sample.subjectCode, sample.section);
    if (live.room !== sample.schedule[0].room) {
      console.warn(
        `⚠️ Room mismatch: ${sample.id} DB=${sample.schedule[0].room} LIVE=${live.room}`,
      );
    }
  }
}
```

### Fix 3: Reduce Concurrency for Critical Scrapes

```bash
# Run with lower concurrency for more reliable results
AISIS_CONCURRENCY=2 npm run fast
```

## Quick Verification Commands

```bash
# Count total sections per department to detect missing data
sqlite3 sisia.db "SELECT department, COUNT(*) as cnt FROM class_section GROUP BY department ORDER BY cnt DESC;"

# Find sections with mismatched room data (room in multiple places)
sqlite3 sisia.db "SELECT cs.id, COUNT(DISTINCT r.code) as room_count FROM class_section cs JOIN schedule_slot ss ON ss.section_id = cs.id JOIN room r ON ss.room_id = r.id GROUP BY cs.id HAVING room_count > 1;"

# Check last scrape timestamp
sqlite3 sisia.db "SELECT * FROM scrape_run ORDER BY id DESC LIMIT 5;"
```
