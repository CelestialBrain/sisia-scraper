/**
 * Search Rules Tool
 * 
 * Search the Code of Conduct and academic policies
 */

import { SchemaType } from '@google/generative-ai';
import rulesData from '../../data/handbook_rules.json' with { type: 'json' };

export const definition = {
  name: 'search_rules',
  description: 'Search the Student Code of Conduct and academic policies for specific topics like plagiarism, cheating, harassment, etc. Source: Official Student Handbook Vol 2.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { 
        type: SchemaType.STRING, 
        description: 'Search term (e.g., "plagiarism", "cheating", "harassment", "bullying", "drugs")' 
      },
    },
    required: ['query'],
  },
};

export function handler(args: { query: string }) {
  const query = args.query.toLowerCase();
  const matches: { category: string; topic: string; details: string | string[] }[] = [];
  
  // Search in categories
  for (const [code, category] of Object.entries(rulesData.categories)) {
    const categoryMatches = category.examples.filter(ex => 
      ex.toLowerCase().includes(query)
    );
    
    if (categoryMatches.length > 0) {
      matches.push({
        category: `${code}. ${category.name}`,
        topic: categoryMatches.join(', '),
        details: `Found in offense category ${code}`
      });
    }
    
    // Also check category name
    if (category.name.toLowerCase().includes(query)) {
      matches.push({
        category: `${code}. ${category.name}`,
        topic: 'Category match',
        details: category.examples
      });
    }
  }
  
  // Search in academic dishonesty
  if (query.includes('cheat') || query.includes('exam')) {
    matches.push({
      category: 'E. Academic Dishonesty - Cheating',
      topic: 'Cheating during examinations',
      details: rulesData.academic_dishonesty.cheating
    });
  }
  
  if (query.includes('plagia')) {
    matches.push({
      category: 'E. Academic Dishonesty - Plagiarism',
      topic: 'Plagiarism',
      details: rulesData.academic_dishonesty.plagiarism
    });
  }
  
  if (query.includes('ai') || query.includes('chatgpt') || query.includes('artificial')) {
    matches.push({
      category: 'E. Academic Dishonesty - AI Use',
      topic: 'Unauthorized AI Use',
      details: rulesData.academic_dishonesty.unauthorized_ai
    });
  }
  
  if (query.includes('consequence') || query.includes('penalty') || query.includes('sanction')) {
    matches.push({
      category: 'Sanctions',
      topic: 'Possible consequences',
      details: rulesData.sanctions.levels.map(s => `${s.name}: ${s.description}`)
    });
  }
  
  if (matches.length === 0) {
    return {
      query: args.query,
      found: false,
      message: `No rules found matching "${args.query}". Try: plagiarism, cheating, harassment, bullying, drugs, AI`,
      categories: Object.entries(rulesData.categories).map(([code, cat]) => 
        `${code}. ${cat.name}`
      ),
      source: rulesData.source
    };
  }
  
  return {
    query: args.query,
    found: true,
    matches_count: matches.length,
    matches,
    handling_office: rulesData.handling_office,
    source: rulesData.source,
    _format_hint: 'Present matches with category and details. Emphasize consequences for serious offenses.'
  };
}
