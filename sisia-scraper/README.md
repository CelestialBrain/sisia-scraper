# SISIA Scraper

A browser-based scraping tool for collecting professor feedback from "Ateneo Profs to Pick" Facebook group.

## Features

- **Full Automation**: Automated searching, scrolling, and comment extraction
- **Batch Scraping**: Scrape multiple professors in one session
- **Resume Support**: Continue interrupted batches with `--resume`
- **Export**: JSON/CSV export with professor filtering
- **Cron Support**: Scheduled automated scraping
- **Speed Modes**: Turbo, fast, and image blocking for maximum efficiency
- **Session Persistence**: Saves Facebook login between runs

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Scrape a single professor (turbo mode)
npx tsx src/index.ts scrape-auto "TANGARA" --turbo --fast

# Batch scrape with resume
npx tsx src/index.ts scrape-batch "PROF1" "PROF2" "PROF3" --turbo --resume

# Auto-scrape all from SISIA database
npx tsx src/index.ts scrape-all --limit 50 --turbo --fast --resume
```

## Commands

### `scrape-auto <professor>` - Single Professor

```bash
npx tsx src/index.ts scrape-auto "TANGARA, Arthur" --max-posts 10 --turbo --fast
```

### `scrape-batch <professors...>` - Multiple Professors

```bash
npx tsx src/index.ts scrape-batch "PROF1" "PROF2" "PROF3" --resume --turbo
```

Saves progress to `data/batch_progress.json` - use `--resume` to continue.

### `scrape-all` - Auto-Scrape from Database

```bash
npx tsx src/index.ts scrape-all --limit 100 --turbo --fast --resume
```

Reads professors from SISIA database (`SISIA_DB_PATH`).

### `export` - Export Data

```bash
# Export all as JSON
npx tsx src/index.ts export --format json

# Export specific professor as CSV
npx tsx src/index.ts export --format csv --professor TANGARA
```

Output: `data/exports/feedback_*.json|csv`

## Speed Flags

| Flag             | Effect                      | Impact           |
| ---------------- | --------------------------- | ---------------- |
| `--turbo`        | 60% faster wait times       | Very Fast        |
| `--fast`         | Skip reaction popup parsing | Faster           |
| `--block-images` | Block images/CSS            | 20% faster loads |
| `--headless`     | No visible browser          | Background mode  |

**Maximum speed:** `--turbo --fast --block-images --headless`

## Cron Scheduling

```bash
# Make cron script executable
chmod +x scripts/cron-scrape.sh

# Add to crontab (daily at 3am)
crontab -e
0 3 * * * /path/to/sisia-scraper/scripts/cron-scrape.sh
```

Logs saved to `data/logs/`.

## Configuration

Edit `.env`:

```bash
DB_PATH=./data/scraper.db
SISIA_DB_PATH=../chat/server/data/sisia.db
PROXY_URL=http://user:pass@host:port  # Optional
```

## Data Schema

Scraped feedback includes:

- Professor name (matched to SISIA ID when possible)
- Comment text (anonymized)
- Reactions count & types
- Source post URL
- Scrape timestamp

## Anti-Detection

- Random delays between actions
- Human-like scroll behavior
- Session persistence (no repeated logins)
- Max 100 posts per session default
- User-agent rotation
