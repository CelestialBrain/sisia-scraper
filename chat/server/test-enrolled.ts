import { scrapeEnrolledClasses } from './src/scrapers/enrolledClasses.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const username = process.env.AISIS_USERNAME || '';
const password = process.env.AISIS_PASSWORD || '';

if (!username || !password) {
  console.log('Missing AISIS credentials in .env');
  process.exit(1);
}

console.log('Testing scrapeEnrolledClasses with fixed normalizer...\n');

scrapeEnrolledClasses(username, password).then(result => {
  console.log(`Term: ${result.term}`);
  console.log(`Total classes: ${result.classes.length}\n`);
  
  console.log('Instructor names (should be LASTNAME, First Middle):');
  result.classes.forEach(c => {
    console.log(`  ${c.subject_code}: ${c.instructor}`);
  });
}).catch(err => {
  console.error('Error:', err.message);
});
