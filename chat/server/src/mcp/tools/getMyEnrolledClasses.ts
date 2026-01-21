/**
 * Get My Enrolled Classes Tool
 * 
 * Fetches the authenticated user's currently enrolled classes from AISIS.
 * This is the best source for instructor names for personal classes.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapeEnrolledClasses } from '../../scrapers/enrolledClasses.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';

export const definition = {
  name: 'get_my_enrolled_classes',
  description: 'Get YOUR enrolled classes with instructor names, section, and delivery mode. IMPORTANT: Use together with get_my_schedule for complete schedule data - this tool has accurate instructor names while get_my_schedule has times and rooms.',
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
    const result = await scrapeEnrolledClasses(
      credentials.username,
      credentials.password
    );
    
    return {
      term: result.term,
      total_classes: result.classes.length,
      classes: result.classes.map(c => ({
        course: c.subject_code,
        section: c.section,
        title: c.course_title,
        instructor: c.instructor,
        delivery: c.delivery_mode,
      })),
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[get_my_enrolled_classes] Error:', errorMessage);
    return { 
      error: 'Failed to fetch enrolled classes from AISIS.',
      details: errorMessage
    };
  }
}
