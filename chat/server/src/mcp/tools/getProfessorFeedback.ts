/**
 * Get Professor Feedback Tool
 * 
 * Retrieves student feedback from the Facebook scraper database
 * with computed ratings based on comment keyword analysis.
 */

import { SchemaType } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { db as sisiaDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Scraper database path (relative to chat/server/src/mcp/tools)
const scraperDbPath = path.resolve(__dirname, '../../../../../sisia-scraper/data/scraper.db');

// Rating keywords derived from comment analysis (frequencies from 467 comments)
const RATING_KEYWORDS = {
  // A-ability: likelihood of getting an A
  a_able_positive: ['a-able', 'easy a', 'grades high', 'generous', 'curves', 'curve', 'lenient', 'high grades'],
  a_able_negative: ['strict', 'hard', 'difficult', 'terror', 'mahirap', 'low grades', 'failed'],
  
  // Teaching quality
  teaching_positive: ['goat', 'recommend', 'great teacher', 'explains well', 'learned a lot', 'interesting', 'engaging'],
  teaching_negative: ['boring', 'confusing', 'avoid', 'worst', 'terrible', 'bad teacher'],
  
  // Difficulty level
  difficulty_easy: ['easy', 'chill', 'light', 'manageable', 'relaxed', 'not hard'],
  difficulty_hard: ['hard', 'heavy', 'difficult', 'mahirap', 'challenging', 'demanding'],
  
  // Workload
  workload_heavy: ['heavy workload', 'many readings', 'lot of work', 'groupworks', 'many requirements', 'recitation'],
  workload_light: ['light', 'manageable workload', 'few requirements', 'chill workload'],
  
  // Personality/fairness
  personality_positive: ['nice', 'kind', 'fair', 'considerate', 'understanding', 'approachable'],
  personality_negative: ['unfair', 'mean', 'rude', 'strict', 'intimidating']
};

export const definition = {
  name: 'get_professor_feedback',
  description: 'Get student feedback and ratings for a professor from the Facebook scraper. Shows what students say about A-ability, teaching quality, difficulty, and workload. Use search_instructors first to verify the instructor name exists.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      professor_name: { 
        type: SchemaType.STRING, 
        description: 'Professor last name (e.g., "TANGARA", "SANTOS"). Use uppercase for best results.' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max comments to return (default: 5, max: 10)' 
      },
    },
    required: ['professor_name'],
  },
};

interface FeedbackRow {
  feedback_text: string;
  reactions: number;
  source_url: string;
  scraped_at: string;
}

interface InstructorRow {
  name: string;
  section_count: number;
}

function countKeywords(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  return keywords.filter(kw => lowerText.includes(kw.toLowerCase())).length;
}

function computeRatings(comments: string[]): {
  a_able: 'likely' | 'possible' | 'difficult' | 'unknown';
  teaching: 'positive' | 'mixed' | 'negative' | 'unknown';
  difficulty: 'easy' | 'moderate' | 'hard' | 'unknown';
  workload: 'light' | 'moderate' | 'heavy' | 'unknown';
  personality: 'positive' | 'mixed' | 'negative' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
} {
  if (comments.length === 0) {
    return {
      a_able: 'unknown',
      teaching: 'unknown',
      difficulty: 'unknown',
      workload: 'unknown',
      personality: 'unknown',
      confidence: 'low'
    };
  }

  const allText = comments.join(' ');
  
  // Count keyword matches
  const aPos = countKeywords(allText, RATING_KEYWORDS.a_able_positive);
  const aNeg = countKeywords(allText, RATING_KEYWORDS.a_able_negative);
  const tPos = countKeywords(allText, RATING_KEYWORDS.teaching_positive);
  const tNeg = countKeywords(allText, RATING_KEYWORDS.teaching_negative);
  const dEasy = countKeywords(allText, RATING_KEYWORDS.difficulty_easy);
  const dHard = countKeywords(allText, RATING_KEYWORDS.difficulty_hard);
  const wHeavy = countKeywords(allText, RATING_KEYWORDS.workload_heavy);
  const wLight = countKeywords(allText, RATING_KEYWORDS.workload_light);
  const pPos = countKeywords(allText, RATING_KEYWORDS.personality_positive);
  const pNeg = countKeywords(allText, RATING_KEYWORDS.personality_negative);

  // Determine confidence based on sample size
  const confidence = comments.length >= 10 ? 'high' : comments.length >= 5 ? 'medium' : 'low';

  // Compute ratings based on keyword balance
  const computeLabel = (pos: number, neg: number, labels: [string, string, string]) => {
    const total = pos + neg;
    if (total === 0) return labels[1]; // unknown/moderate
    const ratio = pos / total;
    if (ratio > 0.65) return labels[0]; // positive
    if (ratio < 0.35) return labels[2]; // negative
    return labels[1]; // mixed/moderate
  };

  return {
    a_able: computeLabel(aPos, aNeg, ['likely', 'possible', 'difficult']) as 'likely' | 'possible' | 'difficult',
    teaching: computeLabel(tPos, tNeg, ['positive', 'mixed', 'negative']) as 'positive' | 'mixed' | 'negative',
    difficulty: computeLabel(dEasy, dHard, ['easy', 'moderate', 'hard']) as 'easy' | 'moderate' | 'hard',
    workload: computeLabel(wLight, wHeavy, ['light', 'moderate', 'heavy']) as 'light' | 'moderate' | 'heavy',
    personality: computeLabel(pPos, pNeg, ['positive', 'mixed', 'negative']) as 'positive' | 'mixed' | 'negative',
    confidence
  };
}

export function handler(args: { professor_name: string; limit?: number }) {
  const limit = Math.min(args.limit || 5, 10);
  const profName = args.professor_name.toUpperCase();

  // Check if scraper database exists
  let scraperDb: Database.Database;
  try {
    scraperDb = new Database(scraperDbPath, { readonly: true });
  } catch {
    return {
      error: 'Scraper database not found. No feedback data available.',
      instructor: { name: profName, exists_in_sisia: false, currently_teaching: false },
      feedback: { total_comments: 0, comments: [], sufficient_data: false },
      ratings: null
    };
  }

  // Check if instructor exists in SISIA database
  const instructorCheck = sisiaDb.prepare(`
    SELECT i.name, COUNT(DISTINCT cs.id) as section_count
    FROM instructor i
    LEFT JOIN class_section cs ON cs.instructor_id = i.id
    WHERE UPPER(i.name) LIKE ?
    GROUP BY i.id
    LIMIT 1
  `).get(`%${profName}%`) as InstructorRow | undefined;

  const existsInSisia = !!instructorCheck;
  const currentlyTeaching = (instructorCheck?.section_count || 0) > 0;

  // Get feedback from scraper database
  const feedbackRows = scraperDb.prepare(`
    SELECT 
      feedback_text,
      reactions,
      source_url,
      scraped_at
    FROM professor_feedback
    WHERE UPPER(instructor_name_scraped) LIKE ?
    ORDER BY reactions DESC, scraped_at DESC
  `).all(`%${profName}%`) as FeedbackRow[];

  scraperDb.close();

  const totalComments = feedbackRows.length;
  const sufficientData = totalComments >= 3;

  // Get all comments for rating computation, but limit returned samples
  const allCommentTexts = feedbackRows.map(r => r.feedback_text);
  const sampleComments = feedbackRows.slice(0, limit).map(r => ({
    text: r.feedback_text.length > 300 ? r.feedback_text.slice(0, 300) + '...' : r.feedback_text,
    reactions: r.reactions,
    source: r.source_url
  }));

  // Compute ratings from ALL comments
  const ratings = computeRatings(allCommentTexts);

  return {
    instructor: {
      name: instructorCheck?.name || profName,
      exists_in_sisia: existsInSisia,
      currently_teaching: currentlyTeaching,
      sections_this_term: instructorCheck?.section_count || 0
    },
    feedback: {
      total_comments: totalComments,
      sufficient_data: sufficientData,
      comments: sampleComments
    },
    ratings: sufficientData ? {
      a_able: ratings.a_able,
      teaching_quality: ratings.teaching,
      difficulty: ratings.difficulty,
      workload: ratings.workload,
      personality: ratings.personality,
      sample_size: totalComments,
      confidence: ratings.confidence,
      _note: 'Ratings computed from student comment keywords. Use with discretion.'
    } : null,
    _format_hint: totalComments > 0 
      ? `Found ${totalComments} student comments about ${profName}. Summarize the feedback and ratings in a helpful way.`
      : `No feedback found for "${profName}". Suggest the user check the spelling or try a different name.`
  };
}
