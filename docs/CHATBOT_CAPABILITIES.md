# SISIA Chatbot Capabilities & Limitations

_Updated: January 17, 2026_

## Overview

SISIA is an AI-powered Ateneo schedule assistant using Google Gemini with 31 MCP tools (26 public + 5 personal). It helps students with course search, schedule building, instructor lookups, room schedules, and curriculum planning.

## Supported Capabilities

### 1. Course & Section Search

- **Keyword Search**: "Search for courses about Ethics" → Returns relevant courses
- **Course Code Normalization**: "CS 21" → Automatically converts to "CSCI 21"
- **Partial Matching**: "MATH 31" → Suggests MATH 31.1, 31.2, 31.3, 31.4
- **Time-Based Search**: "Classes on Saturday morning" → Filtered results
- **Modality Filter**: "Online classes only" → 77 online sections available

### 2. Instructor Lookups

- **Fuzzy Search**: "Find Nable" → "Job A. Nable" (handles typos)
- **Co-Teaching Parsing**: "BUOT, JUDE C., NABLE, JOB A." → Parsed as 2 instructors
- **Instructor Schedule**: "When does Mallari teach?" → Full weekly schedule
- **Instructor Stats**: "Who teaches the most sections?" → Ranked list
- **Instructor Chaining**: "Who is my THEO teacher and what else do they teach?" → Works!

### 3. Room Schedules (Comprehensive)

#### ✅ Fully Working Queries

| Query Type                  | Example                                              | Result                          |
| --------------------------- | ---------------------------------------------------- | ------------------------------- |
| **Room Schedule**           | "SEC A202 schedule today"                            | Lists all classes in room       |
| **Room Availability**       | "When is SEC A202 free today?"                       | Shows free time slots           |
| **Free Rooms by Building**  | "Find free rooms in SEC building Monday 3pm"         | Comprehensive list              |
| **Professors in Room**      | "Which professors teach in CTC 407?"                 | Lists instructors with sections |
| **Room Daily Schedule**     | "What's happening in SOM 103 Tuesday?"               | Hourly breakdown                |
| **Room Availability Check** | "Is F-228 available Friday 2pm?"                     | Yes/No with details             |
| **Classes in Building**     | "SEC building rooms with CSCI classes"               | Course-room mapping             |
| **Room Comparison**         | "Compare SOM 102 and SOM 103 schedules Tuesday"      | Side-by-side view               |
| **Study Room Finder**       | "Find a room for a 2-hour study session Tuesday 3pm" | Recommendations                 |

#### ⚠️ Queries Requiring Clarification

The AI will ask for more details for these queries:

| Query Type                                     | AI Response                          |
| ---------------------------------------------- | ------------------------------------ |
| "Find lab rooms available Wednesday afternoon" | Asks for specific time (e.g., 14:00) |
| "When does room F-228 have breaks?"            | Asks which day                       |
| "List all rooms with classes after 6pm"        | Asks which day                       |

#### ❌ Not Supported (Aggregation)

| Query Type                            | Reason                                |
| ------------------------------------- | ------------------------------------- |
| "Which building has most free rooms?" | Cannot aggregate across all buildings |
| "Room with least classes this week"   | Cannot compare all rooms              |
| "Busiest room on campus"              | Requires global analysis              |

> **Tip**: For aggregation queries, specify a building (e.g., "Which SEC room has the most free time?")

### 4. Curriculum & Programs

- **Program Lookup**: Supports 100+ degree programs
- **Alias Expansion**:
  - "BS CS" → BS Computer Science ✅
  - "Management Honors" → BS MGT-H ✅
  - "Economics Honors" → AB EC-H ✅
  - "Chinese Studies Business" → AB ChnS-B ✅
- **Year Filtering**: "BS CS curriculum Year 3" → Shows only 3rd year courses
- **Version Support**: Can specify curriculum year (2020, 2024, 2025)

### 5. Schedule Building

- **Constraint Support**:
  - No Saturday classes
  - Morning/afternoon only
  - No morning classes (starts after 12pm)
  - Start after/before specific time
  - Building preference
  - No Friday classes
- **Conflict Detection**: Automatic checking between sections
- **Multi-Course Building**: Builds optimal schedule from course list (up to 15 courses)
- **Instructor Display**: Shows real instructor names (not TBA)
- **Performance**: 15 courses in ~2.4 seconds

### 6. Personal AISIS Data (Requires Login)

| Feature                 | Description                               | Status                |
| ----------------------- | ----------------------------------------- | --------------------- |
| **Schedule**            | Your enrolled classes with instructors    | ✅ Real names         |
| **QPI & Grades**        | Cumulative QPI + all grades               | ✅ Tested: 3.57 QPI   |
| **IPS Progress**        | Remaining courses by year/semester        | ✅ Full breakdown     |
| **Hold Orders**         | Enrollment blocks                         | ✅ "No pending holds" |
| **Instructor Chaining** | "Who is my THEO teacher?" + full schedule | ✅ Works              |

## Tool Usage Reference

| User Query Intent            | Tool Used            | Reliability                |
| ---------------------------- | -------------------- | -------------------------- |
| "Search for [topic]"         | `search_courses`     | Very High                  |
| "Who is [Instructor]"        | `search_instructors` | Very High                  |
| "Room [Name] schedule"       | `get_room_schedule`  | Very High                  |
| "Free rooms in [Building]"   | `search_free_rooms`  | Very High                  |
| "Professors in [Room]"       | `get_room_schedule`  | Very High                  |
| "Curriculum for [Program]"   | `get_curriculum`     | High (with aliases)        |
| "Prerequisites for [Course]" | `get_prerequisites`  | High                       |
| "Build schedule with..."     | `build_schedule`     | High (constraint handling) |
| "My schedule"                | `get_my_schedule`    | High (requires login)      |
| "My grades"                  | `get_my_grades`      | High (requires login)      |
| "My IPS"                     | `get_my_ips`         | High (requires login)      |
| "My hold orders"             | `get_my_hold_orders` | High (requires login)      |

## Known Limitations

### 1. Schedule Building

- Returns failure with helpful message if constraints are too restrictive
- Suggests removing constraints or dropping courses
- Some course combinations may be impossible to schedule together

### 2. Program Name Variations

- Best results with official codes: "BS ME", "AB EC-H", "BS MGT"
- Common aliases like "BS CS", "Compsci" are now supported

### 3. Section Availability

- Slots can show negative numbers (-4 slots) = overenrolled sections
- This is real AISIS data, not a bug

### 4. Room Aggregation

- Cannot compare rooms across entire campus
- Must specify building for "most free" type queries

## Performance (Updated Jan 2026)

| Metric                       | Before     | After                    |
| ---------------------------- | ---------- | ------------------------ |
| Initial response time        | 80s        | 1.5s                     |
| Personal data fetch          | Sequential | Concurrent (all at once) |
| Schedule build (15 courses)  | N/A        | 2.4s                     |
| Cache duration               | None       | 30 minutes               |
| Instructor search duplicates | 5+         | 1 (deduplicated)         |

## Recommendations for Users

### For Best Results

1. **Use specific course codes**: "CSCI 21" instead of "CS 21"
2. **Use official program codes**: "BS ME" or "Management Engineering"
3. **Specify constraints clearly**: "no Saturday, afternoon only"
4. **For honors programs**: Say "Management Honors" or "BS MGT-H"

### For Room Queries

1. **Always specify the day**: "SEC A202 schedule Monday" (not just "SEC A202 schedule")
2. **Include time for availability**: "Free rooms in SEC 3pm Monday"
3. **Be specific about building**: "SEC building" not "Science building"

### For Personal Data

1. **Link your AISIS account** via the user menu
2. **Session tokens expire** - re-link if you get errors
3. **Use specific queries**: "My QPI" or "My schedule with instructors"

## Testing Results (Jan 17, 2026)

### Browser Test Summary

| Category            | Tests  | Pass Rate                  |
| ------------------- | ------ | -------------------------- |
| Personal Schedule   | 2      | 100%                       |
| QPI/Grades          | 2      | 100%                       |
| IPS Progress        | 1      | 100%                       |
| Hold Orders         | 1      | 100%                       |
| Schedule Building   | 3      | 100%                       |
| Room Schedules      | 10     | 80% (2 need clarification) |
| Instructor Chaining | 2      | 100%                       |
| **Total**           | **21** | **95%**                    |
