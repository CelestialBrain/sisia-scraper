/**
 * Get My Schedule Tool
 * 
 * Fetches the authenticated user's personal class schedule from AISIS.
 * Triggers concurrent fetch of ALL user data on first access for caching.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapePersonalSchedule } from '../../scrapers/personalSchedule.js';
import { scrapePersonalGrades } from '../../scrapers/personalGrades.js';
import { scrapePersonalIPS } from '../../scrapers/personalIPS.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';
import { getOrFetchUserData, getCachedData } from '../../scrapers/aisisDataCache.js';

export const definition = {
  name: 'get_my_schedule',
  description: 'Get YOUR personal class schedule from AISIS. Returns: course code, section, room/location, instructor, day, time, and delivery mode (FULLY ONSITE, ONLINE, etc). Can fetch historical semesters by providing a term code. Requires linked AISIS account.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      term: { 
        type: SchemaType.STRING, 
        description: 'Term code for historical schedule. Format: YYYY-S where S is 1=First Sem, 2=Second Sem, 0=Intersession (e.g., "2025-1" for First Semester 2025-2026). Default: current term.' 
      },
    },
    required: [],
  },
};

export async function handler(
  args: { term?: string },
  context: { userId: string; accessToken: string }
) {
  // Get decrypted credentials
  const credentials = await getDecryptedCredentials(context.userId, context.accessToken);
  
  if (!credentials) {
    return { 
      error: 'AISIS account not linked. Please link your account first.',
      action_required: 'link_aisis'
    };
  }
  
  try {
    // If requesting a specific term, bypass cache and fetch directly
    if (args.term) {
      console.log(`[get_my_schedule] Fetching historical term: ${args.term}`);
      const result = await scrapePersonalSchedule(
        credentials.username,
        credentials.password,
        args.term
      );
      return {
        term: result.term,
        schedule: result.schedule,
        weekly_grid: result.weekly_grid,
        total_classes: result.schedule.length,
        available_terms: result.available_terms,
      };
    }
    
    // Check cache first for current term
    const cached = getCachedData(context.userId, 'schedule');
    if (cached && !cached.error) {
      console.log('[get_my_schedule] Using cached data');
      return cached;
    }
    
    // Trigger concurrent fetch of ALL user data
    console.log('[get_my_schedule] Triggering concurrent fetch...');
    const userData = await getOrFetchUserData(context.userId, {
      schedule: async () => {
        const result = await scrapePersonalSchedule(
          credentials.username,
          credentials.password,
          args.term
        );
        return {
          term: result.term,
          schedule: result.schedule,
          weekly_grid: result.weekly_grid,
          total_classes: result.schedule.length,
          available_terms: result.available_terms,
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
        return result;
      },
      holds: async () => {
        // Placeholder - holds scraper not implemented yet
        return { holds: [], total: 0 };
      },
      enrolled: async () => {
        // Uses schedule data for enrolled classes
        return { message: 'Use schedule data' };
      },
    });
    
    return userData.schedule;
  } catch (error: any) {
    return { 
      error: 'Failed to fetch schedule. Your AISIS session may have expired.',
      details: error.message
    };
  }
}
