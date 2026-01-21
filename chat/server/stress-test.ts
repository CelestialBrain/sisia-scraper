import { handleFunctionCall, toolNames } from './src/mcp/tools/index.ts';

console.log('=== STRESS TEST: All ' + toolNames.length + ' Tools ===\n');

const tests: [string, Record<string, unknown>][] = [
  // Handbook tools
  ['get_grading_system', { grade: 'S' }],
  ['get_grading_system', { grade: 'A' }],
  ['get_grading_system', {}],
  ['get_honors_requirements', {}],
  ['get_honors_requirements', { current_qpi: 3.5 }],
  ['get_qpi_requirements', {}],
  ['search_rules', { query: 'academic integrity' }],
  ['get_code_of_conduct', {}],
  
  // Course tools  
  ['search_courses', { query: 'MATH', limit: 5 }],
  ['search_courses', { query: 'THEO 11' }],
  ['get_course_sections', { course_code: 'MATH 10' }],
  ['get_course_info', { course_code: 'CSCI 21' }],
  
  // Instructor tools
  ['search_instructors', { name: 'LOZADA' }],
  ['get_instructor_schedule', { instructor_name: 'NABLE' }],
  ['get_instructor_stats', { instructor_name: 'CABRAL' }],
  
  // Room tools
  ['get_room_schedule', { room: 'CTC 106', day: 'Monday' }],
  ['find_free_rooms', { day: 'Monday', start_time: '08:00', end_time: '09:30' }],
  
  // Professor feedback
  ['get_professor_feedback', { professor_name: 'GARCES' }],
  
  // Data tools
  ['list_departments', {}],
  ['get_data_status', {}],
];

let passed = 0;
let failed = 0;

for (const [name, args] of tests) {
  try {
    const r = await handleFunctionCall(name, args) as Record<string, any>;
    const ok = !r.error;
    if (ok) passed++;
    else failed++;
    
    let summary = 'OK';
    if (r.error) summary = 'ERR: ' + r.error;
    else if (r.grade) summary = r.grade + ': ' + (r.description || r.quality_points);
    else if (r.grading_scale) summary = r.grading_scale.length + ' grades';
    else if (r.sections) summary = r.sections.length + ' sections';
    else if (r.courses) summary = r.courses.length + ' courses';
    else if (r.instructors) summary = r.instructors.length + ' instructors';
    else if (r.schedule) summary = r.schedule.length + ' slots';
    else if (r.rooms) summary = r.rooms.length + ' rooms';
    else if (r.departments) summary = r.departments.length + ' depts';
    else if (r.feedback) summary = r.feedback.total_comments + ' comments';
    else if (r.honors) summary = Object.keys(r.honors).length + ' honors';
    else if (r.latin_honors) summary = r.latin_honors.length + ' latin';
    else if (r.qualifies_for) summary = 'QPI check: ' + r.qualifies_for;
    else if (r.results) summary = r.results.length + ' rules';
    else if (r.offenses) summary = r.offenses.length + ' offenses';
    
    console.log((ok ? '✅' : '❌') + ' ' + name + ' → ' + summary);
  } catch (e: any) {
    failed++;
    console.log('❌ ' + name + ' → EXCEPTION: ' + e.message);
  }
}

console.log('\n=== RESULTS ===');
console.log('✅ Passed: ' + passed + '/' + tests.length);
console.log('❌ Failed: ' + failed + '/' + tests.length);
