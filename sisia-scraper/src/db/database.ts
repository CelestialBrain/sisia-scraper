/**
 * Database connection and initialization for SISIA Scraper
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

export function initDatabase(dbPath: string = "./data/scraper.db"): Database.Database {
  db = new Database(dbPath);
  
  // Enable foreign keys
  db.pragma("foreign_keys = ON");
  
  // Run schema
  const schemaPath = join(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  }
  
  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

// ============================================
// Scrape Sessions
// ============================================

export function startSession(mode: "semi-manual" | "full-auto" | "direct-url"): number {
  const stmt = db.prepare(`
    INSERT INTO scrape_sessions (mode, status)
    VALUES (?, 'running')
  `);
  const result = stmt.run(mode);
  return result.lastInsertRowid as number;
}

export function endSession(sessionId: number, status: "completed" | "aborted" = "completed"): void {
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM posts WHERE capture_id IN (SELECT id FROM raw_captures WHERE session_id = ?)) as posts,
      (SELECT COUNT(*) FROM professor_feedback WHERE post_id IN (SELECT id FROM posts WHERE capture_id IN (SELECT id FROM raw_captures WHERE session_id = ?))) as feedback
  `).get(sessionId, sessionId) as { posts: number; feedback: number };
  
  db.prepare(`
    UPDATE scrape_sessions 
    SET ended_at = CURRENT_TIMESTAMP,
        status = ?,
        posts_captured = ?,
        comments_captured = ?
    WHERE id = ?
  `).run(status, stats?.posts || 0, stats?.feedback || 0, sessionId);
}

// ============================================
// Raw Captures
// ============================================

export function saveRawCapture(sessionId: number, url: string, html: string, searchTerm?: string): number {
  const stmt = db.prepare(`
    INSERT INTO raw_captures (session_id, url, html_content, search_term)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(sessionId, url, html, searchTerm || null);
  return result.lastInsertRowid as number;
}

export function getUnprocessedCaptures(): Array<{ id: number; url: string; html_content: string }> {
  return db.prepare(`
    SELECT id, url, html_content 
    FROM raw_captures 
    WHERE processed = FALSE
  `).all() as Array<{ id: number; url: string; html_content: string }>;
}

export function markCaptureProcessed(captureId: number): void {
  db.prepare(`UPDATE raw_captures SET processed = TRUE WHERE id = ?`).run(captureId);
}

// ============================================
// Extraction Logging
// ============================================

export function logExtraction(data: {
  sessionId: number;
  url: string;
  searchTerm?: string;
  postsExtracted: number;
  commentsExtracted: number;
  feedbackSaved: number;
}): number {
  const stmt = db.prepare(`
    INSERT INTO extraction_log (session_id, url, search_term, posts_extracted, comments_extracted, feedback_saved)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.sessionId,
    data.url,
    data.searchTerm || null,
    data.postsExtracted,
    data.commentsExtracted,
    data.feedbackSaved
  );
  return result.lastInsertRowid as number;
}

// ============================================
// DOM-Extracted Feedback (bypasses HTML parsing)
// ============================================

export function saveDOMFeedback(data: {
  sessionId: number;
  url: string;
  searchTerm?: string;
  instructorId?: number;
  instructorNameMatched?: string;
  feedbackText: string;
  feedbackType: "post" | "comment";
  sentiment?: string;
  reactions?: number;
  reactionTypes?: string[];
  postReactions?: number;
  postReactionTypes?: string[];
  isReply?: boolean;
}): number {
  // Generate hash for deduplication (professor + text first 100 chars)
  const hashInput = `${data.searchTerm || 'unknown'}:${data.feedbackText.substring(0, 100)}`;
  const commentHash = Buffer.from(hashInput).toString('base64').substring(0, 32);
  
  // Check if this exact comment already exists
  const existingStmt = db.prepare(`SELECT id FROM professor_feedback WHERE comment_hash = ?`);
  const existing = existingStmt.get(commentHash);
  if (existing) {
    return 0; // Skip duplicate
  }

  // First create a minimal post entry
  const postStmt = db.prepare(`
    INSERT INTO posts (capture_id, post_url, author_type, content)
    VALUES (NULL, ?, 'anonymous', ?)
  `);
  const postResult = postStmt.run(data.url, data.feedbackText.substring(0, 200) + '...');
  const postId = postResult.lastInsertRowid as number;

  // Then save the feedback with new columns
  const feedbackStmt = db.prepare(`
    INSERT INTO professor_feedback 
    (post_id, instructor_id, instructor_name_scraped, instructor_name_matched, feedback_text, 
     feedback_type, sentiment, reactions, reaction_types, post_reactions, post_reaction_types,
     source_url, is_reply, comment_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Convert reaction types arrays to JSON strings
  const reactionTypesJson = data.reactionTypes && data.reactionTypes.length > 0 
    ? JSON.stringify(data.reactionTypes) 
    : null;
  const postReactionTypesJson = data.postReactionTypes && data.postReactionTypes.length > 0
    ? JSON.stringify(data.postReactionTypes)
    : null;
  
  const result = feedbackStmt.run(
    postId,
    data.instructorId || null,
    data.searchTerm || 'unknown',
    data.instructorNameMatched || null,
    data.feedbackText,
    data.feedbackType,
    data.sentiment || null,
    data.reactions || 0,
    reactionTypesJson,
    data.postReactions || 0,
    postReactionTypesJson,
    data.url,
    data.isReply ? 1 : 0,
    commentHash
  );
  return result.lastInsertRowid as number;
}

export function bulkSaveDOMFeedback(
  sessionId: number,
  url: string,
  searchTerm: string,
  comments: Array<{ text: string; reactions: number; reactionTypes: string[]; isReply: boolean }>,
  instructorId?: number,
  instructorName?: string,
  postReactions?: number,
  postReactionTypes?: string[]
): number {
  let savedCount = 0;
  
  for (const comment of comments) {
    if (comment.text.length < 10) continue; // Skip very short comments
    
    const result = saveDOMFeedback({
      sessionId,
      url,
      searchTerm,
      instructorId,
      instructorNameMatched: instructorName,
      feedbackText: comment.text,
      feedbackType: comment.isReply ? "comment" : "post",
      reactions: comment.reactions,
      reactionTypes: comment.reactionTypes,
      postReactions,
      postReactionTypes,
      isReply: comment.isReply,
    });
    
    // Only count if actually saved (not a duplicate)
    if (result > 0) {
      savedCount++;
    }
  }
  
  return savedCount;
}

// ============================================
// Posts
// ============================================

export function savePost(data: {
  captureId: number;
  fbPostId?: string;
  postUrl?: string;
  authorType: "anonymous" | "named";
  content: string;
  postDate?: string;
  normalizedDate?: string;
}): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO posts (capture_id, fb_post_id, post_url, author_type, content, post_date, normalized_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.captureId,
    data.fbPostId || null,
    data.postUrl || null,
    data.authorType,
    data.content,
    data.postDate || null,
    data.normalizedDate || null
  );
  return result.lastInsertRowid as number;
}

// ============================================
// Professor Feedback
// ============================================

export function saveFeedback(data: {
  postId: number;
  instructorId?: number;
  instructorNameScraped: string;
  instructorNameMatched?: string;
  matchConfidence?: number;
  feedbackText: string;
  feedbackType: "post" | "comment";
  sentiment?: string;
}): number {
  const stmt = db.prepare(`
    INSERT INTO professor_feedback 
    (post_id, instructor_id, instructor_name_scraped, instructor_name_matched, match_confidence, feedback_text, feedback_type, sentiment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.postId,
    data.instructorId || null,
    data.instructorNameScraped,
    data.instructorNameMatched || null,
    data.matchConfidence || null,
    data.feedbackText,
    data.feedbackType,
    data.sentiment || null
  );
  return result.lastInsertRowid as number;
}

export function getFeedbackByProfessor(instructorId: number): Array<{
  feedback_text: string;
  feedback_type: string;
  sentiment: string;
  scraped_at: string;
}> {
  return db.prepare(`
    SELECT feedback_text, feedback_type, sentiment, scraped_at
    FROM professor_feedback
    WHERE instructor_id = ?
    ORDER BY scraped_at DESC
  `).all(instructorId) as Array<{
    feedback_text: string;
    feedback_type: string;
    sentiment: string;
    scraped_at: string;
  }>;
}

// ============================================
// Target Professors
// ============================================

export function addTargetProfessor(data: {
  instructorId: number;
  name: string;
  searchTerms?: string[];
  priority?: number;
}): void {
  const normalized = data.name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO target_professors (instructor_id, name, name_normalized, search_terms, priority)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.instructorId,
    data.name,
    normalized,
    JSON.stringify(data.searchTerms || []),
    data.priority || 0
  );
}

export function getTargetProfessors(limit: number = 20): Array<{
  id: number;
  instructor_id: number;
  name: string;
  name_normalized: string;
  search_terms: string;
  last_searched_at: string | null;
}> {
  return db.prepare(`
    SELECT id, instructor_id, name, name_normalized, search_terms, last_searched_at
    FROM target_professors
    WHERE active = TRUE
    ORDER BY priority DESC, last_searched_at ASC NULLS FIRST
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    instructor_id: number;
    name: string;
    name_normalized: string;
    search_terms: string;
    last_searched_at: string | null;
  }>;
}

export function markProfessorSearched(id: number, postsFound: number): void {
  db.prepare(`
    UPDATE target_professors 
    SET last_searched_at = CURRENT_TIMESTAMP, posts_found = posts_found + ?
    WHERE id = ?
  `).run(postsFound, id);
}
