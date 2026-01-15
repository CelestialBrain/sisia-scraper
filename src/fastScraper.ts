#!/usr/bin/env npx tsx

/**
 * Fast AISIS Scraper - HTTP Mode
 * Uses pure HTTP requests with concurrent batching
 * 
 * Expected performance: 5-30 seconds for full scrape
 * 
 * Usage:
 *   npm run fast                     # Scrape schedules only
 *   npm run fast -- --curriculum     # Scrape curricula only
 *   npm run fast -- --all            # Scrape both
 */

import { config } from 'dotenv';
import { httpLogin } from './httpAuth.js';
import { getScheduleOptionsHTTP, scrapeAllSchedulesHTTP } from './httpScraper.js';
import { getCurriculumOptionsHTTP, scrapeAllCurriculaHTTP } from './httpCurriculumScraper.js';
import { SISIADatabase } from './db/database.js';
import { logger } from './logger.js';

config();
logger.startSession('scrape');

// Parse CLI args
const args = process.argv.slice(2);
const scrapeCurriculum = args.includes('--curriculum') || args.includes('--all');
const scrapeSchedule = args.includes('--schedule') || args.includes('--all') || 
                        (!args.includes('--curriculum'));  // Default to schedule

async function main() {
  const startTime = Date.now();
  console.log('🚀 SISIA Fast Scraper (HTTP Mode)\n');
  console.log(`  Schedule: ${scrapeSchedule ? 'YES' : 'NO'}`);
  console.log(`  Curriculum: ${scrapeCurriculum ? 'YES' : 'NO'}\n`);

  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing credentials. Set AISIS_USERNAME and AISIS_PASSWORD in .env');
    process.exit(1);
  }

  const db = new SISIADatabase('sisia.db');

  try {
    db.initialize();
    
    // Authenticate via HTTP (no browser!)
    const session = await httpLogin(username, password);
    
    const concurrency = parseInt(process.env.AISIS_CONCURRENCY || '8');
    const batchDelay = parseInt(process.env.AISIS_BATCH_DELAY_MS || '500');

    let totalSections = 0;
    let totalCourses = 0;

    // Schedule Scraping
    if (scrapeSchedule) {
      const { periods, departments } = await getScheduleOptionsHTTP(session);
      db.saveDepartments(departments);

      const targetPeriod = periods[0]?.value;
      if (targetPeriod) {
        console.log(`\n📅 Period: ${targetPeriod}`);
        console.log(`📚 Departments: ${departments.length}`);

        const sections = await scrapeAllSchedulesHTTP(session, targetPeriod, departments, {
          concurrency,
          batchDelayMs: batchDelay,
        });

        if (sections.length > 0) {
          db.saveClassSections(sections);
          totalSections = sections.length;
        }
      }
    }

    // Curriculum Scraping
    if (scrapeCurriculum) {
      const { degrees } = await getCurriculumOptionsHTTP(session);
      console.log(`\n🎓 Degree Programs: ${degrees.length}`);

      const courses = await scrapeAllCurriculaHTTP(session, degrees, {
        concurrency: 4,  // Lower for curriculum
        batchDelayMs: 1000,
        onSave: (degree, courses) => {
          // Save each degree's curriculum as it's scraped
          db.saveCurriculumCourses(degree, courses);
        }
      });

      totalCourses = courses.length;
    }

    // Print stats
    const stats = db.getStats();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(50));
    console.log('📊 Scraping Complete!');
    console.log('='.repeat(50));
    console.log(`  Time elapsed:      ${elapsed}s`);
    console.log(`  Unique courses:    ${stats.courses}`);
    console.log(`  Class sections:    ${stats.sections}`);
    console.log(`  Degree programs:   ${stats.programs}`);
    console.log(`  Instructors:       ${stats.instructors}`);
    console.log(`  Rooms:             ${stats.rooms}`);
    console.log(`  Database:          sisia.db`);
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('❌ Scraper error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
