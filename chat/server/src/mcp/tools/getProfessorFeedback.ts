/**
 * Get Professor Feedback Tool - OPTIMIZED
 * 
 * Retrieves student feedback from Facebook scraper database with:
 * - Numeric sentiment scores (1-5 scale)
 * - Context-aware filtering (only sentences mentioning the prof)
 * - Course-specific filtering
 * - Recency weighting
 * - Filipino slang keywords
 * - Attendance/consultation detection
 * - Pre-compiled regex for performance
 */

import { SchemaType } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { db as sisiaDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperDbPath = path.resolve(__dirname, '../../../../../sisia-scraper/data/scraper.db');

// ============= PRE-COMPILED KEYWORDS (Performance Optimization) =============
const KEYWORDS = {
  // A-ability: likelihood of getting an A
  a_able_pos: ['a-able', 'easy a', 'grades high', 'generous', 'curves', 'curve', 'lenient', 'high grades', 
               'gave me an a', 'mataas grades', 'pumasa', 'a ang grades', 'mabait maggrade'],
  a_able_neg: ['strict grader', 'mababa grades', 'terror', 'low grades', 'failed', 'f/d', 'will fail', 
               'bagsak', 'bumagsak', 'mahirap pumasa'],
  
  // Teaching quality
  teach_pos: ['goat', 'goated', 'best prof', 'best teacher', 'recommend', 'great teacher', 'explains well', 
              'learned a lot', 'interesting', 'engaging', 'super good', 'blessing', 'magaling magturo',
              'galing', 'solid', 'astig', 'the best', 'worth it'],
  teach_neg: ['boring', 'confusing', 'avoid', 'worst', 'terrible', 'bad teacher', 'run away', 'run',
              'walang kwenta', 'di magaling', 'nakakatamad', 'antok', 'deadma'],
  
  // Difficulty level
  diff_easy: ['easy', 'chill', 'light', 'manageable', 'relaxed', 'not hard', 'ez', 'madali', 'simple', 'basic'],
  diff_hard: ['hard', 'heavy', 'difficult', 'mahirap', 'challenging', 'demanding', 'tough', 'grabe', 'intense'],
  
  // Workload
  work_heavy: ['heavy workload', 'many readings', 'lot of work', 'groupworks', 'many requirements', 
               'recitation', 'readings', 'daming gawa', 'daming reqs', 'dami homework', 'weekly quiz'],
  work_light: ['light workload', 'manageable', 'few requirements', 'chill workload', 'no homework',
               'konti lang', 'walang hw', 'relax', 'minimal reqs'],
  
  // Personality
  pers_pos: ['nice', 'kind', 'fair', 'considerate', 'understanding', 'approachable', 'mother', 'caring',
             'mabait', 'malambing', 'masayahin', 'funny', 'sweet', 'helpful'],
  pers_neg: ['unfair', 'mean', 'rude', 'intimidating', 'scary', 'sungit', 'masungit', 'mayabang', 
             'bastos', 'strict', 'terror'],
  
  // Assessment types
  assess: ['quiz', 'quizzes', 'long quiz', 'short quiz', 'oral', 'oral exam', 'paper', 'papers', 
           'groupwork', 'group work', 'project', 'projects', 'final project', 'readings', 'recitation',
           'exam', 'exams', 'midterm', 'finals', 'homework', 'hw', 'presentation', 'essay', 'reflection'],
  
  // Deadline/late policy
  late_strict: ['strict deadline', 'no late', 'zero late', 'deduction', 'points off', 'strict sa deadline',
                'walang late', 'bawal late', 'on time', 'punctual'],
  late_lenient: ['extension', 'flexible', 'accepts late', 'understanding sa deadline', 'lenient deadline',
                 'pwede ilate', 'ok lang late', 'extended'],
  
  // Attendance
  attend_strict: ['attendance', 'strict attendance', 'absent', 'tardy', 'late policy', 'cuts', 
                  'bawal absent', 'checking attendance', 'excused only'],
  attend_lenient: ['optional attendance', 'no attendance', 'async', 'recorded lectures', 
                   'pwede di pumasok', 'flexible attendance'],
  
  // Consultation
  consult_good: ['replies fast', 'responds quickly', 'available', 'consultation', 'approachable',
                 'open for consult', 'magreply', 'responsive', 'reachable'],
  consult_bad: ['no reply', 'di nagrereply', 'unreachable', 'no consultation', 'hard to reach',
                'di available', 'ghost', 'seen-zoned'],
  
  // Red flags
  red_flags: ['racist', 'sexist', 'rude', 'mean', 'unfair', 'favorites', 'playing favorites', 'biased', 
              'terror', 'wag', 'run', 'run away', 'avoid', 'worst prof', 'crammer', 'no consultation',
              'bastos', 'walang modo', 'unprofessional', 'problematic'],
  
  // Tips/advice keywords
  tips: ['tip', 'tips', 'advice', 'recommend', 'suggestion', 'make sure', 'dont', "don't", 'you should',
         'just follow', 'rubric', 'pro tip', 'payo', 'heads up', 'warning', 'if you want', 'para pumasa']
};

// Pre-compute lowercase versions for faster matching
const KEYWORDS_LOWER: Record<string, string[]> = {};
for (const [key, words] of Object.entries(KEYWORDS)) {
  KEYWORDS_LOWER[key] = words.map(w => w.toLowerCase());
}

export const definition = {
  name: 'get_professor_feedback',
  description: 'Get student feedback and ratings for a professor. Returns numeric scores (1-5), assessment types, attendance policy, consultation availability, red flags, and student tips. All backed by evidence quotes with Facebook post links.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      professor_name: { 
        type: SchemaType.STRING, 
        description: 'Professor last name (e.g., "TANGARA", "SANTOS"). Use uppercase.' 
      },
      course_code: { 
        type: SchemaType.STRING, 
        description: 'Optional: filter feedback for a specific course (e.g., "SOCSC 12", "FILI 12")' 
      },
      limit: { 
        type: SchemaType.NUMBER, 
        description: 'Max sample comments (default: 5, max: 10)' 
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

// ============= OPTIMIZED HELPER FUNCTIONS =============

// Fast keyword counter using pre-computed lowercase
function countMatches(text: string, keywordKey: string): number {
  const keywords = KEYWORDS_LOWER[keywordKey];
  if (!keywords) return 0;
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) count++;
  }
  return count;
}

// Extract sentences that mention the professor (context filtering)
function extractRelevantSentences(text: string, profName: string): string {
  const profLower = profName.toLowerCase();
  const profParts = profLower.split(/[,\s]+/).filter(p => p.length > 2);
  
  // Split into sentences
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  
  // If fewer than 3 sentences, assume whole comment is relevant
  if (sentences.length <= 3) return text;
  
  // Filter sentences mentioning the prof
  const relevant = sentences.filter(s => {
    const sLower = s.toLowerCase();
    return profParts.some(p => sLower.includes(p)) || 
           sLower.includes('he ') || sLower.includes('she ') || 
           sLower.includes('him') || sLower.includes('her ') ||
           sLower.includes('sir ') || sLower.includes("ma'am") ||
           sLower.includes('prof ') || sLower.includes('teacher');
  });
  
  return relevant.length > 0 ? relevant.join('. ') : text;
}

// Calculate recency weight (newer comments weight more)
function getRecencyWeight(scrapedAt: string): number {
  const now = Date.now();
  const scraped = new Date(scrapedAt).getTime();
  const daysSince = (now - scraped) / (1000 * 60 * 60 * 24);
  
  if (daysSince < 30) return 1.5;   // Last month: 50% boost
  if (daysSince < 90) return 1.2;   // Last 3 months: 20% boost
  if (daysSince < 365) return 1.0;  // Last year: normal
  return 0.8;                        // Older: slight penalty
}

// Find keyword match for evidence extraction
function findMatch(text: string, keywordKey: string): string | null {
  const keywords = KEYWORDS_LOWER[keywordKey];
  if (!keywords) return null;
  const textLower = text.toLowerCase();
  for (const kw of keywords) {
    if (textLower.includes(kw)) return kw;
  }
  return null;
}

// Extract evidence with deduplication
function extractEvidence(rows: FeedbackRow[], keywordKey: string, max: number = 2): Evidence[] {
  const evidence: Evidence[] = [];
  const seenUrls = new Set<string>();
  
  for (const row of rows) {
    if (evidence.length >= max || seenUrls.has(row.source_url)) continue;
    
    const match = findMatch(row.feedback_text, keywordKey);
    if (match) {
      const textLower = row.feedback_text.toLowerCase();
      const idx = textLower.indexOf(match);
      const start = Math.max(0, idx - 40);
      const end = Math.min(row.feedback_text.length, idx + match.length + 80);
      let snippet = row.feedback_text.slice(start, end).trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < row.feedback_text.length) snippet += '...';
      
      evidence.push({ quote: snippet, link: row.source_url, reactions: row.reactions });
      seenUrls.add(row.source_url);
    }
  }
  return evidence;
}

// Compute numeric score (1-5) from positive/negative counts
function computeScore(pos: number, neg: number, weight: number = 1): number {
  const total = pos + neg;
  if (total === 0) return 3; // Neutral if no data
  const ratio = pos / total;
  // Scale: 1 (all negative) to 5 (all positive)
  const score = 1 + ratio * 4;
  // Apply weight and clamp to 1-5
  return Math.round(Math.min(5, Math.max(1, score * weight)) * 10) / 10;
}

// Determine label from score
function scoreToLabel(score: number, labels: [string, string, string]): string {
  if (score >= 4) return labels[0];  // Positive
  if (score <= 2) return labels[2];  // Negative
  return labels[1];                   // Mixed/moderate
}

// ============= MAIN HANDLER =============

export function handler(args: { professor_name: string; course_code?: string; limit?: number }) {
  const limit = Math.min(args.limit || 5, 10);
  const profName = args.professor_name.toUpperCase();
  const courseFilter = args.course_code?.toUpperCase();

  // Open scraper database
  let scraperDb: Database.Database;
  try {
    scraperDb = new Database(scraperDbPath, { readonly: true });
  } catch {
    return {
      error: 'Scraper database not available',
      instructor: { name: profName, exists_in_sisia: false, currently_teaching: false },
      feedback: { total: 0, filtered: 0 },
      scores: null
    };
  }

  // Check SISIA for instructor
  const instructorCheck = sisiaDb.prepare(`
    SELECT i.name, COUNT(DISTINCT cs.id) as section_count
    FROM instructor i
    LEFT JOIN class_section cs ON cs.instructor_id = i.id
    WHERE UPPER(i.name) LIKE ?
    GROUP BY i.id
    ORDER BY section_count DESC
    LIMIT 1
  `).get(`%${profName}%`) as InstructorRow | undefined;

  // Get feedback with optional course filter
  let query = `
    SELECT feedback_text, reactions, source_url, scraped_at
    FROM professor_feedback
    WHERE UPPER(instructor_name_scraped) LIKE ?
  `;
  const params: string[] = [`%${profName}%`];
  
  if (courseFilter) {
    query += ` AND UPPER(feedback_text) LIKE ?`;
    params.push(`%${courseFilter}%`);
  }
  
  query += ` ORDER BY reactions DESC, scraped_at DESC`;
  
  const rows = scraperDb.prepare(query).all(...params) as FeedbackRow[];
  scraperDb.close();

  const totalComments = rows.length;
  if (totalComments === 0) {
    return {
      instructor: { name: profName, exists_in_sisia: !!instructorCheck, currently_teaching: false },
      feedback: { total: 0, filtered: 0 },
      scores: null,
      _hint: `No feedback found for "${profName}". Check spelling or try a different name.`
    };
  }

  // Apply context filtering and recency weighting
  let weightedPosA = 0, weightedNegA = 0;
  let weightedPosT = 0, weightedNegT = 0;
  let weightedEasyD = 0, weightedHardD = 0;
  let weightedLightW = 0, weightedHeavyW = 0;
  let weightedPosP = 0, weightedNegP = 0;
  
  const assessmentSet = new Set<string>();
  let lateStrict = 0, lateLenient = 0;
  let attendStrict = 0, attendLenient = 0;
  let consultGood = 0, consultBad = 0;
  
  const processedTexts: string[] = [];
  
  for (const row of rows) {
    const relevant = extractRelevantSentences(row.feedback_text, profName);
    const textLower = relevant.toLowerCase();
    const weight = getRecencyWeight(row.scraped_at);
    
    processedTexts.push(textLower);
    
    // Weighted counts
    weightedPosA += countMatches(textLower, 'a_able_pos') * weight;
    weightedNegA += countMatches(textLower, 'a_able_neg') * weight;
    weightedPosT += countMatches(textLower, 'teach_pos') * weight;
    weightedNegT += countMatches(textLower, 'teach_neg') * weight;
    weightedEasyD += countMatches(textLower, 'diff_easy') * weight;
    weightedHardD += countMatches(textLower, 'diff_hard') * weight;
    weightedLightW += countMatches(textLower, 'work_light') * weight;
    weightedHeavyW += countMatches(textLower, 'work_heavy') * weight;
    weightedPosP += countMatches(textLower, 'pers_pos') * weight;
    weightedNegP += countMatches(textLower, 'pers_neg') * weight;
    
    // Assessment types
    for (const assess of KEYWORDS_LOWER['assess']) {
      if (textLower.includes(assess)) assessmentSet.add(assess);
    }
    
    // Policies
    lateStrict += countMatches(textLower, 'late_strict');
    lateLenient += countMatches(textLower, 'late_lenient');
    attendStrict += countMatches(textLower, 'attend_strict');
    attendLenient += countMatches(textLower, 'attend_lenient');
    consultGood += countMatches(textLower, 'consult_good');
    consultBad += countMatches(textLower, 'consult_bad');
  }

  // Compute scores (1-5 scale)
  const scores = {
    a_able: computeScore(weightedPosA, weightedNegA),
    teaching: computeScore(weightedPosT, weightedNegT),
    difficulty: computeScore(weightedEasyD, weightedHardD), // High = easy, Low = hard
    workload: computeScore(weightedLightW, weightedHeavyW), // High = light, Low = heavy
    personality: computeScore(weightedPosP, weightedNegP),
  };

  // Labels for each score
  const labels = {
    a_able: scoreToLabel(scores.a_able, ['likely', 'possible', 'unlikely']),
    teaching: scoreToLabel(scores.teaching, ['excellent', 'mixed', 'poor']),
    difficulty: scoreToLabel(scores.difficulty, ['easy', 'moderate', 'hard']),
    workload: scoreToLabel(scores.workload, ['light', 'moderate', 'heavy']),
    personality: scoreToLabel(scores.personality, ['positive', 'mixed', 'negative']),
  };

  // Policies
  const policies = {
    late: lateStrict > lateLenient ? 'strict' : lateLenient > 0 ? 'lenient' : 'unknown',
    attendance: attendStrict > attendLenient ? 'strict' : attendLenient > 0 ? 'flexible' : 'unknown',
    consultation: consultGood > consultBad ? 'responsive' : consultBad > 0 ? 'unresponsive' : 'unknown',
  };

  // Sample comments
  const samples = rows.slice(0, limit).map(r => ({
    text: r.feedback_text.length > 200 ? r.feedback_text.slice(0, 200) + '...' : r.feedback_text,
    reactions: r.reactions,
    link: r.source_url
  }));

  // Evidence
  const evidence = {
    a_able: extractEvidence(rows, scores.a_able >= 3 ? 'a_able_pos' : 'a_able_neg'),
    teaching: extractEvidence(rows, scores.teaching >= 3 ? 'teach_pos' : 'teach_neg'),
    difficulty: extractEvidence(rows, scores.difficulty >= 3 ? 'diff_easy' : 'diff_hard'),
    workload: extractEvidence(rows, scores.workload >= 3 ? 'work_light' : 'work_heavy'),
  };

  // Red flags and tips
  const redFlags = extractEvidence(rows, 'red_flags', 3);
  const tips = extractEvidence(rows, 'tips', 3);

  const confidence = totalComments >= 15 ? 'high' : totalComments >= 5 ? 'medium' : 'low';

  return {
    instructor: {
      name: instructorCheck?.name || profName,
      exists_in_sisia: !!instructorCheck,
      currently_teaching: (instructorCheck?.section_count || 0) > 0,
      sections: instructorCheck?.section_count || 0
    },
    feedback: {
      total: totalComments,
      filtered: courseFilter ? `for ${courseFilter}` : 'all courses',
      confidence
    },
    scores: {
      a_able: { score: scores.a_able, label: labels.a_able },
      teaching: { score: scores.teaching, label: labels.teaching },
      difficulty: { score: scores.difficulty, label: labels.difficulty },
      workload: { score: scores.workload, label: labels.workload },
      personality: { score: scores.personality, label: labels.personality },
    },
    details: {
      assessments: Array.from(assessmentSet).slice(0, 8),
      policies,
      red_flags: redFlags,
      tips
    },
    evidence,
    samples,
    _hint: `Present: 1) Scores with labels, 2) Policies, 3) Assessment types, 4) Red flags if any, 5) Tips. ALWAYS cite Facebook links.`
  };
}
