/**
 * Get Code of Conduct Tool
 * 
 * Browse offense categories and examples
 */

import { SchemaType } from '@google/generative-ai';
import rulesData from '../../data/handbook_rules.json' with { type: 'json' };

export const definition = {
  name: 'get_code_of_conduct',
  description: 'Browse the Student Code of Conduct by category. Shows offense types (A-E), examples, and possible sanctions. Source: Official Student Handbook Vol 2.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      category: { 
        type: SchemaType.STRING, 
        description: 'Optional category: "A" (Persons), "B" (Integrity), "C" (Property), "D" (Order), "E" (Dishonesty), or "sanctions"' 
      },
    },
    required: [],
  },
};

export function handler(args: { category?: string }) {
  // If specific category requested
  if (args.category) {
    const cat = args.category.toUpperCase();
    
    if (cat === 'SANCTIONS' || cat === 'PENALTIES') {
      return {
        topic: 'Sanctions and Penalties',
        levels: rulesData.sanctions.levels,
        handling_office: rulesData.handling_office,
        source: rulesData.source
      };
    }
    
    if (cat === 'E' || cat.includes('DISHONESTY')) {
      return {
        category: 'E. Offenses Involving Dishonesty',
        general_examples: rulesData.categories.E.examples,
        academic_dishonesty: rulesData.academic_dishonesty,
        note: 'Academic dishonesty runs counter to the very essence of the Ateneo as an educational institution',
        source: rulesData.source
      };
    }
    
    const categoryData = rulesData.categories[cat as keyof typeof rulesData.categories];
    if (categoryData) {
      return {
        category: `${cat}. ${categoryData.name}`,
        examples: categoryData.examples,
        source: rulesData.source
      };
    }
    
    return {
      error: `Category "${args.category}" not found`,
      available: Object.entries(rulesData.categories).map(([code, cat]) => ({
        code,
        name: cat.name
      }))
    };
  }
  
  // Return overview of all categories
  const overview = Object.entries(rulesData.categories).map(([code, category]) => ({
    code,
    name: category.name,
    example_count: category.examples.length,
    sample: category.examples[0]
  }));
  
  return {
    title: 'Student Code of Conduct',
    categories: overview,
    sanction_levels: rulesData.sanctions.levels.map(s => s.name),
    handling_office: rulesData.handling_office,
    source: rulesData.source,
    _format_hint: 'Present as a table of categories. Mention that category E (dishonesty) has special academic dishonesty rules.'
  };
}
