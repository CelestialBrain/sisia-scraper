
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:6102/api/chat';

interface TestPrompt {
  id: number;
  level: number;
  category: string;
  prompt: string;
  expectedTool?: string;
  description: string;
}

interface TestResult {
  promptId: number;
  prompt: string;
  response: string;
  sessionId: string;
  // Note: We can't see the tool calls directly from the API response based on api.ts
  // unless we parse the logs or if the API returns them. 
  // api.ts returns { response: text, sessionId }.
  // However, for the purpose of this test, we are mostly interested in the final answer
  // and if it "looks" correct or errors out.
  // Ideally, we'd want tool usage info, but without modifying the API to return it in the body,
  // we will rely on the text response quality.
}

const prompts: TestPrompt[] = [
  // Level 1: Basic Information Retrieval
  { id: 1, level: 1, category: 'Basic', prompt: "Who teaches CS 11?", expectedTool: 'get_course_sections', description: "Simple instructor lookup via course" },
  { id: 2, level: 1, category: 'Basic', prompt: "Search for courses about 'Ethics'.", expectedTool: 'search_courses', description: "Keyword search" },
  { id: 3, level: 1, category: 'Basic', prompt: "Find instructor 'Nable'.", expectedTool: 'search_instructors', description: "Instructor search" },
  { id: 4, level: 1, category: 'Basic', prompt: "What is the schedule for room CTC 102?", expectedTool: 'get_room_schedule', description: "Room schedule" },
  { id: 5, level: 1, category: 'Basic', prompt: "Show me the curriculum for BS Computer Science.", expectedTool: 'get_curriculum', description: "Curriculum lookup" },
  { id: 6, level: 1, category: 'Basic', prompt: "List all programs in the School of Science and Engineering.", expectedTool: 'list_programs', description: "Program list" },

  // Level 2: Parameterized & Specific Queries
  { id: 7, level: 2, category: 'Specific', prompt: "Show me only the lecture sections for CHEM 10.", expectedTool: 'get_course_sections', description: "Filtering sections" },
  { id: 8, level: 2, category: 'Specific', prompt: "Are there any Math classes on Saturdays?", expectedTool: 'search_by_natural_time', description: "Time-based filtering" },
  { id: 9, level: 2, category: 'Specific', prompt: "What are the prerequisites for CS 12?", expectedTool: 'get_prerequisites', description: "Prerequisites" },
  { id: 10, level: 2, category: 'Specific', prompt: "Find me a pattern analysis course.", expectedTool: 'search_courses', description: "Topic search" },
  { id: 11, level: 2, category: 'Specific', prompt: "When does instructor 'Ang' have classes?", expectedTool: 'get_instructor_schedule', description: "Instructor availability" },

  // Level 3: Multi-Step & Relational
  { id: 12, level: 3, category: 'Multi-step', prompt: "Does instructor 'Guidote' teach any chemistry classes?", expectedTool: 'complex', description: "Instructor + Course Subject" },
  { id: 13, level: 3, category: 'Multi-step', prompt: "Compare the schedules of CS 11 section A and section B.", expectedTool: 'compare_sections', description: "Section comparison" },
  { id: 14, level: 3, category: 'Multi-step', prompt: "Is room F-223 available on Monday at 9:00 AM?", expectedTool: 'get_room_schedule', description: "Room specific availability" },
  { id: 15, level: 3, category: 'Multi-step', prompt: "Can I take CS 21 if I haven't taken CS 11?", expectedTool: 'get_prerequisites', description: "Prereq logic" },
  { id: 16, level: 3, category: 'Multi-step', prompt: "Find a theology class that fits in a MWF 9-10 slot.", expectedTool: 'search_by_natural_time', description: "Complex time search" },

  // Level 4: Complex / Agentic Scenarios
  { id: 17, level: 4, category: 'Agentic', prompt: "Build me a schedule for a first year CS student that includes CS 11, Math 10, and En11, avoiding 7 AM classes.", expectedTool: 'build_schedule', description: "Schedule builder" },
  { id: 18, level: 4, category: 'Agentic', prompt: "I need to find a class to replace my 10 AM slot. What are my options in the Core Curriculum?", expectedTool: 'complex', description: "Contextual replacement" },
  { id: 19, level: 4, category: 'Agentic', prompt: "Explain the difference between the 'BS CS' and 'BS MIS' curriculums.", expectedTool: 'get_curriculum', description: "Curriculum comparison" },
  { id: 20, level: 4, category: 'Agentic', prompt: "Check if there are any conflicts between CS 11 Sec A and Math 11 Sec B.", expectedTool: 'compare_sections', description: "Conflict check" },
];

async function runTests() {
  console.log(`🚀 Starting execution of ${prompts.length} test prompts...`);
  const results: TestResult[] = [];
  
  for (const p of prompts) {
    console.log(`\n---------------------------------------------------------`);
    console.log(`[${p.id}/${prompts.length}] Level ${p.level} - ${p.category}: "${p.prompt}"`);
    console.log(`   Expecting tool intent: ${p.expectedTool}`);
    
    try {
      const startTime = Date.now();
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: p.prompt,
          history: [] // Stateless for this test, unless we want to chain
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      const duration = Date.now() - startTime;
      
      console.log(`   ✅ Success (${duration}ms):`);
      console.log(`   Response: ${data.response.substring(0, 150)}${data.response.length > 150 ? '...' : ''}`);
      
      results.push({
        promptId: p.id,
        prompt: p.prompt,
        response: data.response,
        sessionId: data.sessionId
      });
      
    } catch (error) {
      console.error(`   ❌ Failed:`, error);
      results.push({
        promptId: p.id,
        prompt: p.prompt,
        response: `ERROR: ${error}`,
        sessionId: ''
      });
    }
    
    // Small delay to be nice to the local server
    await new Promise(r => setTimeout(r, 500));
  }

  const outputPath = path.join(process.cwd(), 'test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n🎉 All tests completed. Results saved to ${outputPath}`);
}

runTests().catch(console.error);
