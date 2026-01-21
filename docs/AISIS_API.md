# AISIS API Reference

Technical reference for AISIS web application endpoints and data structures.

## Authentication

### Login Flow

```
GET  /j_aisis/displayLogin.do     # Get login page + rnd token
POST /j_aisis/login.do            # Submit credentials
```

**Request:**

```
POST /j_aisis/login.do
Content-Type: application/x-www-form-urlencoded

userName=254880&password=xxx&command=login&rnd=kmosnsnmp43hbv3e6q4q
```

**Hidden Fields:**
| Field | Value | Notes |
|-------|-------|-------|
| `command` | `login` | Required, literal string |
| `rnd` | `kmosnsnmp43hbv3e6q4q` | Dynamic, extracted from login page |

**Session:**

- Cookie: `JSESSIONID=xxx`
- May also appear in URL: `;jsessionid=xxx`

---

## Class Schedule (J_VCSC.do)

### Get Schedule Form

```
GET /j_aisis/J_VCSC.do
```

### Query Class Sections

```
POST /j_aisis/J_VCSC.do
Content-Type: application/x-www-form-urlencoded

applicablePeriod=2025-2&deptCode=CS&subjCode=&command=displaySearchForm
```

**Form Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `applicablePeriod` | select | `2025-2` | Format: `YYYY-S` (S=semester) |
| `deptCode` | select | `CS`, `BIO` | Department code |
| `subjCode` | select | (optional) | Specific course filter |
| `command` | hidden | `displaySearchForm` | Required |

**Dropdown Behavior:**

- `onchange="submit()"` on `applicablePeriod` and `deptCode`
- Changing either triggers full page POST to refresh options

**Response Table Columns:**
| Column | Example | Notes |
|--------|---------|-------|
| Subject Code | `CS 124` | |
| Section | `A` | |
| Course Title | `Introduction to...` | |
| Units | `3` | |
| Time | `MWF 08:30-10:00 FULLY ONSITE` | Includes modality |
| Room | `SEC A 301` | |
| Instructor | `SMITH, JOHN` | |
| Max No | `40` | Capacity |
| Lang | `ENG` | Language |
| Level | `U` | Undergrad/Grad |
| Free Slots | `5` | Available seats |
| Remarks | | |
| S | | Searchable flag |
| P | Link | Prerequisites link |

---

## Official Curriculum (J_VOFC.do)

### Get Curriculum Form

```
GET /j_aisis/J_VOFC.do
```

### Query Curriculum

```
POST /j_aisis/J_VOFC.do
Content-Type: application/x-www-form-urlencoded

degCode=BS+CS_2024_1
```

**Form Fields:**
| Field | Type | Example |
|-------|------|---------|
| `degCode` | select | `BS CS_2024_1` |

**Degree Code Format:**

```
PROGRAM_VERSION_SEMESTER
│       │       └── Semester (0, 1, 2)
│       └── Year or Year+Track (2024, 24CT)
└── Program code with modifiers (BS CS, AB EC-H)
```

**Response Structure:**

- Grouped by Year ("First Year", "Second Year", etc.)
- Sub-grouped by Semester ("First Semester", "Second Semester", "Intersession")
- Side-by-side tables (HTML bleeding) for Sem 1 and Sem 2

**Curriculum Table Columns:**
| Column | Example |
|--------|---------|
| Cat No | `CS 124` |
| Course Title | `Introduction to Computer Science` |
| Units | `3` |
| Prerequisites | `CS 121, MATH 101` |
| Category | `M` (Major), `C` (Core), `GE`, `FE` |

---

## User-Specific Endpoints

### Grades (J_VG.do)

```
GET /j_aisis/J_VG.do
```

Returns student's grades by term.

**Columns:** School Year, Sem, Course, Subject Code, Course Title, Units, Final Grade

### Individual Program of Study (J_VIPS.do)

```
GET /j_aisis/J_VIPS.do
```

Returns student's course progress.

**Status Codes:**
| Code | Meaning | Title Attribute |
|------|---------|-----------------|
| P | Passed | "Passed" |
| C | Currently Taking | "Currently Taking" |
| N | Not Yet Taken | "Not Yet Taken" |

---

## Rate Limiting

No explicit rate limiting detected, but recommended:

- 200ms delay between requests
- Max 10 concurrent requests
- Fresh session per scrape run

---

## Personal Endpoints (Authentication Required)

### My Currently Enrolled Classes (J_VCEC.do) ⭐

**Best source for instructor names!**

```
GET /j_aisis/J_VCEC.do
```

**Response Table Columns:**
| Column | Example | Notes |
|--------|---------|-------|
| Subject Code | `LLAW 11312018` | Includes term suffix |
| Section | `UV1A` | |
| Delivery Mode | `FULLY ONSITE` | |
| Course Title | `OBLIGATIONS AND CONTRACTS` | |
| **Instructor** | `Eirene Jhone AGUILA` | **Key data!** |
| Class Beadle | | Optional link |

**Course Code Format:**

```
LLAW 11312018
│    │  └── Term suffix (12018 = 1st sem 2018-2019)
│    └── Catalog number (113)
└── Subject (LLAW)
```

### My Class Schedule (J_VMCS.do)

Weekly schedule grid with times and rooms.

```
GET /j_aisis/J_VMCS.do
```

**Response:** HTML table with weekly grid showing time slots per day.

**Note:** Does NOT include instructor names - use J_VCEC.do instead.

### Grades (J_VG.do)

```
GET /j_aisis/J_VG.do
```

Returns student's grades by term.

**Columns:** School Year, Sem, Course, Subject Code, Course Title, Units, Final Grade

### Individual Program of Study (J_VIPS.do)

```
GET /j_aisis/J_VIPS.do
```

Returns student's course progress.

**Status Codes:**
| Code | Meaning | Title Attribute |
|------|---------|-----------------|
| P | Passed | "Passed" |
| C | Currently Taking | "Currently Taking" |
| N | Not Yet Taken | "Not Yet Taken" |

### Hold Orders (J_VHOR.do)

```
GET /j_aisis/J_VHOR.do
```

Returns any hold orders preventing enrollment.

---

## Session Caching

Personal endpoints use cached sessions (30-min TTL) to avoid repeated logins:

```typescript
// First request: Login + cache session
// Subsequent requests (within 30 min): Reuse cached session
```

This saves 2-3 seconds per personal query.
