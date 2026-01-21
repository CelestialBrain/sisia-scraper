/**
 * Test new tools
 */
import { handler as compareInstructors } from './src/mcp/tools/compareInstructors.js';
import { handler as calculateGpa } from './src/mcp/tools/calculateGpa.js';
import { handler as exportScheduleIcal } from './src/mcp/tools/exportScheduleIcal.js';
import { handler as findScheduleGaps } from './src/mcp/tools/findScheduleGaps.js';
import { handler as getEnrollmentStats } from './src/mcp/tools/getEnrollmentStats.js';

async function testTools() {
  console.log('\n=== TEST 1: compare_instructors ===');
  try {
    const r1 = await compareInstructors({ course_code: 'THEO 11' });
    console.log('✅ Instructors found:', r1.instructor_count);
    console.log('   Sample:', r1.instructors?.slice(0, 2).map(i => i.name).join(', '));
  } catch (e: any) {
    console.log('❌ Error:', e.message);
  }

  console.log('\n=== TEST 2: calculate_gpa ===');
  try {
    const r2 = calculateGpa({
      current_qpi: 3.45,
      current_units: 90,
      projected_grades: [
        { units: 3, grade: 'A' },
        { units: 3, grade: 'B+' },
        { units: 3, grade: 'B' }
      ]
    });
    console.log('✅ Current QPI:', r2.current.qpi, '→ Projected:', r2.result.new_cumulative_qpi);
    console.log('   Change:', r2.result.change_direction, r2.result.change);
    console.log('   Honors:', r2.result.honors_standing);
  } catch (e: any) {
    console.log('❌ Error:', e.message);
  }

  console.log('\n=== TEST 3: export_schedule_ical ===');
  try {
    const r3 = exportScheduleIcal({ sections: ['CSCI 21 A', 'THEO 11 D2'] });
    console.log('✅ Success:', r3.success);
    console.log('   Events:', r3.events_count);
    console.log('   Sections:', r3.sections_included?.join(', '));
    console.log('   iCal preview:', r3.ical_content?.substring(0, 100) + '...');
  } catch (e: any) {
    console.log('❌ Error:', e.message);
  }

  console.log('\n=== TEST 4: find_schedule_gaps ===');
  try {
    const r4 = findScheduleGaps({ sections: ['CSCI 21 A', 'THEO 11 D2', 'MATH 21 B'] });
    console.log('✅ Gaps found:', r4.gaps_found);
    console.log('   Total free time:', r4.summary?.total_free_time);
    if (r4.gaps?.length > 0) {
      console.log('   Sample gap:', r4.gaps[0].day, r4.gaps[0].start_time, '-', r4.gaps[0].end_time);
    }
  } catch (e: any) {
    console.log('❌ Error:', e.message);
  }

  console.log('\n=== TEST 5: get_enrollment_stats ===');
  try {
    const r5 = getEnrollmentStats({ department: 'CS', limit: 5 });
    console.log('✅ Sections:', r5.summary?.total_sections);
    console.log('   Fill rate:', r5.summary?.overall_fill_rate + '%');
    console.log('   Full:', r5.summary?.full_sections, '| Open:', r5.summary?.open_sections);
    if (r5.sections?.length > 0) {
      console.log('   Sample:', r5.sections[0].course, r5.sections[0].section, '-', r5.sections[0].fill_rate + '%');
    }
  } catch (e: any) {
    console.log('❌ Error:', e.message);
  }

  console.log('\n✅ All tests complete!');
}

testTools().catch(console.error);
