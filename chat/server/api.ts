/**
 * SISIA Chat API
 * 
 * Clean architecture using MCP tools and models.
 * All database queries are in models/, all Gemini tools in mcp/tools/.
 * 
 * Features:
 * - Public course/schedule queries
 * - User authentication via Supabase
 * - Encrypted AISIS credential storage
 * - Personal data scraping (schedule, IPS, grades, holds)
 * - Conversation history logging
 * 
 * BLOCKED: J_STUD_INFO.do - No personal information scraping.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Import MCP tools and models
import { handleFunctionCall } from './src/mcp/tools/index.js';
import { initModels } from './src/models/index.js';

// Import routes
import { authRouter } from './src/routes/auth.js';
import { aisisRouter } from './src/routes/aisis.js';
import { createChatRouter } from './src/routes/chat.js';
import { analyticsRouter } from './src/routes/analytics.js';
import { createHealthRouter } from './src/routes/health.js';

// Import services
import { queryCache } from './cache.js';
import { EmbeddingSearch } from './embedding.js';
import { wsServer } from './websocket.js';



const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Connect to SISIA database
const db = new Database(path.join(__dirname, '../../sisia.db'), { readonly: true });

// Initialize models with database connection
initModels(db);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Initialize embedding search
const embeddingSearch = new EmbeddingSearch(genAI, db);

// === MOUNT ROUTES ===

// Auth routes
app.use('/api/auth', authRouter);
app.use('/api/aisis', aisisRouter);

// Chat routes (public, personal, stream, history)
app.use('/api/chat', createChatRouter(genAI, db));

// Analytics routes
app.use('/api/analytics', analyticsRouter);
app.use('/api/usage', analyticsRouter);

// Health routes
const healthRouter = createHealthRouter(db, queryCache, embeddingSearch, wsServer);
app.use('/api/health', healthRouter);
app.use('/api/cache', healthRouter);
app.use('/api/ws', healthRouter);

// Semantic search endpoint
app.post('/api/semantic-search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = await embeddingSearch.searchCourses(query, limit);
    res.json({ 
      query, 
      results,
      total: results.length,
      stats: embeddingSearch.getStats(),
    });
  } catch (error: unknown) {
    console.error('Semantic search error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

const PORT = process.env.PORT || 6102;

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
wsServer.attach(server);

// === PRE-WARMING ===
async function prewarmCache() {
  console.log('🔥 Pre-warming cache with common queries...');
  
  // Pre-warm popular course searches
  const commonQueries = ['CSCI', 'MATH', 'ENGL', 'PHILO', 'THEO'];
  for (const query of commonQueries) {
    try {
      await handleFunctionCall('search_courses', { query, term: '2025-2', limit: 10 });
    } catch {
      // Ignore errors during pre-warming
    }
  }
  
  console.log('✅ Cache pre-warmed');
}

// Initialize embedding search in background
embeddingSearch.initializeEmbeddings(300).catch(err => {
  console.error('Failed to initialize embeddings:', err);
});

// Pre-warm cache after startup
setTimeout(prewarmCache, 3000);

// Import tool definitions for startup logging
import { publicDefinitions, personalDefinitions } from './src/mcp/tools/index.js';
import { AI_CONFIG } from './src/routes/chat.js';

server.listen(PORT, () => {
  console.log(`🤖 SISIA Chat API running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`🔐 Auth endpoints: /api/auth/register, /api/auth/login`);
  console.log(`🛠️  Public tools: ${publicDefinitions.length}`);
  console.log(`🔒 Personal tools: ${personalDefinitions.length}`);
  console.log(`📝 Message logging: enabled`);
  console.log(`⚡ AI Config: temp=${AI_CONFIG.temperature}, topP=${AI_CONFIG.topP}`);
});
