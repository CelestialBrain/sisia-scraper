#!/usr/bin/env npx tsx

/**
 * Curriculum Discovery Script
 * Probes for hidden curriculum versions not in the dropdown
 */

import { config } from 'dotenv';
import { httpLogin, httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import * as cheerio from 'cheerio';

config();

const KNOWN_PROGRAMS = [
  'BS CS', 'BS MIS', 'BS AMF', 'BS ME', 'BS ChE', 'BS ECE', 'BS CE', 'BS EcE',
  'BS PS', 'BS CH', 'BS BIO', 'BS MA', 'BS ES', 'BS APS', 'BS CoE', 'BS IDE',
  'AB COM', 'AB EC', 'AB HI', 'AB POS', 'AB MEC', 'AB PH', 'AB LIT', 'AB HUM',
  'AB DS', 'AB IS', 'AB ChnS', 'AB AM', 'AB EU', 'AB SOS',
  'BFA AM', 'BFA ID', 'BFA FA',
  'MS CS', 'MS DS', 'MS BIO', 'MS CH', 'MS MA', 'MS PS', 'MS ES',
  'MA EC', 'MA COM', 'MA PH', 'MA POS', 'MA HI', 'MA PSY',
  'MBA', 'JD', 'MD'
];

const YEARS = [2022, 2023, 2024, 2025, 2026];
const SEMESTERS = [0, 1, 2];

async function probeCurriculum(session: any, degCode: string): Promise<boolean> {
  try {
    const html = await httpPost(AISIS_URLS.CURRICULUM, session, {
      degCode,
      command: 'display',
    });
    
    const $ = cheerio.load(html);
    
    // Check if we got actual curriculum content
    const hasContent = $('table').length > 3;
    const text = $('body').text();
    const hasError = text.includes('error') || text.includes('not found') || text.includes('invalid');
    
    // Count course-like patterns
    const coursePattern = /[A-Z]{2,4}\s+\d+/g;
    const matches = text.match(coursePattern) || [];
    
    return hasContent && !hasError && matches.length > 5;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔍 Curriculum Discovery Tool\n');
  
  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  const session = await httpLogin(username, password);
  
  // First, get official list
  console.log('📋 Fetching official curriculum list...');
  const html = await httpGet(AISIS_URLS.CURRICULUM, session);
  const $ = cheerio.load(html);
  
  const officialCodes = new Set<string>();
  $('select[name="degCode"] option').each((_, el) => {
    const code = $(el).attr('value');
    if (code) officialCodes.add(code);
  });
  
  console.log(`  Found ${officialCodes.size} official programs\n`);
  
  // Probe for hidden versions
  console.log('🔎 Probing for hidden curriculum versions...\n');
  
  const hidden: string[] = [];
  let probed = 0;
  const total = KNOWN_PROGRAMS.length * YEARS.length * SEMESTERS.length;
  
  for (const program of KNOWN_PROGRAMS) {
    for (const year of YEARS) {
      for (const sem of SEMESTERS) {
        const code = `${program}_${year}_${sem}`;
        probed++;
        
        if (officialCodes.has(code)) {
          continue; // Already in official list
        }
        
        process.stdout.write(`\r  Probing ${probed}/${total}: ${code.padEnd(25)}`);
        
        const exists = await probeCurriculum(session, code);
        if (exists) {
          hidden.push(code);
          console.log(`\n  ✅ FOUND: ${code}`);
        }
        
        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }
  
  console.log('\n\n📊 Discovery Results:');
  console.log(`  Official programs: ${officialCodes.size}`);
  console.log(`  Hidden found: ${hidden.length}`);
  
  if (hidden.length > 0) {
    console.log('\n📦 Hidden Curriculum Codes:');
    hidden.forEach(code => console.log(`  - ${code}`));
  } else {
    console.log('\n  No hidden curricula found.');
  }
}

main().catch(console.error);
