#!/usr/bin/env npx tsx

/**
 * Fast AISIS Scraper - HTTP Mode
 * Uses pure HTTP requests with concurrent batching
 * 
 * Usage:
 *   npm run fast                     # Current term only
 *   npm run fast -- --all-terms      # ALL available terms
 *   npm run fast -- --term 2024-2    # Specific term
 *   npm run fast -- --discover       # Discover hidden terms
 *   npm run fast -- --curriculum     # Curricula only
 *   npm run fast -- --all            # Schedules + curricula
 */

import { config } from 'dotenv';
import { httpLogin } from './httpAuth.js';
import { getScheduleOptionsHTTP, scrapeAllSchedulesHTTP } from './httpScraper.js';
import { getCurriculumOptionsHTTP, scrapeAllCurriculaHTTP } from './httpCurriculumScraper.js';
import { SISIADatabase, type ScrapeStats } from './db/database.js';
import { logger } from './logger.js';
import { getListedTerms, discoverAllTerms } from './termDiscovery.js';

config();
logger.startSession('scrape');

// Parse CLI args
const args = process.argv.slice(2);
const scrapeCurriculum = args.includes('--curriculum') || args.includes('--all');
const scrapeSchedule = args.includes('--schedule') || args.includes('--all') || 
                        (!args.includes('--curriculum'));
const allTerms = args.includes('--all-terms');
const discoverOnly = args.includes('--discover');
const termIndex = args.indexOf('--term');
const specificTerm = termIndex !== -1 ? args[termIndex + 1] : null;

function formatStats(stats: ScrapeStats): string {
  const parts: string[] = [];
  if (stats.inserted > 0) parts.push(`+${stats.inserted} new`);
  if (stats.updated > 0) parts.push(`~${stats.updated} updated`);
  if (stats.unchanged > 0) parts.push(`=${stats.unchanged} unchanged`);
  if (stats.removed > 0) parts.push(`-${stats.removed} removed`);
  return parts.join(', ') || 'no changes';
}

async function main() {
  const startTime = Date.now();
  console.log('🚀 SISIA Fast Scraper (HTTP Mode)\n');
  console.log(`  Schedule:    ${scrapeSchedule ? 'YES' : 'NO'}`);
  console.log(`  Curriculum:  ${scrapeCurriculum ? 'YES' : 'NO'}`);
  console.log(`  All terms:   ${allTerms ? 'YES' : 'NO'}`);
  if (specificTerm) console.log(`  Term:        ${specificTerm}`);
  console.log();

  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing credentials. Set AISIS_USERNAME and AISIS_PASSWORD in .env');
    process.exit(1);
  }

  const db = new SISIADatabase('sisia.db');

  try {
    db.initialize();
    
    // Authenticate via HTTP
    const session = await httpLogin(username, password);
    
    const concurrency = parseInt(process.env.AISIS_CONCURRENCY || '8');
    const batchDelay = parseInt(process.env.AISIS_BATCH_DELAY_MS || '500');

    // Term Discovery Mode
    if (discoverOnly) {
      const terms = await discoverAllTerms(session);
      console.log('\n📋 All discovered terms:');
      terms.forEach(t => {
        const marker = t.sectionCount ? `(${t.sectionCount} sections)` : '';
        console.log(`  ${t.code}: ${t.label} ${marker}`);
      });
      db.close();
      return;
    }

    // Determine which terms to scrape
    let termsToScrape: string[] = [];
    
    if (specificTerm) {
      termsToScrape = [specificTerm];
    } else if (allTerms) {
      const listed = await getListedTerms(session);
      termsToScrape = listed.map(t => t.code);
      console.log(`📅 Found ${termsToScrape.length} terms: ${termsToScrape.join(', ')}`);
    } else {
      // Default: current term (first in dropdown)
      const { periods } = await getScheduleOptionsHTTP(session);
      if (periods[0]) {
        termsToScrape = [periods[0].value];
      }
    }

    const allStats: ScrapeStats = { inserted: 0, updated: 0, unchanged: 0, removed: 0, total: 0 };

    // Schedule Scraping
    if (scrapeSchedule && termsToScrape.length > 0) {
      const { departments } = await getScheduleOptionsHTTP(session);
      db.saveDepartments(departments);

      for (const termCode of termsToScrape) {
        console.log(`\n📅 Term: ${termCode}`);
        console.log(`📚 Departments: ${departments.length}`);
        
        // Start scrape run
        const runId = db.startScrapeRun(termCode, 'schedule');

        try {
          const sections = await scrapeAllSchedulesHTTP(session, termCode, departments, {
            concurrency,
            batchDelayMs: batchDelay,
          });

          if (sections.length > 0) {
            const stats = db.saveClassSectionsWithStats(sections);
            
            // Aggregate stats
            allStats.inserted += stats.inserted;
            allStats.updated += stats.updated;
            allStats.unchanged += stats.unchanged;
            allStats.removed += stats.removed;
            allStats.total += stats.total;
            
            // Print term stats
            console.log(`\n  📊 ${termCode}: ${formatStats(stats)}`);
            
            // Complete scrape run
            db.endScrapeRun(runId, stats, 'completed');
          } else {
            db.endScrapeRun(runId, { inserted: 0, updated: 0, unchanged: 0, removed: 0, total: 0 }, 'completed');
          }
        } catch (err: any) {
          db.endScrapeRun(runId, allStats, 'failed', err.message);
          throw err;
        }
      }
    }

    // Curriculum Scraping
    if (scrapeCurriculum) {
      const { degrees } = await getCurriculumOptionsHTTP(session);
      console.log(`\n🎓 Degree Programs: ${degrees.length}`);

      const runId = db.startScrapeRun(null, 'curriculum');
      
      try {
        const courses = await scrapeAllCurriculaHTTP(session, degrees, {
          concurrency: 4,
          batchDelayMs: 1000,
          onSave: (degree, courses) => {
            db.saveCurriculumCourses(degree, courses);
          }
        });
        
        db.endScrapeRun(runId, { inserted: courses.length, updated: 0, unchanged: 0, removed: 0, total: courses.length }, 'completed');
      } catch (err: any) {
        db.endScrapeRun(runId, { inserted: 0, updated: 0, unchanged: 0, removed: 0, total: 0 }, 'failed', err.message);
        throw err;
      }
    }

    // Print final summary
    const dbStats = db.getStats();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(55));
    console.log('📊 Scraping Complete!');
    console.log('='.repeat(55));
    console.log(`  Time elapsed:      ${elapsed}s`);
    console.log(`  Terms scraped:     ${termsToScrape.length}`);
    console.log();
    console.log('  📈 Changes:');
    console.log(`     Inserted:       ${allStats.inserted}`);
    console.log(`     Updated:        ${allStats.updated}`);
    console.log(`     Unchanged:      ${allStats.unchanged}`);
    console.log(`     Removed:        ${allStats.removed}`);
    console.log();
    console.log('  📦 Database totals:');
    console.log(`     Courses:        ${dbStats.courses}`);
    console.log(`     Sections:       ${dbStats.sections}`);
    console.log(`     Programs:       ${dbStats.programs}`);
    console.log(`     Instructors:    ${dbStats.instructors}`);
    console.log(`     Rooms:          ${dbStats.rooms}`);
    console.log('='.repeat(55));

    // Show recent runs
    const recentRuns = db.getRecentScrapeRuns(3);
    if (recentRuns.length > 1) {
      console.log('\n📜 Recent scrape runs:');
      recentRuns.forEach(r => {
        const date = r.startedAt.toLocaleDateString();
        const time = r.startedAt.toLocaleTimeString();
        console.log(`   ${date} ${time} - ${r.termCode || 'all'}: +${r.stats.inserted} ~${r.stats.updated} -${r.stats.removed}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Scraper error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
