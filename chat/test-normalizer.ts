/**
 * Test course code normalizer
 */

import { normalizeCourseCode, extractTermFromCode } from './server/src/utils/normalizer.js';

const testCases = [
  // From J_VCEC (with term suffix)
  'LLAW 11312018',
  'MATH 31.212018',
  'ENGL 1112018',
  'DECSC 2212018',
  
  // From database (clean)
  'LLAW 113',
  'MATH 31.2',
  'ENGL 11',
  'DECSC 22',
  
  // With variants
  'ECON 185.65i',
  'LLAW 113.03',
  
  // Edge cases
  'PEPC 11.03',
  'math 31',  // lowercase
  'SocSc 134i',
  'ANTH/SOCIO 141.2',  // joint course
];

console.log('Course Code Normalization Tests:');
console.log('='.repeat(60));
for (const tc of testCases) {
  const normalized = normalizeCourseCode(tc);
  const term = extractTermFromCode(tc);
  console.log(`${tc.padEnd(22)} → ${normalized.padEnd(18)} term: ${term || 'N/A'}`);
}
