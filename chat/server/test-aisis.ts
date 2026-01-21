/**
 * Test Personal AISIS Scrapers
 */

import { scrapePersonalSchedule } from './src/scrapers/personalSchedule.js';
import { scrapePersonalIPS } from './src/scrapers/personalIPS.js';
import { scrapePersonalGrades } from './src/scrapers/personalGrades.js';
import { scrapeHoldOrders } from './src/scrapers/holdOrders.js';

const username = process.argv[2] || '254880';
const password = process.argv[3] || 'Passw123!';

async function testAll() {
  console.log('Testing AISIS personal scrapers...\n');
  
  // Test Schedule
  try {
    console.log('=== SCHEDULE ===');
    const schedule = await scrapePersonalSchedule(username, password);
    console.log('Term:', schedule.term);
    console.log('Classes found:', schedule.schedule.length);
    
    // Show professors and rooms
    const professors = new Set<string>();
    const rooms = new Set<string>();
    
    for (const slot of schedule.schedule) {
      rooms.add(slot.room);
    }
    
    console.log('Rooms:', Array.from(rooms).join(', '));
    console.log('\nWeekly grid:');
    for (const [day, slots] of Object.entries(schedule.weekly_grid)) {
      console.log(`  ${day}:`, slots.map(s => `${s.time} ${s.course_code}`).join(', '));
    }
  } catch (err: any) {
    console.error('Schedule error:', err.message);
  }
  
  console.log('\n');
  
  // Test IPS
  try {
    console.log('=== IPS ===');
    const ips = await scrapePersonalIPS(username, password);
    console.log('Program:', ips.program);
    console.log('Progress:', ips.progress_percentage + '%');
    console.log('Total units:', ips.summary.total_units);
    console.log('Units taken:', ips.summary.units_taken);
    console.log('Remaining:', ips.summary.remaining_units);
    console.log('Courses:', ips.courses.length);
  } catch (err: any) {
    console.error('IPS error:', err.message);
  }
  
  console.log('\n');
  
  // Test Grades
  try {
    console.log('=== GRADES ===');
    const grades = await scrapePersonalGrades(username, password);
    console.log('Cumulative QPI:', grades.qpi_summary.cumulative_qpi);
    console.log('Total grades:', grades.grades.length);
    
    if (grades.grades.length > 0) {
      // Find lowest grade
      const numericGrades = grades.grades
        .filter(g => !isNaN(parseFloat(g.final_grade)) && parseFloat(g.final_grade) > 0)
        .sort((a, b) => parseFloat(b.final_grade) - parseFloat(a.final_grade));
      
      if (numericGrades.length > 0) {
        const lowest = numericGrades[0];
        console.log(`Lowest grade: ${lowest.final_grade} in ${lowest.subject_code} (${lowest.course_title})`);
      }
      
      // Show sample grades
      console.log('\nRecent grades:');
      grades.grades.slice(0, 5).forEach(g => {
        console.log(`  ${g.subject_code}: ${g.final_grade}`);
      });
    }
  } catch (err: any) {
    console.error('Grades error:', err.message);
  }
  
  console.log('\n');
  
  // Test Hold Orders
  try {
    console.log('=== HOLD ORDERS ===');
    const holds = await scrapeHoldOrders(username, password);
    console.log(holds.message);
    if (holds.has_holds) {
      console.log('Hold count:', holds.hold_count);
      holds.holds.forEach(h => {
        console.log(`  - ${h.type}: ${h.reason}`);
      });
    }
  } catch (err: any) {
    console.error('Hold orders error:', err.message);
  }
}

testAll().catch(console.error);
