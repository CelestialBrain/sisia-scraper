/**
 * Get Grading System Tool
 * 
 * Explains Ateneo grading scale and QPI calculation
 */

import { SchemaType } from '@google/generative-ai';
import gradingData from '../../data/handbook_grades.json' with { type: 'json' };

export const definition = {
  name: 'get_grading_system',
  description: 'Explain the Ateneo grading system including letter grades, quality points, and how QPI is calculated. Source: Official Student Handbook.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      grade: { 
        type: SchemaType.STRING, 
        description: 'Optional specific grade to look up (e.g., "A", "B+", "INC")' 
      },
    },
    required: [],
  },
};

export function handler(args: { grade?: string }) {
  if (args.grade) {
    const gradeKey = args.grade.toUpperCase();
    const gradeInfo = gradingData.grades[gradeKey as keyof typeof gradingData.grades];
    
    if (gradeInfo) {
      return {
        grade: gradeKey,
        quality_points: gradeInfo.points,
        description: gradeInfo.description,
        included_in_qpi: gradeInfo.points !== null,
        source: gradingData.source
      };
    } else {
      return {
        error: `Grade "${args.grade}" not found`,
        available_grades: Object.keys(gradingData.grades)
      };
    }
  }
  
  // Return full grading system
  const gradeTable = Object.entries(gradingData.grades).map(([grade, info]) => ({
    grade,
    points: info.points,
    description: info.description
  }));
  
  return {
    grading_scale: gradeTable,
    qpi_calculation: gradingData.qpi_formula,
    excluded_from_qpi: gradingData.excluded_from_qpi,
    source: gradingData.source,
    _format_hint: 'Present as a table with Grade, Points, Description columns'
  };
}
