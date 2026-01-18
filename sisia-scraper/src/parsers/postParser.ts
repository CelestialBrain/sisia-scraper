/**
 * Facebook Post Parser
 * Extracts post data, reactions, and comments from captured HTML
 */

import * as log from "../utils/logger.js";

export interface ParsedReactions {
  total: number;
  like: number;
  love: number;
  care: number;
  haha: number;      // Often indicates sarcasm/bad professor
  wow: number;
  sad: number;
  angry: number;
}

export interface ParsedComment {
  text: string;
  date: string;
  reactions?: ParsedReactions;
  // Note: commenter names are NOT stored (anonymized by design)
}

export interface ParsedPost {
  postId?: string;
  postUrl?: string;
  authorType: "anonymous" | "named";
  content: string;
  date: string;
  normalizedDate?: Date;
  reactions: ParsedReactions;
  comments: ParsedComment[];
  mentionedProfessors: string[];  // Extracted professor name mentions
}

/**
 * Parse reactions from Facebook's reaction display
 * Reactions in FB HTML appear as aria-labels like "25 reactions, including Like, Haha, and Love"
 */
export function parseReactions(html: string): ParsedReactions {
  const reactions: ParsedReactions = {
    total: 0,
    like: 0,
    love: 0,
    care: 0,
    haha: 0,
    wow: 0,
    sad: 0,
    angry: 0,
  };

  // Look for reaction count patterns
  // Facebook formats: "25 reactions" or individual counts
  const totalMatch = html.match(/(\d+)\s*(?:reactions?|likes?)/i);
  if (totalMatch) {
    reactions.total = parseInt(totalMatch[1]);
  }

  // Look for individual reaction type indicators
  // These often appear as aria-labels or data attributes
  const reactionPatterns: Record<keyof Omit<ParsedReactions, 'total'>, RegExp[]> = {
    like: [/Like/gi, /👍/g],
    love: [/Love/gi, /❤️/g, /❤/g],
    care: [/Care/gi, /🤗/g],
    haha: [/Haha/gi, /😂/g, /😆/g],
    wow: [/Wow/gi, /😮/g, /😲/g],
    sad: [/Sad/gi, /😢/g, /😥/g],
    angry: [/Angry/gi, /😠/g, /😡/g],
  };

  // Simple presence detection (actual counts would need more parsing)
  for (const [type, patterns] of Object.entries(reactionPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        reactions[type as keyof Omit<ParsedReactions, 'total'>] = 1;
        break;
      }
    }
  }

  return reactions;
}

/**
 * Calculate sentiment score from reactions
 * Returns: -1 (negative) to +1 (positive)
 * 
 * Interpretation based on Ateneo Profs to Pick culture:
 * - 😂 Haha reactions often mean "oh no, this prof is tough/bad"
 * - ❤️ Love and 👍 Like = positive endorsement
 * - 😢 Sad and 😠 Angry = avoid this prof
 */
export function calculateSentimentFromReactions(reactions: ParsedReactions): {
  score: number;
  label: "positive" | "negative" | "neutral" | "mixed";
} {
  if (reactions.total === 0) {
    return { score: 0, label: "neutral" };
  }

  // Weight each reaction type
  const weights = {
    like: 0.3,
    love: 1.0,
    care: 0.5,
    haha: -0.6,    // Often sarcastic/negative in prof context
    wow: 0,        // Neutral - could go either way
    sad: -0.8,
    angry: -1.0,
  };

  let weightedSum = 0;
  let totalWeighted = 0;

  for (const [type, weight] of Object.entries(weights)) {
    const count = reactions[type as keyof Omit<ParsedReactions, 'total'>] || 0;
    weightedSum += count * weight;
    totalWeighted += count;
  }

  const score = totalWeighted > 0 ? weightedSum / totalWeighted : 0;
  
  let label: "positive" | "negative" | "neutral" | "mixed";
  if (score > 0.3) label = "positive";
  else if (score < -0.3) label = "negative";
  else if (reactions.haha > 0 && reactions.love > 0) label = "mixed";
  else label = "neutral";

  return { score, label };
}

/**
 * Parse Facebook relative date strings
 * "3h" → 3 hours ago, "2d" → 2 days ago, etc.
 */
export function parseRelativeDate(dateStr: string): Date | null {
  const now = new Date();
  
  // Match patterns like "3h", "2d", "1w", "January 15"
  const relativeMatch = dateStr.match(/^(\d+)([mhdwMy])$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    
    switch (unit) {
      case 'm': return new Date(now.getTime() - amount * 60 * 1000);
      case 'h': return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case 'd': return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      case 'w': return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      case 'M': now.setMonth(now.getMonth() - amount); return now;
      case 'y': now.setFullYear(now.getFullYear() - amount); return now;
    }
  }

  // Try to parse as absolute date
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return null;
}

/**
 * Extract professor name mentions from text
 * Looks for patterns like "LASTNAME, FIRSTNAME" which is AISIS format
 */
export function extractProfessorMentions(text: string): string[] {
  const mentions: string[] = [];
  
  // Pattern 1: LASTNAME, FIRSTNAME M. (AISIS format)
  const aisIsPattern = /\b([A-Z][A-Z]+(?:\s+[A-Z]+)*),\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?)/g;
  let match;
  while ((match = aisIsPattern.exec(text)) !== null) {
    mentions.push(`${match[1]}, ${match[2]}`);
  }

  // Pattern 2: Just capitalized names like "Sir Santos" or "Ma'am Garcia"
  const titlePattern = /(?:Sir|Ma'am|Madam|Prof\.?|Dr\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
  while ((match = titlePattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Pattern 3: Course code + professor combo "CSCI 21 with SANTOS"
  const courseProf = /(?:with|under|ni|kay)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
  while ((match = courseProf.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Deduplicate
  return [...new Set(mentions)];
}

/**
 * Parse raw HTML into structured post data
 * This is a simplified parser - Facebook's HTML structure changes frequently
 */
export function parsePostHTML(html: string): ParsedPost | null {
  try {
    // Note: In production, you'd use a proper HTML parser like cheerio
    // This is a simplified regex-based approach
    
    const post: ParsedPost = {
      authorType: "anonymous",
      content: "",
      date: "",
      reactions: {
        total: 0,
        like: 0,
        love: 0,
        care: 0,
        haha: 0,
        wow: 0,
        sad: 0,
        angry: 0,
      },
      comments: [],
      mentionedProfessors: [],
    };

    // Check if anonymous
    if (html.includes("Anonymous") || html.includes("anonymous")) {
      post.authorType = "anonymous";
    } else {
      post.authorType = "named";
    }

    // Extract main content (simplified - actual implementation needs DOM parsing)
    // Look for content between common Facebook post markers
    const contentMatch = html.match(/data-ad-preview="message"[^>]*>([\s\S]*?)<\/div>/);
    if (contentMatch) {
      post.content = contentMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    // Extract date
    const dateMatch = html.match(/aria-label="[^"]*"[^>]*>(\d+[mhdwy]|[A-Z][a-z]+ \d+)/);
    if (dateMatch) {
      post.date = dateMatch[1];
      post.normalizedDate = parseRelativeDate(dateMatch[1]) || undefined;
    }

    // Parse reactions
    post.reactions = parseReactions(html);

    // Extract professor mentions from content
    if (post.content) {
      post.mentionedProfessors = extractProfessorMentions(post.content);
    }

    return post;
  } catch (error) {
    log.error("Failed to parse post HTML:", error);
    return null;
  }
}

/**
 * Parse multiple posts from a page capture
 */
export function parsePageCapture(html: string): ParsedPost[] {
  const posts: ParsedPost[] = [];
  
  // Facebook posts are typically in divs with role="article"
  // This is a simplified approach
  const postSections = html.split(/role="article"/);
  
  for (let i = 1; i < postSections.length; i++) {
    const postHtml = postSections[i];
    const parsed = parsePostHTML(postHtml);
    if (parsed && parsed.content) {
      posts.push(parsed);
    }
  }

  log.info(`Parsed ${posts.length} posts from capture`);
  return posts;
}
