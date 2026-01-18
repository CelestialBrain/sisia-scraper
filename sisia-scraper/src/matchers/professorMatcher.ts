/**
 * Professor Matcher
 * Fuzzy matches scraped professor names against the SISIA database
 */

import Fuse from "fuse.js";
import * as log from "../utils/logger.js";

export interface Professor {
  id: number;
  name: string;
  nameNormalized: string;
  searchTerms: string[];
}

export interface MatchResult {
  instructorId: number;
  instructorName: string;
  confidence: number;
  matchedTerm: string;
}

let professorIndex: Fuse<Professor> | null = null;
let professorList: Professor[] = [];

/**
 * Initialize the professor matcher with a list of professors
 */
export function initProfessorMatcher(professors: Professor[]): void {
  professorList = professors;
  
  // Build search index with Fuse.js
  professorIndex = new Fuse(professors, {
    keys: [
      { name: "name", weight: 1.0 },
      { name: "nameNormalized", weight: 0.8 },
      { name: "searchTerms", weight: 0.6 },
    ],
    threshold: 0.4,          // Lower = stricter matching
    distance: 100,
    includeScore: true,
    ignoreLocation: true,
  });

  log.info(`Professor matcher initialized with ${professors.length} professors`);
}

/**
 * Normalize a name for matching
 * "SANTOS, JUAN M." → "santos juan"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.']/g, " ")        // Remove punctuation
    .replace(/\s+/g, " ")          // Normalize whitespace
    .replace(/\b[a-z]\b/g, "")     // Remove single letters (initials)
    .trim();
}

/**
 * Generate search term variations for a name
 */
export function generateSearchTerms(name: string): string[] {
  const terms: string[] = [name];
  const normalized = normalizeName(name);
  terms.push(normalized);

  // Split into parts
  const parts = normalized.split(" ").filter(p => p.length > 1);
  
  // Last name only
  if (parts.length > 0) {
    terms.push(parts[0]);
  }

  // First name (if LASTNAME, FIRSTNAME format)
  if (name.includes(",") && parts.length > 1) {
    terms.push(parts[1]);
  }

  // All combinations of two parts
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      terms.push(`${parts[i]} ${parts[j]}`);
    }
  }

  return [...new Set(terms)];
}

/**
 * Match a scraped name against the professor database
 */
export function matchProfessor(scrapedName: string): MatchResult | null {
  if (!professorIndex) {
    log.error("Professor matcher not initialized");
    return null;
  }

  const searchTerm = normalizeName(scrapedName);
  const results = professorIndex.search(searchTerm);

  if (results.length === 0) {
    log.debug(`No match for: ${scrapedName}`);
    return null;
  }

  const best = results[0];
  const confidence = 1 - (best.score || 0);

  // Only return if confidence is above threshold
  if (confidence < 0.5) {
    log.debug(`Low confidence match for ${scrapedName}: ${best.item.name} (${(confidence * 100).toFixed(0)}%)`);
    return null;
  }

  log.match(`Matched "${scrapedName}" → "${best.item.name}" (${(confidence * 100).toFixed(0)}%)`);

  return {
    instructorId: best.item.id,
    instructorName: best.item.name,
    confidence,
    matchedTerm: searchTerm,
  };
}

/**
 * Match multiple names and return all matches
 */
export function matchProfessors(names: string[]): MatchResult[] {
  const matches: MatchResult[] = [];
  
  for (const name of names) {
    const match = matchProfessor(name);
    if (match) {
      // Avoid duplicates
      if (!matches.some(m => m.instructorId === match.instructorId)) {
        matches.push(match);
      }
    }
  }

  return matches;
}

/**
 * Extract and match professor mentions from text
 */
export function findProfessorsInText(text: string): MatchResult[] {
  const mentions: string[] = [];
  
  // Pattern 1: LASTNAME, FIRSTNAME (AISIS format)
  const aisIsPattern = /\b([A-Z][A-Z]+(?:\s+[A-Z]+)*),\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?)/g;
  let match;
  while ((match = aisIsPattern.exec(text)) !== null) {
    mentions.push(`${match[1]}, ${match[2]}`);
  }

  // Pattern 2: Titles with names
  const titlePattern = /(?:Sir|Ma'am|Madam|Prof\.?|Dr\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
  while ((match = titlePattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Pattern 3: "with/under [Name]"
  const contextPattern = /(?:with|under|ni|kay|si)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Pattern 4: Standalone capitalized surnames (common in FB posts)
  // Only if they're 4+ characters to avoid false positives
  const surnamePattern = /\b([A-Z][a-z]{3,})\b/g;
  while ((match = surnamePattern.exec(text)) !== null) {
    // Only add if it looks like a surname (not common words)
    const word = match[1];
    const commonWords = ["This", "That", "What", "When", "Where", "Which", "There", "They", "Have", "Like", "Good", "Best"];
    if (!commonWords.includes(word)) {
      mentions.push(word);
    }
  }

  // Deduplicate and match
  const uniqueMentions = [...new Set(mentions)];
  return matchProfessors(uniqueMentions);
}

/**
 * Get all loaded professors
 */
export function getAllProfessors(): Professor[] {
  return professorList;
}
