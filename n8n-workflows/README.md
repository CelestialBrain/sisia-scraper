# n8n Workflows for AISIS Scraping

These workflows can be imported into your n8n instance at `n8n.omnibiz.express`.

## Workflows

### 1. `schedule-scraper.json`

Full class schedule scraper - scrapes ALL departments in parallel batches.

**Endpoint:** `POST /webhook/scrape-schedule`

**Features:**

- Authenticates via HTTP (rnd token + cookie chain)
- Discovers departments dynamically from AISIS
- Scrapes 8 departments in parallel
- Returns structured JSON with all sections

**Expected time on VPS:** ~30-60 seconds for all 44 departments

---

### 2. `curriculum-scraper.json`

Curriculum scraper - scrapes degree program curricula.

**Endpoint:** `POST /webhook/scrape-curriculum`

**Features:**

- Authenticates via HTTP
- Discovers 459 degree programs
- Scrapes 4 degrees in parallel (gentler on server)
- Limited to first 50 degrees by default (edit "Split Into Degrees" node to remove limit)

**Expected time on VPS:** ~2-5 minutes for all 459 degrees

---

## Setup Instructions

### 1. Set Environment Variables

In n8n Settings → Variables, add:

```
AISIS_USERNAME = your_id_number
AISIS_PASSWORD = your_password
```

### 2. Import Workflows

1. Go to Workflows → Import from File
2. Select `schedule-scraper.json`
3. Repeat for `curriculum-scraper.json`

### 3. Activate Workflows

Enable each workflow to make the webhook endpoints available.

### 4. Test

```bash
# Test schedule scraper
curl -X POST https://n8n.omnibiz.express/webhook/scrape-schedule

# Test curriculum scraper
curl -X POST https://n8n.omnibiz.express/webhook/scrape-curriculum
```

---

## Speed Comparison

| Environment   | Schedule (44 depts)              | Curriculum (459 degrees) |
| ------------- | -------------------------------- | ------------------------ |
| **VPS (n8n)** | ~30-60s                          | ~2-5 min                 |
| **Local Mac** | ~4-5 min                         | ~15-20 min               |
| **Why?**      | Faster network, no rate limiting | Same                     |

VPS is ~5-10x faster due to:

1. Lower latency to Ateneo network
2. No residential IP rate limiting
3. Server-grade network

---

## Customization

### Change Batch Size

Edit the "Batch (X parallel)" node:

- Schedule: default 8 parallel
- Curriculum: default 4 parallel

Higher = faster but risks rate limiting.

### Add Supabase Sync

Add a Supabase node after "Aggregate Results" to save directly to your database:

1. Add Supabase node
2. Configure with your project URL and API key
3. Use Insert or Upsert operation

---

## Troubleshooting

### "Could not find rnd token"

AISIS may have changed login page structure. Check if login page HTML has changed.

### Timeout errors

Reduce batch size or add wait nodes between batches.

### Empty results

Check if `command` parameter is correct:

- Schedule: `displayResults`
- Curriculum: `display`
