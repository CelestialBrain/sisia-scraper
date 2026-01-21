#!/usr/bin/env tsx
/**
 * Concurrency Benchmark Script
 * Tests different concurrency levels and measures data integrity
 */

import { httpLogin } from './httpAuth.js';
import { getScheduleOptionsHTTP, scrapeScheduleHTTP, verifyScrapeIntegrity } from './httpScraper.js';
import pLimit from 'p-limit';
import dotenv from 'dotenv';
dotenv.config();

interface BenchmarkResult {
  concurrency: number;
  timeSeconds: number;
  sectionsScraped: number;
  verificationsRun: number;
  mismatches: string[];
  errorRate: number;
}

async function runBenchmark(concurrency: number): Promise<BenchmarkResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TESTING CONCURRENCY = ${concurrency}`);
  console.log(`${'='.repeat(60)}\n`);
  
  const username = process.env.AISIS_USERNAME || '';
  const password = process.env.AISIS_PASSWORD || '';
  
  if (!username || !password) {
    throw new Error('AISIS_USERNAME and AISIS_PASSWORD required');
  }
  
  // Fresh login for each test
  const session = await httpLogin(username, password);
  const options = await getScheduleOptionsHTTP(session);
  
  const period = '2025-2';
  const departments = options.departments.slice(0, 10); // Test first 10 departments
  
  const startTime = Date.now();
  const allSections: any[] = [];
  let formInitialized = false;
  
  // Batch processing with specified concurrency
  const limit = pLimit(concurrency);
  
  const tasks = departments.map(dept => 
    limit(async () => {
      try {
        const needsInit = !formInitialized;
        formInitialized = true;
        
        const sections = await scrapeScheduleHTTP(session, period, dept.code, {
          ensureFormInit: needsInit
        });
        
        console.log(`  ${dept.code.padEnd(8)} ${sections.length} sections`);
        return sections;
      } catch (err: any) {
        console.error(`  ⚠️ ${dept.code}: ${err.message}`);
        return [];
      }
    })
  );
  
  const results = await Promise.all(tasks);
  for (const sections of results) {
    allSections.push(...sections);
  }
  
  const timeSeconds = (Date.now() - startTime) / 1000;
  
  // Verification - sample 10 sections
  console.log(`\n🔍 Verifying 10 random sections...`);
  const verification = await verifyScrapeIntegrity(session, period, allSections, 10);
  
  const result: BenchmarkResult = {
    concurrency,
    timeSeconds,
    sectionsScraped: allSections.length,
    verificationsRun: 10,
    mismatches: verification.mismatches,
    errorRate: verification.mismatches.length / 10
  };
  
  console.log(`\n📊 Results for concurrency=${concurrency}:`);
  console.log(`   Time: ${timeSeconds.toFixed(1)}s`);
  console.log(`   Sections: ${allSections.length}`);
  console.log(`   Mismatches: ${verification.mismatches.length}/10`);
  console.log(`   Error rate: ${(result.errorRate * 100).toFixed(1)}%`);
  
  // Cool-down between tests
  await new Promise(r => setTimeout(r, 3000));
  
  return result;
}

async function main() {
  console.log('🔬 AISIS Concurrency Benchmark');
  console.log('Testing concurrency levels: 1, 2, 4, 8\n');
  
  const results: BenchmarkResult[] = [];
  
  for (const concurrency of [1, 2, 4, 8]) {
    try {
      const result = await runBenchmark(concurrency);
      results.push(result);
    } catch (err: any) {
      console.error(`Failed at concurrency ${concurrency}: ${err.message}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK SUMMARY');
  console.log('='.repeat(60));
  console.log('\n| Concurrency | Time (s) | Sections | Mismatches | Error Rate |');
  console.log('|-------------|----------|----------|------------|------------|');
  
  for (const r of results) {
    const timeStr = r.timeSeconds.toFixed(1).padStart(8);
    const sectionsStr = r.sectionsScraped.toString().padStart(8);
    const mismatchStr = `${r.mismatches.length}/10`.padStart(10);
    const errorStr = `${(r.errorRate * 100).toFixed(1)}%`.padStart(10);
    console.log(`| ${r.concurrency.toString().padStart(11)} |${timeStr} |${sectionsStr} |${mismatchStr} |${errorStr} |`);
  }
  
  // Find optimal
  const optimal = results.reduce((best, curr) => {
    // If error rate is 0, prefer faster
    if (curr.errorRate === 0 && best.errorRate === 0) {
      return curr.timeSeconds < best.timeSeconds ? curr : best;
    }
    // Otherwise prefer lower error rate
    return curr.errorRate < best.errorRate ? curr : best;
  }, results[0]);
  
  console.log(`\n✅ RECOMMENDATION: Concurrency = ${optimal.concurrency}`);
  console.log(`   - Time: ${optimal.timeSeconds.toFixed(1)}s`);
  console.log(`   - Error rate: ${(optimal.errorRate * 100).toFixed(1)}%`);
  
  if (results.some(r => r.errorRate > 0)) {
    console.log('\n⚠️  Mismatched sections detected:');
    for (const r of results) {
      if (r.mismatches.length > 0) {
        console.log(`   Concurrency ${r.concurrency}:`);
        r.mismatches.forEach(m => console.log(`     - ${m}`));
      }
    }
  }
}

main().catch(console.error);
