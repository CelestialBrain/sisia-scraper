---
description: Guidelines for scraping AISIS website with data integrity
---

# AISIS Scraping Skill

This skill documents how to properly scrape the AISIS (Ateneo Integrated Student Information System) website while maintaining data integrity.

## AISIS Overview

| Property         | Value                                            |
| ---------------- | ------------------------------------------------ |
| **Technology**   | Struts-based Java application (`.do` extensions) |
| **Version**      | 2026.01.12                                       |
| **Established**  | ~2006 (legacy system)                            |
| **Session Type** | Highly stateful - server tracks form selections  |
| **Base URL**     | `https://aisis.ateneo.edu/j_aisis/`              |

## ⚠️ CRITICAL PRECAUTIONS

### 1. NO CONCURRENT REQUESTS

```
❌ BAD:  8 parallel requests per session
✅ GOOD: 1 request at a time (serial processing)
```

**Why**: AISIS uses server-side session state. When you POST `deptCode=TH`, the server remembers this in your session. Concurrent requests will overwrite each other's state, causing "session bleed" where one department's results leak into another's.

### 2. Rate Limiting

- **Minimum delay**: 500ms between requests
- **Recommended**: 1-2 seconds between requests
- This is a legacy system - treat it gently

### 3. Session Management

- Login creates a `JSESSIONID` cookie
- All subsequent requests MUST include this cookie
- Session expires after ~30 minutes of inactivity

---

## Available Pages & Structure

### A. View Class Schedule (`/j_aisis/J_VCSC.do`)

**Purpose**: Public course offerings and room assignments for all departments.

#### Form Structure

```
Method: POST
Fields:
  - applicablePeriod: Term code (e.g., "2025-2")
  - deptCode: Department code (e.g., "TH", "DISCS", "PH")
  - subjCode: Subject code ("ALL" for all subjects)
  - command: "displayResults" (CRITICAL - not "displaySearchForm")
```

#### Table Columns (14 columns - exact order matters!)

| Index | Column       | Notes                                  |
| ----- | ------------ | -------------------------------------- |
| 0     | Subject Code | e.g., "THEO 11"                        |
| 1     | Section      | e.g., "D2"                             |
| 2     | Course Title | Full title                             |
| 3     | Units        | Integer                                |
| 4     | Time         | Multi-line! Contains `<br/>` tags      |
| 5     | Room         | e.g., "CTC 106"                        |
| 6     | Instructor   | May contain multiple names with commas |
| 7     | Max No       | Maximum capacity                       |
| 8     | Lang         | Language code                          |
| 9     | Level        | Level code                             |
| 10    | Free Slots   | Available slots                        |
| 11    | Remarks      | Additional notes                       |
| 12    | S            | Status flag                            |
| 13    | P            | Prerequisites flag                     |

#### Time Column Parsing

The `Time` column format is complex:

```
M-TH 0800-0930
(FULLY ONSITE)
```

- First line: Day-pattern and time
- Second line (after `<br/>`): Modality

Day patterns:

- `M-TH` → Monday and Thursday
- `T-F` → Tuesday and Friday
- `M-W-F` → Monday, Wednesday, Friday
- `SAT` → Saturday
- `SUN` → Sunday

---

### B. My Class Schedule - Grid (`/j_aisis/J_VMCS.do`)

**Purpose**: Personal schedule in time-grid format (most accurate room data).

#### Table Columns

| Index | Column              |
| ----- | ------------------- |
| 0     | Time (30-min slots) |
| 1     | Mon                 |
| 2     | Tue                 |
| 3     | Wed                 |
| 4     | Thur                |
| 5     | Fri                 |
| 6     | Sat                 |

#### Cell Content (multi-line)

```
THEO 11
D2 CTC 106
(FULLY ONSITE)
```

Line 1: Subject code
Line 2: Section + Room
Line 3: Modality

**⭐ This page is the GOLD STANDARD** for room verification as it reflects real-time changes.

---

### C. My Currently Enrolled Classes (`/j_aisis/J_VCEC.do`)

**Purpose**: Clean list of enrolled courses with instructor.

#### Table Columns

| Index | Column        |
| ----- | ------------- |
| 0     | Subject Code  |
| 1     | Section       |
| 2     | Delivery Mode |
| 3     | Batch         |
| 4     | Schedule      |
| 5     | Course Title  |
| 6     | Instructor    |
| 7     | Class Beadle  |

---

### D. My Grades (`/j_aisis/J_VG.do`)

**Purpose**: Academic record with GPA.

#### Form Structure

```
Fields:
  - firstChoice: "1" (By Semester), "2" (By SY), "3" (All Grades)
```

#### Table Columns

| Index | Column       |
| ----- | ------------ |
| 0     | School Year  |
| 1     | Sem          |
| 2     | Course       |
| 3     | Subject Code |
| 4     | Course Title |
| 5     | Units        |
| 6     | Final Grade  |

**Additional Data**: Cumulative QPI and Year Level QPI in separate tables.

---

### E. Individual Program of Study (`/j_aisis/J_VIPS.do`)

**Purpose**: Degree requirements and progress tracking.

#### DOM Structure (CRITICAL for Scraping)

The IPS page uses deeply nested tables with this hierarchy:

```
<table> (outer container)
  <tr>
    <td class="text06">First Year</td>  <!-- Year header -->
  </tr>
  <tr>
    <td class="text04">First Semester   <!-- Semester header -->
      <table class="needspadding">       <!-- Course table -->
        <tr>
          <th>Status</th><th>Category No</th>...
        </tr>
        <tr>
          <td>P</td><td>ENLIT 12</td>...  <!-- Course row -->
        </tr>
      </table>
    </td>
    <td class="text04">Second Semester
      <table class="needspadding">
        ...
      </table>
    </td>
  </tr>
  <tr>
    <td class="text06">Second Year</td>
  </tr>
  <tr>
    <td class="text04">Intersession
      <table>...</table>
    </td>
  </tr>
  ...
</table>
```

**Key Insights**:

1. **Semester label is the FIRST text content of the parent `<td>`** that wraps the course table
2. **Year label is in a previous sibling `<tr>`** containing `<td class="text06">`
3. **Semester `<td>` has class `text04`** with text like "First Semester", "Intersession"
4. **Course tables are leaf tables** (no nested tables inside them)

#### Table-to-Semester Mapping (BS ME Example)

| Table # | Year | Semester     | First Course       |
| :------ | :--- | :----------- | :----------------- |
| 1       | 1    | Semester 1   | ENLIT 12           |
| 2       | 1    | Semester 2   | ENGL 11            |
| 3       | 2    | Intersession | ArtAp 10           |
| 4       | 2    | Semester 1   | FLC 11             |
| 5       | 2    | Semester 2   | ECON 110           |
| 6       | 3    | Intersession | MATH 61.2          |
| 7       | 3    | Semester 1   | PHILO 13           |
| 8       | 3    | Semester 2   | ANALYTICS ELECTIVE |
| 9       | 4    | Intersession | IE 3               |
| 10      | 4    | Semester 1   | FREE ELECTIVE      |
| 11      | 4    | Semester 2   | LAS 197.10         |

#### Cheerio Parsing Approach

```typescript
// For each course table, find semester by checking parent TD's first line
let parent = $table.parent();
while (parent.length > 0) {
  if (parent.prop("tagName")?.toLowerCase() === "td") {
    const tdText = parent.text().trim();
    const firstLine = tdText.split("\n")[0].trim();

    if (firstLine.match(/^Intersession/i)) semester = 0;
    else if (firstLine.match(/^First Semester/i)) semester = 1;
    else if (firstLine.match(/^Second Semester/i)) semester = 2;
    break;
  }
  parent = parent.parent();
}

// For year, look at previous TR siblings for td.text06
let prevSib = parent.prev();
while (prevSib.length > 0) {
  const yearTd = prevSib.find("td.text06");
  if (yearTd.length > 0) {
    const yearText = yearTd.text().trim();
    if (yearText.match(/First Year/i)) year = 1;
    // ... etc
  }
  prevSib = prevSib.prev();
}
```

#### Course Table Columns

| Index | Column                                    |
| ----- | ----------------------------------------- |
| 0     | Status (P=Passed, C=Current, N=Not taken) |
| 1     | Category No (Course Code)                 |
| 2     | Units                                     |
| 3     | Category (Course Title)                   |
| 4     | Required?                                 |
| 5     | Override Prerequisite?                    |

#### Common IPS Scraping Bugs

| Bug                               | Cause                                                     | Fix                                                 |
| :-------------------------------- | :-------------------------------------------------------- | :-------------------------------------------------- |
| All courses in Semester 1         | Using `parent.text()` which includes nested table content | Check `firstLine.match(/^Semester/i)` with anchor   |
| 5th Year appearing                | Cheerio multi-selector doesn't preserve DOM order         | Process tables individually with parent traversal   |
| Courses swapped between semesters | Looking at wrong sibling (next instead of previous)       | Use `parent.prev()` to find labels BEFORE the table |
| Missing Intersessions             | Filtering out tables with "Units Taken"                   | Each course table has this - don't filter           |

---

## Correct Scraping Strategy

### Step 1: Login and Get Session

```typescript
const session = await loginHTTP(username, password);
// session contains JSESSIONID cookie
```

### Step 2: Initialize Form State ONCE

```typescript
await httpGet(AISIS_URLS.SCHEDULE, session);
// Server now has initial form state
```

### Step 3: Process Departments SERIALLY

```typescript
for (const dept of departments) {
  const sections = await scrapeScheduleHTTP(session, period, dept.code);
  await delay(500); // Rate limit
  allSections.push(...sections);
}
```

### Step 4: Verify Data Integrity

```typescript
// Sample 5 random sections and verify against live AISIS
for (const sample of randomSamples(5, allSections)) {
  const live = await fetchSingleSection(session, sample);
  if (live.room !== sample.room) {
    console.warn(`⚠️ Room mismatch: ${sample.id}`);
  }
}
```

---

## Common Bugs and Fixes

### Bug 1: Global `formInitialized`

**Problem**: Global variable persists across scraper runs.

```typescript
// BAD - causes session bleed
let formInitialized = false;
```

**Fix**: Move inside function scope.

### Bug 2: High Concurrency

**Problem**: Multiple parallel requests cause session state corruption.
**Fix**: Use `concurrency = 1` or implement request queuing.

### Bug 3: Column Index Assumptions

**Problem**: Hardcoded column indices fail if table format varies.
**Fix**: Parse column headers first, then map by header name.

---

## Verification Commands

```bash
# Quick sample verification
sqlite3 sisia.db "SELECT c.course_code, cs.section, r.code as room, i.name
FROM class_section cs
JOIN course c ON cs.course_id = c.id
JOIN schedule_slot ss ON ss.section_id = cs.id
JOIN room r ON ss.room_id = r.id
JOIN instructor i ON cs.instructor_id = i.id
WHERE c.course_code = 'THEO 11' AND cs.section = 'D2';"

# Compare with AISIS J_VCSC.do for same course
```

---

## Safe Scrape Command

```bash
# Run with safe settings (single-threaded)
AISIS_CONCURRENCY=1 npm run fast
```
