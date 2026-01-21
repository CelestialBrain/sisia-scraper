/**
 * Test curriculum parser
 */

import { scrapeCurriculumHTTP } from './src/httpCurriculumScraper.js';
import { httpLogin } from './src/httpAuth.js';

async function test() {
  console.log('Testing curriculum scraper...\n');
  
  const session = await httpLogin(
    process.env.AISIS_USERNAME!,
    process.env.AISIS_PASSWORD!
  );
  
  // Test BS ME 2025
  const courses = await scrapeCurriculumHTTP(session, 'BS ME_2025_1');
  
  console.log('Total courses:', courses.length);
  
  const y1s1 = courses.filter(c => c.year === 1 && c.semester === 1);
  const y1s2 = courses.filter(c => c.year === 1 && c.semester === 2);
  const y2s1 = courses.filter(c => c.year === 2 && c.semester === 1);
  
  console.log('\n=== Year 1 Semester 1 ===');
  console.log(y1s1.map(c => c.subjectCode).join(', '));
  
  console.log('\n=== Year 1 Semester 2 ===');
  console.log(y1s2.map(c => c.subjectCode).join(', '));
  
  console.log('\n=== Year 2 Semester 1 ===');
  console.log(y2s1.map(c => c.subjectCode).join(', '));
}

test().catch(console.error);
