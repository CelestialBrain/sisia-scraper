#!/usr/bin/env npx tsx

/**
 * Debug script to analyze AISIS HTML structure
 */

import { config } from 'dotenv';
import { httpLogin } from './httpAuth.js';
import { httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import * as fs from 'fs';

config();

async function main() {
  console.log('🔍 AISIS HTML Debug\n');

  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  try {
    const session = await httpLogin(username, password);
    
    // Fetch schedule for one department
    console.log('\n📋 Fetching MA department schedule...');
    
    // First GET to load form state
    await httpGet(AISIS_URLS.SCHEDULE, session);
    
    const html = await httpPost(AISIS_URLS.SCHEDULE, session, {
      applicablePeriod: '2025-2',
      deptCode: 'MA',
      subjCode: 'ALL',
      command: 'displayResults',  // NOT displaySearchForm!
    });
    
    // Save HTML for analysis
    fs.writeFileSync('debug_schedule.html', html);
    console.log(`✅ Saved ${html.length} bytes to debug_schedule.html`);
    
    // Quick analysis
    console.log('\n📊 HTML Analysis:');
    console.log(`  - Contains "Subject Code": ${html.includes('Subject Code')}`);
    console.log(`  - Contains "subject_code": ${html.toLowerCase().includes('subject code')}`);
    console.log(`  - Contains "<table": ${(html.match(/<table/gi) || []).length} tables`);
    console.log(`  - Contains "MATH": ${html.includes('MATH')}`);
    console.log(`  - Contains "displayLogin": ${html.includes('displayLogin')}`);
    
    // Show snippet around MATH if found
    const mathIdx = html.indexOf('MATH');
    if (mathIdx > 0) {
      console.log('\n📝 Snippet around MATH:');
      console.log(html.substring(mathIdx - 100, mathIdx + 200).replace(/</g, '\n<'));
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();
