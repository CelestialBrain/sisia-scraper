
// Removed import node-fetch, using global fetch
const API_URL = 'http://localhost:6102/api/chat';

async function runQuery() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Please provide a prompt argument.');
    process.exit(1);
  }

  console.log(`\n🤖 Sending Query: "${prompt}"\n`);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, history: [] }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    console.log(`📝 Response:\n${data.response}`);
    console.log(`\n🔹 Session ID: ${data.sessionId}`);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

runQuery();
