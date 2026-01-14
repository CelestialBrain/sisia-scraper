# SISIA Scraper - Comprehensive Documentation

## Overview

The SISIA (Student Information System Integration and Scraping Application) scraper is a high-performance HTTP-based data extraction tool for Ateneo's AISIS system. It uses pure HTTP requests with cookie-based session management to achieve **~30x faster** scraping compared to browser automation.

**Performance Stats:**
| Metric | Value |
|--------|-------|
| Full schedule scrape (44 depts) | ~240 seconds |
| Class sections | ~4,000+ |
| Concurrency | 8 parallel requests |
| Database | SQLite (local) / Supabase (production) |

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

## Possible Optimizations

### 1. Speed Improvements

| Change                        | Expected Impact | Risk               |
| ----------------------------- | --------------- | ------------------ |
| Increase concurrency to 12-16 | -30% time       | Rate limiting      |
| Remove GET before POST        | -50% requests   | May break sessions |
| Reduce batch delay to 200ms   | -30% time       | Server stress      |
| Connection pooling            | -10% time       | Complexity         |

### 2. Reliability Improvements

- **Retry with exponential backoff:** On 500 errors, wait 1s, 2s, 4s
- **Circuit breaker:** If 5+ failures, pause 30s
- **Session refresh:** Every 100 requests, re-authenticate

### 3. Data Quality Improvements

- Implement sanity checks from old repo
- Add baseline tracking with JSON persistence
- Validate subject prefixes match department
- Save problematic HTML for debugging

---

## CLI Usage

```bash
# Schedule only (default)
npm run fast

# Curriculum only
npm run fast -- --curriculum

# Both schedule and curriculum
npm run fast -- --all

# With custom concurrency
AISIS_CONCURRENCY=12 npm run fast

# With custom delay
AISIS_BATCH_DELAY_MS=200 npm run fast
```

---

## Database Schema

### SQLite (sisia.db)

- `departments` - Department codes and names
- `class_sections` - Full schedule data with schedule slots
- `schedule_slots` - Individual day/time/room entries
- `degree_programs` - Curriculum program codes
- `curriculum_courses` - Courses per degree program

### Supabase (PostgreSQL)

Same schema, see `supabase/migrations/0001_initial_schema.sql`

Local Supabase runs on custom ports:

- API: http://127.0.0.1:54331
- DB: postgresql://postgres:postgres@127.0.0.1:54332/postgres
- Studio: http://127.0.0.1:54333

---

## Files Reference

| File                           | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `src/httpAuth.ts`              | Pure HTTP authentication with cookie chaining |
| `src/httpScraper.ts`           | Schedule scraper with concurrent batching     |
| `src/httpCurriculumScraper.ts` | Curriculum scraper                            |
| `src/fastScraper.ts`           | CLI entry point                               |
| `src/db/database.ts`           | SQLite operations                             |
| `src/db/schema.sql`            | SQLite schema                                 |
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
