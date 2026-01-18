/**
 * Get Professor Feedback Tool
 * 
 * Retrieves student feedback from the Facebook scraper database
 * with computed ratings based on comment keyword analysis.
 * Includes evidence quotes with links to back up each rating.
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
  a_able_positive: ['a-able', 'easy a', 'grades high', 'generous', 'curves', 'curve', 'lenient', 'high grades', 'gave me an a'],
  a_able_negative: ['strict', 'terror', 'low grades', 'failed', 'f/d', 'will fail'],
  
  // Teaching quality
  teaching_positive: ['goat', 'goated', 'recommend', 'great teacher', 'explains well', 'learned a lot', 'interesting', 'engaging', 'super good', 'blessing'],
  teaching_negative: ['boring', 'confusing', 'avoid', 'worst', 'terrible', 'bad teacher', 'run away', 'run'],
  
  // Difficulty level
  difficulty_easy: ['easy', 'chill', 'light', 'manageable', 'relaxed', 'not hard', 'ez'],
  difficulty_hard: ['hard', 'heavy', 'difficult', 'mahirap', 'challenging', 'demanding', 'tough'],
  
  // Workload
  workload_heavy: ['heavy workload', 'many readings', 'lot of work', 'groupworks', 'many requirements', 'recitation', 'readings'],
  workload_light: ['light', 'manageable workload', 'few requirements', 'chill workload', 'no homework'],
  
  // Personality/fairness
  personality_positive: ['nice', 'kind', 'fair', 'considerate', 'understanding', 'approachable', 'mother', 'caring'],
  personality_negative: ['unfair', 'mean', 'rude', 'intimidating', 'scary'],
  
  // Assessment types mentioned
  assessments: ['quiz', 'quizzes', 'oral', 'oral exam', 'paper', 'papers', 'groupwork', 'group work', 'project', 'projects', 'readings', 'recitation', 'exam', 'exams', 'homework', 'presentation'],
  
  // Deadline/late submission policy
  late_strict: ['strict deadline', 'no late', 'zero late', 'deduction', 'points off', 'strict sa deadline'],
  late_lenient: ['extension', 'flexible', 'accepts late', 'understanding', 'lenient deadline', 'deadline extensions'],
  
  // Red flags - warning signs
  red_flags: ['racist', 'sexist', 'rude', 'mean', 'unfair', 'favorites', 'playing favorites', 'biased', 'terror', 'wag', 'run', 'run away', 'avoid', 'worst prof', 'crammer', 'no consultation'],
  
  // Tips keywords (to find advice comments)
  tips: ['tip', 'tips', 'advice', 'recommend', 'suggestion', 'make sure', 'dont', "don't", 'you should', 'just follow', 'rubric']
};

export const definition = {
  name: 'get_professor_feedback',
  description: 'Get student feedback and ratings for a professor from the Facebook scraper. Shows what students say about A-ability, teaching quality, difficulty, and workload. INCLUDES EVIDENCE QUOTES WITH POST LINKS to back up each rating.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      professor_name: { 
        type: SchemaType.STRING, 
        description: 'Professor last name (e.g., "TANGARA", "SANTOS"). Use uppercase for best results.' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max sample comments to return (default: 5, max: 10)' 
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

interface Evidence {
  quote: string;
  link: string;
  reactions: number;
}

function findKeywordMatch(text: string, keywords: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

function extractEvidence(feedbackRows: FeedbackRow[], keywords: string[], maxEvidence: number = 2): Evidence[] {
  const evidence: Evidence[] = [];
  
  for (const row of feedbackRows) {
    if (evidence.length >= maxEvidence) break;
    
    const matchedKeyword = findKeywordMatch(row.feedback_text, keywords);
    if (matchedKeyword) {
      // Extract a snippet around the keyword (max 150 chars)
      const lowerText = row.feedback_text.toLowerCase();
      const keywordIndex = lowerText.indexOf(matchedKeyword.toLowerCase());
      const start = Math.max(0, keywordIndex - 40);
      const end = Math.min(row.feedback_text.length, keywordIndex + matchedKeyword.length + 80);
      let snippet = row.feedback_text.slice(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < row.feedback_text.length) snippet = snippet + '...';
      
      evidence.push({
        quote: snippet.trim(),
        link: row.source_url,
        reactions: row.reactions
      });
    }
  }
  
  return evidence;
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

  // Get all comments for rating computation
  const allCommentTexts = feedbackRows.map(r => r.feedback_text);
  
  // Sample comments with links
  const sampleComments = feedbackRows.slice(0, limit).map(r => ({
    text: r.feedback_text.length > 200 ? r.feedback_text.slice(0, 200) + '...' : r.feedback_text,
    reactions: r.reactions,
    post_link: r.source_url
  }));

  // Compute ratings from ALL comments
  const ratings = computeRatings(allCommentTexts);

  // Extract EVIDENCE for each rating category
  const evidence = {
    a_able: ratings.a_able !== 'unknown' ? extractEvidence(
      feedbackRows, 
      ratings.a_able === 'likely' ? RATING_KEYWORDS.a_able_positive : RATING_KEYWORDS.a_able_negative
    ) : [],
    teaching: ratings.teaching !== 'unknown' ? extractEvidence(
      feedbackRows,
      ratings.teaching === 'positive' ? RATING_KEYWORDS.teaching_positive : RATING_KEYWORDS.teaching_negative
    ) : [],
    difficulty: ratings.difficulty !== 'unknown' ? extractEvidence(
      feedbackRows,
      ratings.difficulty === 'easy' ? RATING_KEYWORDS.difficulty_easy : RATING_KEYWORDS.difficulty_hard
    ) : [],
    workload: ratings.workload !== 'unknown' ? extractEvidence(
      feedbackRows,
      ratings.workload === 'light' ? RATING_KEYWORDS.workload_light : RATING_KEYWORDS.workload_heavy
    ) : [],
  };

  // Extract DETAILED TRAITS
  const allText = allCommentTexts.join(' ').toLowerCase();
  
  // Find assessment types mentioned
  const assessmentTypes: string[] = [];
  for (const kw of RATING_KEYWORDS.assessments) {
    if (allText.includes(kw.toLowerCase()) && !assessmentTypes.includes(kw)) {
      assessmentTypes.push(kw);
    }
  }
  
  // Determine late policy
  const lateStrict = countKeywords(allText, RATING_KEYWORDS.late_strict);
  const lateLenient = countKeywords(allText, RATING_KEYWORDS.late_lenient);
  const latePolicy = lateStrict > lateLenient ? 'strict' : lateLenient > 0 ? 'lenient' : 'unknown';
  
  // Find red flags with evidence
  const redFlags = extractEvidence(feedbackRows, RATING_KEYWORDS.red_flags, 3);
  
  // Find tips/advice with evidence  
  const tips = extractEvidence(feedbackRows, RATING_KEYWORDS.tips, 3);

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
      sample_comments: sampleComments
    },
    ratings: sufficientData ? {
      a_able: ratings.a_able,
      teaching_quality: ratings.teaching,
      difficulty: ratings.difficulty,
      workload: ratings.workload,
      personality: ratings.personality,
      sample_size: totalComments,
      confidence: ratings.confidence,
    } : null,
    details: sufficientData ? {
      assessment_types: assessmentTypes.length > 0 ? assessmentTypes : ['unknown'],
      late_policy: latePolicy,
      late_evidence: latePolicy !== 'unknown' ? extractEvidence(
        feedbackRows, 
        latePolicy === 'strict' ? RATING_KEYWORDS.late_strict : RATING_KEYWORDS.late_lenient, 
        1
      ) : [],
      red_flags: redFlags,
      tips: tips
    } : null,
    evidence: sufficientData ? evidence : null,
    _format_hint: totalComments > 0 
      ? `Found ${totalComments} student comments about ${profName}. Present: 1) Ratings with evidence, 2) Assessment types, 3) Late policy, 4) Any red flags, 5) Student tips. ALWAYS cite the Facebook links as sources.`
      : `No feedback found for "${profName}". Suggest the user check the spelling or try a different name.`
  };
}
