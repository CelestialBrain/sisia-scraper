/**
 * Get My IPS Tool
 * 
 * Fetches the authenticated user's Individual Plan of Study from AISIS.
 * Uses cached data if available from concurrent fetch.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapePersonalIPS } from '../../scrapers/personalIPS.js';
import { scrapePersonalSchedule } from '../../scrapers/personalSchedule.js';
import { scrapePersonalGrades } from '../../scrapers/personalGrades.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';
import { getOrFetchUserData, getCachedData } from '../../scrapers/aisisDataCache.js';

export const definition = {
  name: 'get_my_ips',
  description: "Get the user's Individual Plan of Study (IPS) from AISIS. Shows passed, in-progress, and remaining courses for their degree.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
    required: [],
  },
};

export async function handler(
  _args: Record<string, unknown>,
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
    const cached = getCachedData(context.userId, 'ips');
    if (cached && !cached.error) {
      console.log('[get_my_ips] Using cached data');
      return cached;
    }
    
    // Trigger concurrent fetch of ALL user data
    console.log('[get_my_ips] Triggering concurrent fetch...');
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
          credentials.password
        );
        return {
          cumulative_qpi: result.qpi_summary?.cumulative_qpi,
          total_grades: result.grades?.length || 0,
          grades: result.grades,
        };
      },
      ips: async () => {
        const result = await scrapePersonalIPS(
          credentials.username,
          credentials.password
        );
        
        // Count actual courses with status data
        const totalCourses = result.courses.length;
        const passedCourses = result.courses.filter(c => c.status === 'passed').length;
        const inProgressCourses = result.courses.filter(c => c.status === 'in_progress').length;
        
        return {
          program: result.program,
          year_level: result.year_level,
          total_units: result.summary.total_units,
          units_taken: result.summary.units_taken,
          remaining_units: result.summary.remaining_units,
          progress_percentage: result.progress_percentage,
          // Explicit course counts to prevent hallucination
          total_courses: totalCourses,
          passed_courses: passedCourses,
          in_progress_courses: inProgressCourses,
          courses_by_year: result.courses_by_year,
          // Anti-hallucination hint
          _strict_data_warning: totalCourses === 0 
            ? 'WARNING: No course data was returned from AISIS. Do NOT invent or assume any courses. Report that course details are unavailable.'
            : `This data contains exactly ${totalCourses} courses. Only report these specific courses. Do NOT add, invent, or assume any other courses.`,
        };
      },
      holds: async () => ({ holds: [], total: 0 }),
      enrolled: async () => ({ message: 'Use schedule data' }),
    });
    
    return userData.ips;
  } catch (error: any) {
    console.error('[get_my_ips] Error:', error.message);
    return { 
      error: 'Failed to fetch IPS from AISIS.',
      details: error.message
    };
  }
}
