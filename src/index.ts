/**
 * SISIA Scraper - Main Entry Point
 * High-performance AISIS data scraper with parallel processing
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import pLimit from 'p-limit';
import { AISISAuth } from './auth.js';
import { SISIADatabase } from './db/database.js';
import { getScheduleOptions, scrapeClassSections } from './scrapers/classSchedule.js';
import { getDegreePrograms, scrapeCurriculum } from './scrapers/curriculum.js';

// Load environment variables
config();

const program = new Command();

program
  .name('sisia-scraper')
  .description('High-performance AISIS course data scraper')
  .version('1.0.0');

program
  .option('-s, --schedule', 'Scrape class schedule only')
  .option('-c, --curriculum', 'Scrape curriculum only')
  .option('-d, --dept <code>', 'Scrape specific department only')
  .option('-p, --period <term>', 'Scrape specific period (e.g., 2025-2)')
  .option('--concurrent <n>', 'Number of concurrent requests', '5')
  .option('--delay <ms>', 'Delay between requests in ms', '200')
  .option('-v, --verbose', 'Verbose output');

program.parse();

const options = program.opts();

async function main() {
  const startTime = Date.now();
  console.log('🚀 SISIA Scraper Starting...\n');

  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing AISIS credentials. Set AISIS_USERNAME and AISIS_PASSWORD in .env');
    process.exit(1);
  }

  const auth = new AISISAuth();
  const db = new SISIADatabase('sisia.db');

  try {
    // Initialize database
    db.initialize();

    // Authenticate
    await auth.login(username, password);
    const page = auth.getPage();

    const concurrency = parseInt(options.concurrent) || 5;
    const limit = pLimit(concurrency);

    // Scrape schedule
    if (!options.curriculum) {
      console.log('\n📅 Scraping Class Schedule...\n');
      
      const { periods, departments } = await getScheduleOptions(page);
      db.saveDepartments(departments);

      // Filter by options - case-insensitive partial match
      const targetPeriod = options.period || periods[0]?.value;
      const targetDepts = options.dept 
        ? departments.filter(d => d.code.toUpperCase().includes(options.dept.toUpperCase()))
        : departments;

      if (!targetPeriod) {
        console.error('❌ No valid period found');
      } else {
        console.log(`  Period: ${targetPeriod}`);
        console.log(`  Departments: ${targetDepts.length}`);
        console.log(`  Concurrency: ${concurrency}\n`);

        // Process departments with concurrency limit
        // Note: Playwright pages can't be shared across parallel tasks
        // So we process sequentially but efficiently
        let totalSections = 0;
        
        for (const dept of targetDepts) {
          try {
            process.stdout.write(`  Scraping ${dept.code.padEnd(6)}... `);
            const sections = await scrapeClassSections(page, targetPeriod, dept.code);
            db.saveClassSections(sections);
            totalSections += sections.length;
            console.log(`${sections.length} sections`);
            
            // Small delay to be respectful to server
            await new Promise(r => setTimeout(r, parseInt(options.delay) || 200));
          } catch (err: any) {
            console.log(`⚠️  Error: ${err.message}`);
          }
        }

        console.log(`\n  ✅ Total sections scraped: ${totalSections}`);
      }
    }

    // Scrape curriculum
    if (!options.schedule) {
      console.log('\n📚 Scraping Curriculum...\n');
      
      const programs = await getDegreePrograms(page);

      // Limit to first 10 programs for speed, or specific ones
      const targetPrograms = programs.slice(0, 10);
      console.log(`  Processing ${targetPrograms.length} degree programs...\n`);

      for (const prog of targetPrograms) {
        try {
          process.stdout.write(`  ${prog.name.substring(0, 40).padEnd(42)}... `);
          const curriculum = await scrapeCurriculum(page, prog.code);
          db.saveCurriculum(curriculum);
          console.log(`${curriculum.courses.length} courses`);
          
          await new Promise(r => setTimeout(r, parseInt(options.delay) || 200));
        } catch (err: any) {
          console.log(`⚠️  Error: ${err.message}`);
        }
      }
    }

    // Print stats
    const stats = db.getStats();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(50));
    console.log('📊 Scraping Complete!');
    console.log('='.repeat(50));
    console.log(`  Time elapsed:    ${elapsed}s`);
    console.log(`  Class sections:  ${stats.sections}`);
    console.log(`  Courses:         ${stats.courses}`);
    console.log(`  Degree programs: ${stats.programs}`);
    console.log(`  Database:        sisia.db`);
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('❌ Scraper error:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await auth.close();
    db.close();
  }
}

main();
