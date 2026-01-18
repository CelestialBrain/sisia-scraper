/**
 * Comment Parser
 * Extracts and processes comments from Facebook posts
 * Comments are anonymized - commenter names are NOT stored
 */

import { ParsedReactions, parseReactions, calculateSentimentFromReactions } from "./postParser.js";
import * as log from "../utils/logger.js";

export interface ParsedComment {
  text: string;
  date: string;
  normalizedDate?: Date;
  reactions: ParsedReactions;
  sentiment: {
    score: number;
    label: "positive" | "negative" | "neutral" | "mixed";
  };
  isReply: boolean;           // Is this a reply to another comment?
  mentionedProfessors: string[];
}

/**
 * Extract keywords that indicate professor quality
 */
const POSITIVE_KEYWORDS = [
  "recommend", "highly recommend", "best", "great", "amazing", "kind",
  "fair", "considerate", "patient", "helpful", "understanding",
  "easy", "chill", "cool", "nice", "approachable", "go for",
  "10/10", "the goat", "legend", "love", "worth it"
];

const NEGATIVE_KEYWORDS = [
  "avoid", "don't", "don't take", "warning", "beware", "strict",
  "terror", "toxic", "unfair", "harsh", "difficult", "hard",
  "rip grades", "gl", "good luck", "f in chat", "yikes",
  "nope", "red flag", "drop", "withdraw"
];

/**
 * Analyze text sentiment based on keywords
 */
export function analyzeTextSentiment(text: string): {
  score: number;
  positiveMatches: string[];
  negativeMatches: string[];
} {
  const lowerText = text.toLowerCase();
  const positiveMatches: string[] = [];
  const negativeMatches: string[] = [];

  for (const keyword of POSITIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      positiveMatches.push(keyword);
    }
  }

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      negativeMatches.push(keyword);
    }
  }

  const positiveScore = positiveMatches.length * 0.3;
  const negativeScore = negativeMatches.length * -0.3;
  const score = Math.max(-1, Math.min(1, positiveScore + negativeScore));

  return { score, positiveMatches, negativeMatches };
}

/**
 * Parse a single comment from HTML fragment
 */
export function parseComment(html: string): ParsedComment | null {
  try {
    // Extract text content (simplified - use cheerio in production)
    let text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    
    if (!text || text.length < 3) {
      return null;
    }

    // Parse reactions
    const reactions = parseReactions(html);
    const reactionSentiment = calculateSentimentFromReactions(reactions);
    
    // Analyze text sentiment
    const textSentiment = analyzeTextSentiment(text);
    
    // Combined sentiment (weighted average)
    const combinedScore = (reactionSentiment.score * 0.4) + (textSentiment.score * 0.6);
    
    let label: "positive" | "negative" | "neutral" | "mixed";
    if (combinedScore > 0.2) label = "positive";
    else if (combinedScore < -0.2) label = "negative";
    else if (textSentiment.positiveMatches.length > 0 && textSentiment.negativeMatches.length > 0) label = "mixed";
    else label = "neutral";

    // Check if it's a reply (typically has different styling)
    const isReply = html.includes("reply") || html.includes("Reply");

    // Extract professor mentions
    const mentionedProfessors = extractProfessorMentionsFromText(text);

    return {
      text,
      date: "",
      reactions,
      sentiment: { score: combinedScore, label },
      isReply,
      mentionedProfessors,
    };
  } catch (error) {
    log.error("Failed to parse comment:", error);
    return null;
  }
}

/**
 * Extract professor name mentions from text
 */
function extractProfessorMentionsFromText(text: string): string[] {
  const mentions: string[] = [];
  
  // Look for capitalized names after common prefixes
  const patterns = [
    /(?:Sir|Ma'am|Prof\.?|Dr\.?)\s+([A-Z][a-z]+)/gi,
    /(?:under|with|ni|kay)\s+([A-Z][a-z]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      mentions.push(match[1]);
    }
  }

  return [...new Set(mentions)];
}

/**
 * Parse all comments from a post's HTML
 */
export function parseCommentsFromPost(postHtml: string): ParsedComment[] {
  const comments: ParsedComment[] = [];
  
  // Comments typically have a specific structure in Facebook
  // This is simplified - would need proper DOM parsing
  const commentSections = postHtml.split(/data-testid="comment-/);
  
  for (let i = 1; i < commentSections.length; i++) {
    const parsed = parseComment(commentSections[i]);
    if (parsed) {
      comments.push(parsed);
    }
  }

  return comments;
}

/**
 * Filter comments that are likely professor feedback
 */
export function filterProfessorFeedback(comments: ParsedComment[]): ParsedComment[] {
  return comments.filter(comment => {
    // Has professor mentions
    if (comment.mentionedProfessors.length > 0) return true;
    
    // Contains feedback keywords
    const hasKeywords = 
      POSITIVE_KEYWORDS.some(k => comment.text.toLowerCase().includes(k)) ||
      NEGATIVE_KEYWORDS.some(k => comment.text.toLowerCase().includes(k));
    
    return hasKeywords;
  });
}
