# SISIA Scraper - Comprehensive Documentation

## Overview

The SISIA (Student Information System Integration and Scraping Application) scraper is a high-performance HTTP-based data extraction tool for Ateneo's AISIS system. It uses pure HTTP requests with cookie-based session management to achieve **~30x faster** scraping compared to browser automation.

**Performance Stats (Verified January 2026):**
| Metric | Value |
|--------|-------|
| **Terms scraped** | 4 (2024-2, 2025-0/1/2) |
| **Class Sections** | 12,389 |
| **Schedule Slots** | 13,956 |
| **Unique Courses** | 2,450 |
| **Instructors** | 1,732 |
| **Rooms** | 314 |
| **Hidden terms discovered** | 15 (2019-2023) |
| Total scrape time | ~2.3 min (4 terms) |
| Per-term time | ~35s |
| Concurrency | 8 parallel (schedule) / 4 parallel (curriculum) |
| Database | SQLite (singular table names, normalized) |

---

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐
│   httpAuth.ts   │───▶│  httpScraper.ts  │───▶│  database.ts  │
│   (HTTP Login)  │    │  (Schedule/Curr) │    │   (SQLite)    │
└─────────────────┘    └──────────────────┘    └───────────────┘
        │                      │                       │
        ▼                      ▼                       ▼
   Cookie Chain          Cheerio Parse          Supabase Sync
```

---

## Authentication & Security Tokens

### 1. JSESSIONID Cookie

- **Purpose:** Server-side session identifier
- **Format:** `0a0f104e30d5057738e191a6429b4bd...` (32+ hex chars)
- **Lifetime:** Until browser closes or session expires (~30 min idle)
- **Security:** HttpOnly, not accessible via JavaScript

### 2. rnd Token (CSRF Protection)

- **Purpose:** Prevents Cross-Site Request Forgery attacks
- **Format:** 8 alphanumeric characters (e.g., `jhxaqfhc`)
- **Location:** Hidden `<input name="rnd">` on login page
- **Flow:**
  ```
  1. GET /displayLogin.do → HTML contains <input name="rnd" value="jhxaqfhc">
  2. POST /login.do → Send {userName, password, rnd: "jhxaqfhc", command: "login"}
  3. Server validates rnd matches session → Issues new JSESSIONID
  ```
- **Why it exists:** AISIS was built in early 2000s Java Struts era; this is a common CSRF pattern from that time.

### 3. command Field

- **Purpose:** Tells the Java servlet which action to perform
- **Values:**
  - `login` - Submit login credentials
  - `displaySearchForm` - Show form with updated dropdowns (schedule)
  - `displayResults` - Fetch actual course data **← Critical for scraping!**
- **Discovery:** The browser calls `resetCommand()` JavaScript function before form submit, which changes `command` from `displaySearchForm` to `displayResults`.

### Cookie Chain Pattern

```typescript
// 1. Initial GET sets cookies
Set-Cookie: JSESSIONID=abc123; Path=/j_aisis

// 2. POST with cookies, may SET new cookies
Cookie: JSESSIONID=abc123
→ Set-Cookie: userSession=xyz789  // Additional session cookie

// 3. All subsequent requests include ALL cookies
Cookie: JSESSIONID=abc123; userSession=xyz789
```

---

## Data Integrity & Bleeding Prevention

### The "HTML Bleeding" Problem

AISIS is a legacy Java Struts application (~2004) with quirks that can cause data contamination:

1. **Session Crossover:** Server may return cached results from another user's session
2. **Department Misrouting:** Requesting MA (Math) may return KSP (Korean) data
3. **Partial Responses:** Network timeouts may return incomplete HTML

### Implemented Safeguards

#### 1. Record Validation

```typescript
// Filter out header rows and placeholder data
if (subjectCode.includes("SUBJECT CODE")) return; // Skip header
if (!subjectCode || subjectCode.length < 2) return; // Invalid
```

#### 2. Department Consistency Check (TODO)

```typescript
// Verify returned data matches requested department
const expectedPrefix = deptCode.substring(0, 2);
const actualPrefix = subjectCode.split(" ")[0];
if (!isExpectedPrefix(actualPrefix, deptCode)) {
  console.warn(`⚠️ Data bleeding: Requested ${deptCode}, got ${actualPrefix}`);
}
```

#### 3. Baseline Tracking (From old repo, to implement)

```javascript
// Track expected counts per department
const BASELINES = {
  DISCS: { min: 200, max: 400 },
  MA: { min: 150, max: 300, requiredPrefix: "MATH" },
  PE: { min: 50, max: 150, requiredPrefixes: ["PEPC", "PHYED"] },
};
```

---

## Gap Analysis: Old Repo vs New Implementation

| Feature                   | Old Repo                 | New Implementation | Priority |
| ------------------------- | ------------------------ | ------------------ | -------- |
| Pure HTTP requests        | ✅                       | ✅                 | -        |
| Cookie persistence        | ✅ File-based            | ✅ In-memory       | -        |
| Concurrent batching       | ✅ 8 parallel            | ✅ 8 parallel      | -        |
| Sanity checks             | ✅ Per-dept min counts   | ❌ Not implemented | **HIGH** |
| Baseline tracking         | ✅ JSON files            | ❌ Not implemented | **HIGH** |
| Header filtering          | ✅ HEADER_MARKERS        | ⚠️ Partial         | MEDIUM   |
| Course code normalization | ✅ normalizeCourseCode() | ❌ Not implemented | MEDIUM   |
| Raw HTML snapshots        | ✅ On failure            | ❌ Not implemented | MEDIUM   |
| Subject prefix validation | ✅ validate:subjects     | ❌ Not implemented | MEDIUM   |
| Supabase sync hardening   | ✅ Health checks         | ❌ Not implemented | HIGH     |
| Fallback department list  | ✅ constants.js          | ❌ Not implemented | LOW      |

### Critical Missing Features

1. **Sanity Checks:** Old repo rejects department data if:

   - MA has < 50 MATH courses
   - PE has < 20 courses or missing PEPC/PHYED
   - NSTP has < 10 NSTP courses

2. **Baseline Regression Detection:** Prevents overwriting good data with bad:

   ```
   Previous: DISCS = 271 courses
   Current:  DISCS = 13 courses (suspiciously low!)
   → Block sync, save raw HTML for debugging
   ```

3. **Raw HTML Snapshots:** When something goes wrong, save the HTML:
   ```
   logs/raw-sanity-check-failed-2025-2-MA-1705234567.html
   ```

---

## Implemented Optimizations

### ✅ Speed Improvements (Implemented)

| Optimization               | Result                                              |
| -------------------------- | --------------------------------------------------- |
| **Single GET per session** | 50% fewer requests (1 GET + 44 POST vs 88 requests) |
| **Adaptive concurrency**   | Starts at 8, backs off on errors, recovers          |
| **Reduced batch delay**    | 300ms between batches (was 500ms)                   |
| **Normalized schema**      | Integer PKs, indexed FKs, 30% smaller DB            |

### ✅ Reliability Improvements (Implemented)

- **Adaptive backoff:** On consecutive errors, reduce concurrency from 8 → 4 → 2
- **Change tracking:** Detect insert/update/unchanged per scrape
- **Scrape history:** `scrape_run` table logs all sessions

### ✅ Data Quality Improvements (Implemented)

- **Deduplication:** Instructors, rooms, courses normalized
- **FTS search:** Full-text search on course titles
- **Chatbot views:** Pre-built views for common queries

---

## CLI Usage

```bash
# Current term only (default)
npm run fast

# ALL available terms (from dropdown)
npm run fast -- --all-terms

# Specific term
npm run fast -- --term 2024-2

# Discover hidden terms (2015-2027)
npm run fast -- --discover

# Curriculum only
npm run fast -- --curriculum

# Both schedule and curriculum
npm run fast -- --all

# With custom concurrency
AISIS_CONCURRENCY=12 npm run fast
```

**Output includes change tracking:**

```
📊 2025-2: +550 new, =3450 unchanged
📈 Changes:
   Inserted:       550
   Updated:        0
   Unchanged:      3450
   Removed:        0
```

---

## Database Schema

### Normalized Schema v2 (Integer PKs)

**Lookup Tables:**

- `department` - Department codes and names
- `term` - Academic terms (2025-2, etc.) with year/semester
- `instructor` - Deduplicated instructor names (1,688 unique)
- `room` - Deduplicated room codes (310 unique)

**Data Tables:**

- `course` - Unique course catalog (2,381 courses)
- `class_section` - Schedule offerings with FK references
- `schedule_slot` - Day/time/room for each section
- `degree_program` - Curriculum program codes
- `curriculum_course` - Courses per degree program
- `scrape_run` - Metadata tracking per scrape session

### Chatbot-Friendly Views

```sql
-- "How many classes does Romina Yap have on Friday?"
SELECT * FROM v_instructor_schedule
WHERE instructor LIKE '%YAP%' AND day = 'Friday';

-- "Where are Bio classes held?"
SELECT room, SUM(slot_count) as total
FROM v_course_rooms WHERE course_code LIKE 'BIO%'
GROUP BY room ORDER BY total DESC;

-- "How many classes in 24-25?"
SELECT term, section_count FROM v_term_summary
WHERE year IN (2024, 2025);
```

---

## Files Reference

| File                           | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `src/httpAuth.ts`              | Pure HTTP authentication with cookie chaining |
| `src/httpScraper.ts`           | Schedule scraper with adaptive concurrency    |
| `src/httpCurriculumScraper.ts` | Curriculum scraper                            |
| `src/fastScraper.ts`           | CLI entry point with multi-term support       |
| `src/termDiscovery.ts`         | Hidden term discovery (2015-2027)             |
| `src/db/database.ts`           | SQLite operations with change tracking        |
| `src/db/schema.sql`            | Normalized SQLite schema                      |
| `docs/DATABASE.md`             | **Database schema documentation**             |
| `docs/AISIS_API.md`            | AISIS API documentation                       |
| `supabase/migrations/*.sql`    | PostgreSQL migrations                         |

---

## Environment Variables

```bash
# Required
AISIS_USERNAME=your_id_number
AISIS_PASSWORD=your_password

# Optional performance tuning
AISIS_CONCURRENCY=8          # Parallel requests per batch
AISIS_BATCH_DELAY_MS=500     # Delay between batches

# Future: Sanity check thresholds
SCRAPER_MIN_MA_MATH=50       # Minimum MATH courses expected
SCRAPER_MIN_PE_COURSES=20    # Minimum PE courses expected
```
