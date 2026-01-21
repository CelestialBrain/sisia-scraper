/**
 * Get QPI Requirements Tool
 * 
 * Returns year-level QPI requirements and probation rules
 */

import { SchemaType } from '@google/generative-ai';
import qpiData from '../../data/handbook_qpi.json' with { type: 'json' };

export const definition = {
  name: 'get_qpi_requirements',
  description: 'Get the QPI requirements for each year level, graduation requirements, probation rules, and consequences of not meeting requirements. Source: Official Student Handbook.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      year_level: { 
        type: SchemaType.STRING, 
        description: 'Optional specific year level (e.g., "First Year", "Sophomore", "Junior", "Senior")' 
      },
      topic: { 
        type: SchemaType.STRING, 
        description: 'Optional topic: "retention", "graduation", "probation", "separation"' 
      },
    },
    required: [],
  },
};

export function handler(args: { year_level?: string; topic?: string }) {
  // If specific year level requested
  if (args.year_level) {
    const yearKey = args.year_level as keyof typeof qpiData.retention_requirements;
    const yearInfo = qpiData.retention_requirements[yearKey];
    
    if (yearInfo) {
      return {
        year_level: args.year_level,
        required_qpi: yearInfo.min_qpi,
        description: yearInfo.description,
        consequence_if_not_met: qpiData.separation.condition,
        probation_available: "Yes - one-time appeal to Standards Committee",
        source: qpiData.source
      };
    }
  }
  
  // If specific topic requested
  if (args.topic) {
    const topic = args.topic.toLowerCase();
    
    if (topic === 'retention') {
      return {
        topic: 'Retention Requirements',
        requirements: Object.entries(qpiData.retention_requirements).map(([year, info]) => ({
          year_level: year,
          min_qpi: info.min_qpi
        })),
        source: qpiData.source
      };
    }
    
    if (topic === 'graduation') {
      return {
        topic: 'Graduation Requirements',
        ...qpiData.graduation_requirement,
        source: qpiData.source
      };
    }
    
    if (topic === 'probation') {
      return {
        topic: 'Academic Probation',
        ...qpiData.probation,
        source: qpiData.source
      };
    }
    
    if (topic === 'separation') {
      return {
        topic: 'Separation from Ateneo',
        ...qpiData.separation,
        source: qpiData.source
      };
    }
  }
  
  // Return full summary
  return {
    retention_by_year: Object.entries(qpiData.retention_requirements).map(([year, info]) => ({
      year: year,
      min_qpi: info.min_qpi
    })),
    graduation: {
      min_qpi: qpiData.graduation_requirement.min_qpi,
      requirements: qpiData.graduation_requirement.requirements
    },
    probation: {
      description: qpiData.probation.description,
      limit: qpiData.probation.limit,
      restrictions: qpiData.probation.restrictions
    },
    separation: qpiData.separation,
    source: qpiData.source,
    _format_hint: 'Present retention requirements as a table. Highlight that probation is one-time only.'
  };
}
