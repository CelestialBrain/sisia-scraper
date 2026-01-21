/**
 * Get My Grades Tool
 * 
 * Fetches the authenticated user's grades from AISIS.
 * Uses cached data if available from concurrent fetch.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapePersonalGrades } from '../../scrapers/personalGrades.js';
import { scrapePersonalSchedule } from '../../scrapers/personalSchedule.js';
import { scrapePersonalIPS } from '../../scrapers/personalIPS.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';
import { getOrFetchUserData, getCachedData } from '../../scrapers/aisisDataCache.js';

export const definition = {
  name: 'get_my_grades',
  description: 'Get the user\'s grades and QPI from AISIS. Returns all grades by semester with cumulative QPI.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      term: { 
        type: SchemaType.STRING, 
        description: 'Optional term code (e.g., "2024-2" for 2nd sem 2024-2025). Leave empty for all grades.' 
      },
    },
    required: [],
  },
};

export async function handler(
  args: { term?: string },
  context: { userId: string; accessToken: string }
) {
  const credentials = await getDecryptedCredentials(context.userId, context.accessToken);
  
  if (!credentials) {
    return { 
      error: 'AISIS account not linked. Please link your account first.',
      action_required: 'link_aisis'
    };
  }
  
  try {
    // Check cache first
    const cached = getCachedData(context.userId, 'grades');
    if (cached && !cached.error) {
      console.log('[get_my_grades] Using cached data');
      
      // Filter by term if specified
      if (args.term && cached.grades) {
        const filtered = cached.grades.filter((g: any) => 
          g.school_year === args.term || g.semester === args.term
        );
        return { ...cached, grades: filtered, total_grades: filtered.length };
      }
      return cached;
    }
    
    // Trigger concurrent fetch of ALL user data
    console.log('[get_my_grades] Triggering concurrent fetch...');
    const userData = await getOrFetchUserData(context.userId, {
      schedule: async () => {
        const result = await scrapePersonalSchedule(
          credentials.username,
          credentials.password
        );
        return {
          term: result.term,
          schedule: result.schedule,
          weekly_grid: result.weekly_grid,
          total_classes: result.schedule.length,
        };
      },
      grades: async () => {
        const result = await scrapePersonalGrades(
          credentials.username,
          credentials.password,
          args.term
        );
        
        // Find lowest grade
        const numericGrades = result.grades
          .filter((g: any) => !isNaN(parseFloat(g.final_grade)) && parseFloat(g.final_grade) > 0)
          .sort((a: any, b: any) => parseFloat(b.final_grade) - parseFloat(a.final_grade));
        
        const lowestGrade = numericGrades.length > 0 ? numericGrades[0] : null;
        
        return {
          cumulative_qpi: result.qpi_summary.cumulative_qpi,
          total_units: result.qpi_summary.total_units,
          total_grades: result.grades.length,
          grades: result.grades.map((g: any) => ({
            subject: g.subject_code,
            title: g.course_title,
            units: g.units,
            grade: g.final_grade,
            school_year: g.school_year,
            semester: g.semester,
          })),
          lowest_grade: lowestGrade ? {
            subject: lowestGrade.subject_code,
            title: lowestGrade.course_title,
            grade: lowestGrade.final_grade,
          } : null,
          available_terms: result.terms,
        };
      },
      ips: async () => {
        const result = await scrapePersonalIPS(
          credentials.username,
          credentials.password
        );
        return result;
      },
      holds: async () => ({ holds: [], total: 0 }),
      enrolled: async () => ({ message: 'Use schedule data' }),
    });
    
    return userData.grades;
  } catch (error: any) {
    console.error('[get_my_grades] Error:', error.message);
    return { 
      error: 'Failed to fetch grades from AISIS.',
      details: error.message
    };
  }
}
