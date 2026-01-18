/**
 * Embedding-based semantic search for SISIA
 * Uses Gemini embeddings for semantic similarity matching
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Database from 'better-sqlite3';
import { embeddingCache, createCacheKey } from './cache.js';

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class EmbeddingSearch {
  private genAI: GoogleGenerativeAI;
  private db: Database.Database;
  private courseEmbeddings: Map<string, { embedding: number[]; course_code: string; title: string }>;
  private initialized = false;

  constructor(genAI: GoogleGenerativeAI, db: Database.Database) {
    this.genAI = genAI;
    this.db = db;
    this.courseEmbeddings = new Map();
  }

  // Generate embedding for a text
  async getEmbedding(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = createCacheKey('embedding', { text });
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;

    try {
      const model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;
      
      // Cache the result
      embeddingCache.set(cacheKey, embedding, 3600); // 1 hour TTL
      return embedding;
    } catch {
      // Silently fail - embedding is optional, chatbot still works without it
      return [];
    }
  }

  // Initialize course embeddings (run once at startup or periodically)
  async initializeEmbeddings(limit = 500): Promise<void> {
    if (this.initialized) return;

    console.log('📊 Initializing course embeddings...');
    
    const courses = this.db.prepare(`
      SELECT course_code, title FROM course 
      WHERE title IS NOT NULL AND title != ''
      LIMIT ?
    `).all(limit) as Array<{ course_code: string; title: string }>;

    // Test one embedding first to check if API is working
    const testEmbedding = await this.getEmbedding('test');
    if (testEmbedding.length === 0) {
      console.log('⚠️ Embedding API unavailable - skipping initialization (chatbot still works)');
      this.initialized = true;
      return;
    }

    // Batch embed for efficiency
    const batchSize = 50;
    for (let i = 0; i < courses.length; i += batchSize) {
      const batch = courses.slice(i, i + batchSize);
      
      for (const course of batch) {
        const text = `${course.course_code} ${course.title}`;
        const embedding = await this.getEmbedding(text);
        if (embedding.length > 0) {
          this.courseEmbeddings.set(course.course_code, {
            embedding,
            course_code: course.course_code,
            title: course.title,
          });
        }
      }
      
      console.log(`  Embedded ${Math.min(i + batchSize, courses.length)}/${courses.length} courses`);
    }

    this.initialized = true;
    console.log(`✅ Initialized ${this.courseEmbeddings.size} course embeddings`);
  }

  // Semantic search for courses
  async searchCourses(query: string, limit = 10): Promise<Array<{ course_code: string; title: string; score: number }>> {
    // Get query embedding
    const queryEmbedding = await this.getEmbedding(query);
    if (queryEmbedding.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const results: Array<{ course_code: string; title: string; score: number }> = [];
    
    for (const [, data] of this.courseEmbeddings) {
      const score = cosineSimilarity(queryEmbedding, data.embedding);
      results.push({
        course_code: data.course_code,
        title: data.title,
        score: Math.round(score * 100) / 100,
      });
    }

    // Sort by score descending and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(r => r.score > 0.3); // Only return reasonably similar results
  }

  // Get embedding stats
  getStats(): { initialized: boolean; courseCount: number } {
    return {
      initialized: this.initialized,
      courseCount: this.courseEmbeddings.size,
    };
  }
}
