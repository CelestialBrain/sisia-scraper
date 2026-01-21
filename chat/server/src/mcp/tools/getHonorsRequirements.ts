/**
 * Get Honors Requirements Tool
 * 
 * Returns Latin honors and semestral honors requirements
 */

import { SchemaType } from '@google/generative-ai';
import honorsData from '../../data/handbook_honors.json' with { type: 'json' };

export const definition = {
  name: 'get_honors_requirements',
  description: 'Get requirements for Latin honors (Summa, Magna, Cum Laude) and semestral honors (Dean\'s List). Source: Official Student Handbook.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      type: { 
        type: SchemaType.STRING, 
        description: 'Optional: "latin" for graduation honors, "semestral" for Dean\'s List' 
      },
      current_qpi: { 
        type: SchemaType.NUMBER, 
        description: 'Optional: Your current QPI to check which honors you qualify for' 
      },
    },
    required: [],
  },
};

export function handler(args: { type?: string; current_qpi?: number }) {
  // If checking specific QPI against honors
  if (args.current_qpi !== undefined) {
    const qpi = args.current_qpi;
    const latinHonors = Object.entries(honorsData.latin_honors)
      .sort((a, b) => b[1].min_qpi - a[1].min_qpi);
    
    let qualified: string | null = null;
    let nextTarget: { honor: string; needed: number } | null = null;
    
    for (const [honor, info] of latinHonors) {
      if (qpi >= info.min_qpi) {
        qualified = honor;
        break;
      } else if (!nextTarget || info.min_qpi < nextTarget.needed) {
        nextTarget = { honor, needed: info.min_qpi };
      }
    }
    
    return {
      your_qpi: qpi,
      qualifies_for: qualified || 'No Latin honors yet',
      next_target: qualified === 'Summa Cum Laude' ? null : nextTarget,
      gap: nextTarget ? Math.round((nextTarget.needed - qpi) * 1000) / 1000 : 0,
      latin_honors: Object.entries(honorsData.latin_honors).map(([honor, info]) => ({
        honor,
        min_qpi: info.min_qpi,
        qualified: qpi >= info.min_qpi ? '✓' : '✗'
      })),
      source: honorsData.source
    };
  }
  
  // If specific type requested
  if (args.type) {
    if (args.type.toLowerCase() === 'latin') {
      return {
        type: 'Latin Honors (Graduation)',
        honors: honorsData.latin_honors,
        eligibility_notes: honorsData.eligibility_notes,
        source: honorsData.source
      };
    }
    
    if (args.type.toLowerCase() === 'semestral') {
      return {
        type: 'Semestral Honors (Dean\'s List)',
        honors: honorsData.semestral_honors,
        deans_list: honorsData.deans_lister,
        source: honorsData.source
      };
    }
  }
  
  // Return full honors info
  return {
    latin_honors: Object.entries(honorsData.latin_honors).map(([honor, info]) => ({
      honor,
      min_qpi: info.min_qpi,
      description: info.description
    })),
    semestral_honors: honorsData.semestral_honors,
    eligibility_notes: honorsData.eligibility_notes,
    source: honorsData.source,
    _format_hint: 'Present Latin honors as a table with Honor, Min QPI, Description.'
  };
}
