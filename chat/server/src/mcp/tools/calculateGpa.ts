/**
 * Calculate GPA Tool
 * 
 * What-if GPA/QPI calculator for grade planning
 */

import { SchemaType } from '@google/generative-ai';

export const definition = {
  name: 'calculate_gpa',
  description: 'What-if GPA/QPI calculator. Calculate projected QPI based on expected grades, or find what grades you need to reach a target QPI.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      current_qpi: { 
        type: SchemaType.NUMBER, 
        description: 'Your current cumulative QPI (e.g., 3.45)' 
      },
      current_units: { 
        type: SchemaType.NUMBER, 
        description: 'Total units completed so far' 
      },
      projected_grades: { 
        type: SchemaType.ARRAY,
        description: 'Array of expected grades: [{units: 3, grade: "A"}, {units: 3, grade: "B+"}]',
        items: {
          type: SchemaType.OBJECT,
          properties: {
            units: { type: SchemaType.NUMBER },
            grade: { type: SchemaType.STRING }
          }
        }
      },
      target_qpi: { 
        type: SchemaType.NUMBER, 
        description: 'Optional target QPI to calculate what grades are needed' 
      },
    },
    required: ['current_qpi', 'current_units', 'projected_grades'],
  },
};

// Ateneo grading scale (4.0 scale)
const GRADE_POINTS: Record<string, number> = {
  'A': 4.0,
  'A-': 3.7,
  'B+': 3.3,
  'B': 3.0,
  'B-': 2.7,
  'C+': 2.3,
  'C': 2.0,
  'C-': 1.7,
  'D+': 1.3,
  'D': 1.0,
  'F': 0.0,
  'W': -1,  // Withdrawn, not counted
  'S': -1,  // Satisfactory, not counted
  'U': -1,  // Unsatisfactory, not counted
};

// Latin honors thresholds
const HONORS = {
  SUMMA_CUM_LAUDE: { min: 3.87, label: 'Summa Cum Laude' },
  MAGNA_CUM_LAUDE: { min: 3.70, label: 'Magna Cum Laude' },
  CUM_LAUDE: { min: 3.35, label: 'Cum Laude' },
};

interface ProjectedGrade {
  units: number;
  grade: string;
}

export function handler(args: { 
  current_qpi: number; 
  current_units: number;
  projected_grades: ProjectedGrade[];
  target_qpi?: number;
}) {
  const { current_qpi, current_units, projected_grades, target_qpi } = args;
  
  // Calculate current quality points
  const currentQualityPoints = current_qpi * current_units;
  
  // Calculate projected quality points
  let projectedUnits = 0;
  let projectedQualityPoints = 0;
  const gradeBreakdown: { units: number; grade: string; points: number; valid: boolean }[] = [];
  
  for (const pg of projected_grades) {
    const gradeKey = pg.grade.toUpperCase();
    const points = GRADE_POINTS[gradeKey];
    
    if (points === undefined) {
      gradeBreakdown.push({ units: pg.units, grade: pg.grade, points: 0, valid: false });
      continue;
    }
    
    if (points >= 0) {
      projectedUnits += pg.units;
      projectedQualityPoints += points * pg.units;
    }
    
    gradeBreakdown.push({ units: pg.units, grade: pg.grade, points: points >= 0 ? points : 0, valid: true });
  }
  
  // Calculate new cumulative QPI
  const totalUnits = current_units + projectedUnits;
  const totalQualityPoints = currentQualityPoints + projectedQualityPoints;
  const newQpi = totalUnits > 0 ? Math.round((totalQualityPoints / totalUnits) * 1000) / 1000 : 0;
  
  // Calculate semester GPA
  const semesterGpa = projectedUnits > 0 
    ? Math.round((projectedQualityPoints / projectedUnits) * 1000) / 1000 
    : 0;
  
  // Determine honors standing
  let honorsStatus = 'None';
  for (const [, honor] of Object.entries(HONORS)) {
    if (newQpi >= honor.min) {
      honorsStatus = honor.label;
      break;
    }
  }
  
  // Calculate what's needed for target QPI
  let targetAnalysis = null;
  if (target_qpi) {
    const neededQualityPoints = target_qpi * totalUnits;
    const qpDeficit = neededQualityPoints - totalQualityPoints;
    
    if (qpDeficit <= 0) {
      targetAnalysis = {
        target: target_qpi,
        achievable: true,
        message: `You will exceed your target of ${target_qpi} with projected ${newQpi}`
      };
    } else {
      // How many more units at 4.0 needed?
      const unitsNeededAt4 = Math.ceil(qpDeficit / 4.0);
      targetAnalysis = {
        target: target_qpi,
        achievable: false,
        message: `Need ${unitsNeededAt4} more units at A (4.0) to reach ${target_qpi}`,
        current_gap: Math.round((target_qpi - newQpi) * 1000) / 1000
      };
    }
  }
  
  return {
    current: {
      qpi: current_qpi,
      units: current_units,
      quality_points: Math.round(currentQualityPoints * 100) / 100
    },
    projected: {
      semester_gpa: semesterGpa,
      semester_units: projectedUnits,
      grade_breakdown: gradeBreakdown
    },
    result: {
      new_cumulative_qpi: newQpi,
      total_units: totalUnits,
      change: Math.round((newQpi - current_qpi) * 1000) / 1000,
      change_direction: newQpi > current_qpi ? '↑' : newQpi < current_qpi ? '↓' : '→',
      honors_standing: honorsStatus
    },
    target_analysis: targetAnalysis,
    grade_scale: {
      'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
      'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'F': 0.0
    },
    honors_thresholds: HONORS
  };
}
