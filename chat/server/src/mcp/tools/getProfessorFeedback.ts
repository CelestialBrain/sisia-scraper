/**
 * Get Professor Feedback Tool - v3 SARCASM-AWARE
 * 
 * Comprehensive professor feedback with:
 * - Sarcasm detection (HAHAHA, "ok!" patterns, "pray")
 * - Warning patterns (RUN, pray, god help, never again)
 * - Negative reaction weighting (sad/angry = negative signal)
 * - Context-aware scoring
 * - Recommendation system (TAKE/AVOID)
 * - Would-retake sentiment analysis
 */

import { SchemaType } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { db as sisiaDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperDbPath = path.resolve(__dirname, '../../../../../sisia-scraper/data/scraper.db');

// ============= VERIFIED KEYWORDS =============
const KEYWORDS = {
  // A-ability
  a_pos: ['a-able', 'easy a', 'generous', 'curves', 'curve', 'lenient', 'high grades', 'gave me an a', 
          'pumasa', 'mabait maggrade', 'a ang grades'],
  a_neg: ['strict grader', 'mababa grades', 'terror', 'low grades', 'failed', 'will fail', 
          'bagsak', 'bumagsak', 'mahirap pumasa'],
  
  // Teaching
  teach_pos: ['goat', 'goated', 'best prof', 'best teacher', 'recommend', 'great teacher', 'explains well', 
              'learned a lot', 'interesting', 'engaging', 'blessing', 'magaling magturo', 'galing', 'solid', 'the best'],
  teach_neg: ['boring', 'confusing', 'avoid', 'worst', 'terrible', 'bad teacher', 'walang kwenta', 
              'di magaling', 'nakakatamad', 'antok', 'deadma'],
  
  // Difficulty  
  diff_easy: ['easy', 'chill', 'light', 'manageable', 'relaxed', 'not hard', 'ez', 'madali', 'simple'],
  diff_hard: ['hard', 'heavy', 'difficult', 'mahirap', 'challenging', 'demanding', 'tough', 'grabe', 'intense'],
  
  // Workload
  work_light: ['light workload', 'manageable', 'few requirements', 'chill', 'konti lang', 'minimal reqs'],
  work_heavy: ['heavy workload', 'many readings', 'lot of work', 'many requirements', 'daming gawa', 
               'daming reqs', 'weekly quiz', 'groupworks'],
  
  // Personality
  pers_pos: ['nice', 'kind', 'fair', 'considerate', 'understanding', 'approachable', 'caring', 
             'mabait', 'funny', 'sweet', 'helpful'],
  pers_neg: ['unfair', 'mean', 'rude', 'intimidating', 'scary', 'sungit', 'masungit', 'mayabang', 'bastos'],
  
  // Assessments
  assess: ['quiz', 'quizzes', 'oral', 'paper', 'papers', 'groupwork', 'project', 'projects', 
           'readings', 'recitation', 'exam', 'exams', 'midterm', 'finals', 'presentation', 'essay'],
  
  // Late policy (require 2+ for strict)
  late_strict: ['strict deadline', 'no late', 'zero late', 'deduction', 'points off', 'bawal late'],
  late_lenient: ['extension', 'flexible deadline', 'accepts late', 'lenient deadline', 'pwede ilate'],
  
  // Attendance (context-verified)
  attend_strict: ['strict attendance', 'bawal absent', 'checking attendance', 'attendance required'],
  attend_lenient: ['no attendance', 'optional', 'async', 'recorded lectures', 'pwede di pumasok'],
  
  // Red flags (verified negative)
  red_flags_verified: ['racist', 'sexist', 'unfair', 'favorites', 'playing favorites', 'biased', 
                       'bastos', 'walang modo', 'unprofessional', 'problematic', 'never again'],
  
  // Strong warnings (standalone signals)
  warnings: ['run', 'run away', 'pray', 'god help', 'good luck', 'rip', 'wtf', 'super low',
             'grades super low', 'never again', 'biggest mistake', 'regret'],
  
  // Sarcasm indicators (when combined with positive words = actually negative)
  sarcasm: ['hahaha', 'hahahaha', 'lol', 'lmao', '...', 'ok!', 'is.... ok', 'guantanamo', 'prince of boredom'],
  
  // Would retake
  would_retake_pos: ['would take again', 'take again', 'retake', 'worth it', 'miss sir', 
                     'miss his class', 'i miss', 'goated', 'goat', 'best prof', 'good experience'],
  would_retake_neg: ['never again', 'would not take', 'avoid', 'run', 'run away', 'worst', "don't take",
                     'not worth', 'regret', 'biggest mistake', 'pray'],
  
  // Success strategies  
  success: ['tip', 'tips', 'advice', 'pro tip', 'how i got', 'para pumasa', 'make sure', 'study', 
            'cheat sheet', 'practice problems', 'rubric', 'just follow', 'listen', 'pay attention',
            'textbook', 'read the book']
};

// Pre-compute lowercase
const KW: Record<string, string[]> = {};
for (const [k, v] of Object.entries(KEYWORDS)) {
  KW[k] = v.map(x => x.toLowerCase());
}

export const definition = {
  name: 'get_professor_feedback',
  description: 'Get verified student feedback for a professor. Returns numeric scores (1-5), policies, red flags, and a TAKE/AVOID recommendation. All data is context-verified to minimize false positives.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      professor_name: { type: SchemaType.STRING, description: 'Professor last name (uppercase)' },
      course_code: { type: SchemaType.STRING, description: 'Optional: filter by course' },
    },
    required: ['professor_name'],
  },
};

interface Row { feedback_text: string; reactions: number; source_url: string; scraped_at: string; }
interface Evidence { quote: string; link: string; reactions: number; }

// ============= VERIFIED HELPER FUNCTIONS =============

// Count matches in text
function count(text: string, key: string): number {
  const words = KW[key] || [];
  return words.filter(w => text.includes(w)).length;
}

// Detect sarcasm patterns (HAHAHA after positive, ellipsis, specific phrases)
function isSarcastic(text: string): boolean {
  const t = text.toLowerCase();
  // "ok HAHAHA" pattern
  if (/ok[!.]*\s*(haha|lol|lmao)/i.test(text)) return true;
  // Multiple HAHA after mild statement
  if (/is\.{2,}\s*ok|is\s+ok.*haha/i.test(text)) return true;
  // Guantanamo, prince of boredom (clearly sarcastic)
  if (t.includes('guantanamo') || t.includes('prince of boredom')) return true;
  // "pray" or "god help" = warning, not positive
  if (t.includes('pray') || t.includes('god help') || t.includes('good luck')) return true;
  return false;
}

// Detect strong warning signals
function hasWarning(text: string): boolean {
  const t = text.toLowerCase();
  const warnings = ['run', 'pray', 'god help', 'wtf', 'super low', 'grades super low', 
                    'never again', 'biggest mistake', 'regret', 'rip'];
  return warnings.some(w => t.includes(w));
}

// Check if positive context is genuine (not sarcastic)
function hasGenuinePositiveContext(text: string): boolean {
  if (isSarcastic(text)) return false;
  if (hasWarning(text)) return false;
  const posWords = ['good', 'great', 'nice', 'love', 'goat', 'best', 'recommend', 'blessing'];
  return posWords.some(w => text.includes(w));
}

// Check if sentence has negative context
function hasNegativeContext(text: string): boolean {
  const t = text.toLowerCase();
  // Sarcasm = effectively negative
  if (isSarcastic(t)) return true;
  // Warnings = negative
  if (hasWarning(t)) return true;
  const negWords = ['bad', 'worst', 'terrible', 'avoid', 'unfair', 'never', "don't", 'not easy',
                    'struggling', 'failed', 'low grades', 'super low'];
  return negWords.some(w => t.includes(w));
}

// Recency weight
function recencyWeight(scraped: string): number {
  const days = (Date.now() - new Date(scraped).getTime()) / 86400000;
  if (days < 30) return 1.5;
  if (days < 90) return 1.2;
  if (days < 365) return 1.0;
  return 0.8;
}

// Extract quote snippet
function snippet(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword);
  if (idx === -1) return text.slice(0, 100) + '...';
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 70);
  let s = text.slice(start, end).trim();
  if (start > 0) s = '...' + s;
  if (end < text.length) s += '...';
  return s;
}

// Extract verified evidence (with context check for red flags)
function getEvidence(rows: Row[], key: string, max: number = 2, requireNegContext: boolean = false): Evidence[] {
  const result: Evidence[] = [];
  const seen = new Set<string>();
  
  for (const row of rows) {
    if (result.length >= max || seen.has(row.source_url)) continue;
    const textL = row.feedback_text.toLowerCase();
    
    for (const kw of (KW[key] || [])) {
      if (textL.includes(kw)) {
        // For red flags, verify negative context
        if (requireNegContext && hasGenuinePositiveContext(textL) && !hasNegativeContext(textL)) continue;
        
        result.push({ 
          quote: snippet(row.feedback_text, kw), 
          link: row.source_url, 
          reactions: row.reactions 
        });
        seen.add(row.source_url);
        break;
      }
    }
  }
  return result;
}

// ============= MAIN HANDLER =============

export function handler(args: { professor_name: string; course_code?: string }) {
  const profName = args.professor_name.toUpperCase();
  const courseFilter = args.course_code?.toUpperCase();

  let scraperDb: Database.Database;
  try {
    scraperDb = new Database(scraperDbPath, { readonly: true });
  } catch {
    return { error: 'Scraper database not available' };
  }

  // First, get the actual scraped instructor names to find the best match
  const scrapedNames = scraperDb.prepare(`
    SELECT DISTINCT instructor_name_scraped 
    FROM professor_feedback 
    WHERE UPPER(instructor_name_scraped) LIKE ?
    ORDER BY LENGTH(instructor_name_scraped) DESC
  `).all(`%${profName}%`) as { instructor_name_scraped: string }[];
  
  // Use the most complete scraped name (longest = most specific)
  const bestScrapedName = scrapedNames.length > 0 ? scrapedNames[0].instructor_name_scraped : profName;
  
  // Try to match against SISIA using the scraped name first
  let inst = sisiaDb.prepare(`
    SELECT i.name, COUNT(DISTINCT cs.id) as sections
    FROM instructor i
    LEFT JOIN class_section cs ON cs.instructor_id = i.id
    WHERE UPPER(i.name) LIKE ?
    GROUP BY i.id ORDER BY sections DESC LIMIT 1
  `).get(`%${bestScrapedName}%`) as { name: string; sections: number } | undefined;
  
  // Fallback: if no exact match, try with just the last name
  if (!inst && bestScrapedName.includes(',')) {
    const lastName = bestScrapedName.split(',')[0].trim();
    inst = sisiaDb.prepare(`
      SELECT i.name, COUNT(DISTINCT cs.id) as sections
      FROM instructor i
      LEFT JOIN class_section cs ON cs.instructor_id = i.id
      WHERE UPPER(i.name) LIKE ?
      GROUP BY i.id ORDER BY sections DESC LIMIT 1
    `).get(`%${lastName}%`) as { name: string; sections: number } | undefined;
  }

  // Get feedback
  let q = `SELECT feedback_text, reactions, source_url, scraped_at FROM professor_feedback WHERE UPPER(instructor_name_scraped) LIKE ?`;
  const p: string[] = [`%${profName}%`];
  if (courseFilter) { q += ` AND UPPER(feedback_text) LIKE ?`; p.push(`%${courseFilter}%`); }
  q += ` ORDER BY reactions DESC, scraped_at DESC`;
  
  const rows = scraperDb.prepare(q).all(...p) as Row[];
  scraperDb.close();

  if (rows.length === 0) {
    return { 
      error: 'no_feedback',
      instructor: profName,
      message: `No feedback found for "${profName}". Check spelling or try a different name.`
    };
  }

  // Aggregate scores with weighting AND sarcasm detection
  let aPos = 0, aNeg = 0, tPos = 0, tNeg = 0, dEasy = 0, dHard = 0, wLight = 0, wHeavy = 0, pPos = 0, pNeg = 0;
  let lateStrict = 0, lateLenient = 0, attendStrict = 0, attendLenient = 0;
  let retakePos = 0, retakeNeg = 0;
  let warningCount = 0;
  const assessSet = new Set<string>();
  let totalReactions = 0;
  
  for (const row of rows) {
    const t = row.feedback_text.toLowerCase();
    const w = recencyWeight(row.scraped_at);
    totalReactions += row.reactions;
    
    // Check for sarcasm/warnings - if present, flip or penalize positive counts
    const sarcastic = isSarcastic(t);
    const hasWarn = hasWarning(t);
    if (hasWarn) warningCount++;
    
    // If sarcastic or warning, treat positives as negatives
    if (sarcastic || hasWarn) {
      // Flip: count positives as negatives
      aNeg += count(t, 'a_pos') * w * 0.5; // Partial weight
      tNeg += count(t, 'teach_pos') * w * 0.5;
      dHard += count(t, 'diff_easy') * w * 0.5;
      // Still count explicit negatives
      aNeg += count(t, 'a_neg') * w;
      tNeg += count(t, 'teach_neg') * w;
      dHard += count(t, 'diff_hard') * w;
      pNeg += count(t, 'pers_neg') * w;
    } else {
      // Normal counting
      aPos += count(t, 'a_pos') * w;
      aNeg += count(t, 'a_neg') * w;
      tPos += count(t, 'teach_pos') * w;
      tNeg += count(t, 'teach_neg') * w;
      dEasy += count(t, 'diff_easy') * w;
      dHard += count(t, 'diff_hard') * w;
      pPos += count(t, 'pers_pos') * w;
      pNeg += count(t, 'pers_neg') * w;
    }
    wLight += count(t, 'work_light') * w;
    wHeavy += count(t, 'work_heavy') * w;
    
    // Policies (require 2+ matches OR high confidence)
    const ls = count(t, 'late_strict');
    const ll = count(t, 'late_lenient');
    const as = count(t, 'attend_strict');
    const al = count(t, 'attend_lenient');
    
    // Only count if context is consistent (not positive context for strict)
    if (ls > 0 && !hasGenuinePositiveContext(t)) lateStrict += ls;
    if (ll > 0) lateLenient += ll;
    if (as > 0 && !hasGenuinePositiveContext(t)) attendStrict += as;
    if (al > 0) attendLenient += al;
    
    // Would retake
    retakePos += count(t, 'would_retake_pos');
    retakeNeg += count(t, 'would_retake_neg');
    
    // Assessments
    for (const a of KW['assess']) { if (t.includes(a)) assessSet.add(a); }
  }

  // Compute scores (1-5)
  const score = (pos: number, neg: number) => {
    if (pos + neg === 0) return 3;
    return Math.round((1 + (pos / (pos + neg)) * 4) * 10) / 10;
  };
  
  const scores = {
    a_able: score(aPos, aNeg),
    teaching: score(tPos, tNeg),
    difficulty: score(dEasy, dHard),
    workload: score(wLight, wHeavy),
    personality: score(pPos, pNeg),
  };
  
  // Labels
  const label = (s: number, l: [string, string, string]) => s >= 4 ? l[0] : s <= 2 ? l[2] : l[1];
  const labels = {
    a_able: label(scores.a_able, ['likely', 'possible', 'unlikely']),
    teaching: label(scores.teaching, ['excellent', 'mixed', 'poor']),
    difficulty: label(scores.difficulty, ['easy', 'moderate', 'hard']),
    workload: label(scores.workload, ['light', 'moderate', 'heavy']),
    personality: label(scores.personality, ['positive', 'mixed', 'negative']),
  };
  
  // Policies (require threshold)
  const policies = {
    late: lateStrict >= 2 ? 'strict' : lateLenient >= 1 ? 'lenient' : 'unknown',
    attendance: attendStrict >= 2 ? 'strict' : attendLenient >= 1 ? 'flexible' : 'unknown',
  };

  // VERIFIED red flags (require negative context)
  const redFlags = getEvidence(rows, 'red_flags_verified', 3, true);
  
  // Success strategies
  const successStrategies = getEvidence(rows, 'success', 3);
  
  // Would retake analysis
  const wouldRetake = {
    yes: retakePos,
    no: retakeNeg,
    verdict: retakePos > retakeNeg * 2 ? 'recommend' : retakeNeg > retakePos ? 'avoid' : 'neutral'
  };

  // Overall rating (1-10)
  const overallRating = Math.round(
    (scores.a_able * 0.25 + scores.teaching * 0.35 + scores.difficulty * 0.15 + 
     scores.personality * 0.15 + (scores.workload > 2.5 ? 4 : 2) * 0.1) * 2
  ) / 10 * 10;

  // SYNTHESIS: Binary recommendation
  const positiveSignals = (scores.a_able >= 4 ? 1 : 0) + (scores.teaching >= 4 ? 2 : 0) + 
                          (scores.personality >= 4 ? 1 : 0) + (retakePos > retakeNeg ? 1 : 0);
  const negativeSignals = (scores.teaching <= 2 ? 2 : 0) + (redFlags.length >= 2 ? 2 : 0) + 
                          (retakeNeg > retakePos * 2 ? 1 : 0) + (warningCount >= 3 ? 2 : 0);
  
  const recommendation = {
    take: positiveSignals > negativeSignals,
    confidence: rows.length >= 10 ? 'high' : rows.length >= 5 ? 'medium' : 'low',
    reasoning: positiveSignals > negativeSignals
      ? `${labels.teaching} teaching, ${labels.a_able} A grades, ${wouldRetake.verdict} by students`
      : `${labels.teaching} teaching quality with ${redFlags.length} concerns raised`
  };

  // Samples (top 3)
  const samples = rows.slice(0, 3).map(r => ({
    text: r.feedback_text.slice(0, 180) + (r.feedback_text.length > 180 ? '...' : ''),
    reactions: r.reactions,
    link: r.source_url
  }));

  // Credibility
  const avgReactions = Math.round(totalReactions / rows.length * 10) / 10;
  
  return {
    instructor: {
      name: inst?.name || bestScrapedName || profName,
      scraped_as: bestScrapedName,
      in_sisia: !!inst,
      teaching: (inst?.sections || 0) > 0,
      sections: inst?.sections || 0
    },
    feedback: {
      total: rows.length,
      course: courseFilter || 'all',
      avg_reactions: avgReactions,
      confidence: recommendation.confidence
    },
    rating: {
      overall: overallRating,
      a_able: { score: scores.a_able, label: labels.a_able },
      teaching: { score: scores.teaching, label: labels.teaching },
      difficulty: { score: scores.difficulty, label: labels.difficulty },
      workload: { score: scores.workload, label: labels.workload },
      personality: { score: scores.personality, label: labels.personality },
    },
    policies,
    assessments: Array.from(assessSet).slice(0, 6),
    would_retake: wouldRetake,
    recommendation,
    warnings: redFlags.length > 0 ? redFlags : null,
    success_strategies: successStrategies.length > 0 ? successStrategies : null,
    samples,
    _hint: `Present as: 1) Overall rating & recommendation, 2) Key scores, 3) Policies, 4) Warnings if any, 5) Success tips. Cite Facebook links.`
  };
}
