#!/usr/bin/env npx tsx

/**
 * Debug curriculum HTML structure
 */

import { config } from 'dotenv';
import { httpLogin } from './httpAuth.js';
import { httpGet, httpPost, AISIS_URLS } from './httpAuth.js';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

config();

async function main() {
  console.log('🔍 Debugging Curriculum Parser\n');

  const username = process.env.AISIS_USERNAME;
  const password = process.env.AISIS_PASSWORD;

  if (!username || !password) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  try {
    const session = await httpLogin(username, password);
    
    // First get the curriculum page to see dropdown
    const optionsHtml = await httpGet(AISIS_URLS.CURRICULUM, session);
    const $opt = cheerio.load(optionsHtml);
    
    // Find degree codes in dropdown
    const degrees: string[] = [];
    $opt('select[name="degCode"] option').each((_, el) => {
      const val = $opt(el).attr('value');
      if (val) degrees.push(val);
    });
    
    console.log(`📋 Found ${degrees.length} degree programs`);
    console.log(`   First 5: ${degrees.slice(0, 5).join(', ')}`);
    
    // Now fetch a specific curriculum (BS CS)
    const targetDeg = degrees.find(d => d.includes('CS')) || degrees[0];
    console.log(`\n🎯 Fetching curriculum for: ${targetDeg}`);
    
    // Try different command values
    for (const cmd of ['displaySearchForm', 'displayResults', 'display']) {
      console.log(`\n📡 Trying command: ${cmd}`);
      
      await httpGet(AISIS_URLS.CURRICULUM, session);
      const html = await httpPost(AISIS_URLS.CURRICULUM, session, {
        degCode: targetDeg,
        command: cmd,
      });
      
      const $ = cheerio.load(html);
      
      // Analyze structure
      console.log(`   HTML bytes: ${html.length}`);
      console.log(`   Tables: ${$('table').length}`);
      console.log(`   TRs: ${$('tr').length}`);
      console.log(`   Contains "CSCI": ${html.includes('CSCI')}`);
      console.log(`   Contains "Introduction": ${html.includes('Introduction')}`);
      console.log(`   Contains "FIRST YEAR": ${html.includes('FIRST YEAR')}`);
      console.log(`   Contains "Units": ${html.includes('Units')}`);
      
      // Save for analysis
      fs.writeFileSync(`debug_curriculum_${cmd}.html`, html);
      console.log(`   Saved: debug_curriculum_${cmd}.html`);
      
      // If we found course data, analyze table structure
      if (html.includes('CSCI') || html.includes('Introduction')) {
        console.log('\n✅ Found course data! Analyzing structure...');
        
        // Find all text content in tables
        let courseCount = 0;
        $('table tr').each((i, tr) => {
          const cells = $(tr).find('td');
          if (cells.length >= 3) {
            const row = cells.map((_, c) => $(c).text().trim()).get();
            if (row[0] && row[0].match(/^[A-Z]{2,}/)) {
              courseCount++;
              if (courseCount <= 5) {
                console.log(`   Course ${courseCount}: ${row.slice(0, 3).join(' | ')}`);
              }
            }
          }
        });
        console.log(`   Total course-like rows: ${courseCount}`);
        break;
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();
