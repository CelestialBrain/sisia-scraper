#!/bin/bash
# SISIA Scraper - Cron Script
# Run this with cron to scrape professor feedback automatically
#
# Example crontab entries:
#   Daily at 3am:     0 3 * * * /path/to/sisia-scraper/scripts/cron-scrape.sh
#   Weekly on Sunday: 0 4 * * 0 /path/to/sisia-scraper/scripts/cron-scrape.sh
#
# Make sure to set the SCRAPER_DIR variable below

SCRAPER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$SCRAPER_DIR/data/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create logs directory
mkdir -p "$LOG_DIR"

cd "$SCRAPER_DIR"

echo "[$TIMESTAMP] Starting scheduled scrape..." >> "$LOG_DIR/cron.log"

# Run in headless, turbo, fast mode with resume for efficiency
npx tsx src/index.ts scrape-all \
  --limit 100 \
  --max-posts 5 \
  --scroll-count 3 \
  --headless \
  --turbo \
  --fast \
  --block-images \
  --resume \
  >> "$LOG_DIR/scrape_$TIMESTAMP.log" 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$TIMESTAMP] Scrape completed successfully" >> "$LOG_DIR/cron.log"
else
  echo "[$TIMESTAMP] Scrape failed with exit code $EXIT_CODE" >> "$LOG_DIR/cron.log"
fi

# Clean up old logs (keep last 30)
ls -t "$LOG_DIR"/scrape_*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null

exit $EXIT_CODE
