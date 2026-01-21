/**
 * Health Routes
 * 
 * Handles health check and stats endpoints.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { publicDefinitions, personalDefinitions } from '../mcp/tools/index.js';
import { AI_CONFIG } from './chat.js';

export function createHealthRouter(
  db: Database.Database,
  queryCache: { stats: () => unknown },
  embeddingSearch: { getStats: () => unknown },
  wsServer: { getStats: () => unknown }
) {
  const router = Router();

  // Health check
  router.get('/', (_req: Request, res: Response) => {
    const stats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM class_section) as sections,
        (SELECT COUNT(*) FROM course) as courses,
        (SELECT COUNT(*) FROM instructor) as instructors
    `).get();
    
    res.json({ 
      status: 'ok', 
      database: stats,
      tools: {
        public: publicDefinitions.map(d => d.name),
        personal: personalDefinitions.map(d => d.name),
      },
      cache: queryCache.stats(),
      embeddings: embeddingSearch.getStats(),
      websocket: wsServer.getStats(),
      ai_config: {
        model: AI_CONFIG.model,
        temperature: AI_CONFIG.temperature,
      },
    });
  });

  // Cache stats endpoint
  router.get('/cache/stats', (_req: Request, res: Response) => {
    res.json(queryCache.stats());
  });

  // WebSocket stats endpoint
  router.get('/ws/stats', (_req: Request, res: Response) => {
    res.json(wsServer.getStats());
  });

  return router;
}
