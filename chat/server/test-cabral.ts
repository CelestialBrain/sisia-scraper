import { handler } from './src/mcp/tools/getProfessorFeedback.ts';
import fs from 'fs';

try {
  console.error('Starting test...');
  const r = handler({ professor_name: 'CABRAL' });
  console.error('Got result');
  
  fs.writeFileSync('./cabral-test.json', JSON.stringify(r, null, 2));
  console.error('Wrote to file');
  
  console.log('Overall:', r.rating?.overall);
  console.log('A-able:', r.rating?.a_able?.score, r.rating?.a_able?.label);
  console.log('Teaching:', r.rating?.teaching?.score, r.rating?.teaching?.label);
  console.log('Recommendation:', r.recommendation?.take ? 'TAKE' : 'AVOID');
  console.log('Would retake:', r.would_retake?.verdict);
} catch(e) {
  console.error('Error:', e);
}
