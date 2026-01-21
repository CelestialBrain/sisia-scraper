/**
 * AI Chatbot Prompt Tester
 * Tests various edge cases and user queries
 */

const API_BASE = 'http://localhost:6102';

interface TestCase {
  name: string;
  prompt: string;
  expectedBehavior: string;
}

const testCases: TestCase[] = [
  // Curriculum queries
  { 
    name: 'BS ME curriculum', 
    prompt: 'What are the subjects for BS ME first year?',
    expectedBehavior: 'Should list Year 1 Sem 1 & 2 courses for BS Management Engineering'
  },
  { 
    name: 'Specific year/semester', 
    prompt: 'What subjects do I take in third year second semester of BS CS?',
    expectedBehavior: 'Should list Y3S2 courses for BS Computer Science'
  },
  { 
    name: 'Informal degree name', 
    prompt: 'Show me the curriculum for maneng',
    expectedBehavior: 'Should recognize "maneng" as BS Management Engineering alias'
  },
  { 
    name: 'Prerequisites query', 
    prompt: 'What are the prerequisites for MATH 31.3?',
    expectedBehavior: 'Should show MATH 31.1 and MATH 31.2 as prerequisites'
  },
  
  // Course search queries
  { 
    name: 'Course search by code', 
    prompt: 'Tell me about ENLIT 12',
    expectedBehavior: 'Should show course details, sections, schedule'
  },
  { 
    name: 'Course by keyword', 
    prompt: 'What courses are about ethics?',
    expectedBehavior: 'Should find PHILO 13 Ethics and related courses'
  },
  
  // Instructor queries
  { 
    name: 'Instructor search', 
    prompt: 'Who teaches DECSC 25?',
    expectedBehavior: 'Should list instructors teaching DECSC 25'
  },
  { 
    name: 'Fuzzy instructor name', 
    prompt: 'What does Prof Santos teach?',
    expectedBehavior: 'Should use fuzzy matching to find instructors named Santos'
  },
  
  // Schedule queries
  { 
    name: 'Natural time query', 
    prompt: 'What classes are available on MWF mornings?',
    expectedBehavior: 'Should filter by MWF schedule and morning time slots'
  },
  { 
    name: 'Room schedule', 
    prompt: 'What classes are in SEC A 211?',
    expectedBehavior: 'Should show schedule for SEC A 211'
  },
  
  // Edge cases
  { 
    name: 'Misspelled course', 
    prompt: 'What is filosophy 11?',
    expectedBehavior: 'Should fuzzy match to PHILO 11'
  },
  { 
    name: 'Vague query', 
    prompt: 'I need a GE',
    expectedBehavior: 'Should ask for clarification or suggest GE courses'
  },
  { 
    name: 'Comparison query', 
    prompt: 'Compare sections of ENGL 11',
    expectedBehavior: 'Should show multiple sections with schedules and instructors'
  },
  { 
    name: 'Current date awareness', 
    prompt: 'What semester is it now?',
    expectedBehavior: 'Should know current date and infer semester'
  },
];

async function testPrompt(testCase: TestCase): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testCase.name}`);
  console.log(`PROMPT: "${testCase.prompt}"`);
  console.log(`EXPECTED: ${testCase.expectedBehavior}`);
  console.log('-'.repeat(60));
  
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: testCase.prompt,
        sessionId: `test-${Date.now()}`
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const reply = data.reply || data.message || JSON.stringify(data);
    
    // Truncate long responses
    const displayReply = reply.length > 500 
      ? reply.substring(0, 500) + '... [truncated]' 
      : reply;
    
    console.log(`RESPONSE:\n${displayReply}`);
    console.log(`\n✅ Test completed`);
  } catch (error) {
    console.log(`❌ Error: ${error}`);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 AI Chatbot Prompt Tester\n');
  console.log(`Testing against: ${API_BASE}`);
  console.log(`Total test cases: ${testCases.length}`);
  
  // Check if server is running
  try {
    const health = await fetch(`${API_BASE}/api/health`);
    if (!health.ok) throw new Error('Server not responding');
    console.log('✅ Server is running\n');
  } catch {
    console.error('❌ Server not running! Start with: cd chat/server && npm run dev');
    return;
  }
  
  // Run subset of tests for quick validation
  const quickTests = [0, 1, 2, 4, 6, 10, 13]; // Key test indices
  
  for (const idx of quickTests) {
    if (testCases[idx]) {
      await testPrompt(testCases[idx]);
      // Small delay between tests
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏁 Testing complete!');
  console.log(`Ran ${quickTests.length} of ${testCases.length} tests`);
  console.log('Run all tests with: npx tsx chat/test-prompts.ts --all');
}

// Run if called directly
if (process.argv.includes('--all')) {
  (async () => {
    for (const tc of testCases) {
      await testPrompt(tc);
      await new Promise(r => setTimeout(r, 1000));
    }
  })();
} else {
  runTests();
}
