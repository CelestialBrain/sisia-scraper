/**
 * Get Syllabus Tool
 * 
 * Retrieves syllabus URLs for enrolled courses.
 * Uses the enrolled classes scraper to find syllabus links.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapeEnrolledClasses, EnrolledClass } from '../../scrapers/enrolledClasses.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';

export const definition = {
  name: 'get_syllabus',
  description: 'Get the syllabus link for YOUR enrolled course. Returns the direct URL to download the syllabus PDF. Requires linked AISIS account.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      course_code: {
        type: SchemaType.STRING,
        description: 'Course code to get syllabus for (e.g., "LLAW 113", "MATH 10")',
      },
    },
    required: ['course_code'],
  },
};

export async function handler(
  args: { course_code?: string },
  context: { userId: string; accessToken: string }
) {
  const credentials = await getDecryptedCredentials(context.userId, context.accessToken);

  if (!credentials) {
    return {
      error: 'AISIS account not linked. Please link your account first.',
      action_required: 'link_aisis',
    };
  }

  const courseCode = (args.course_code || '').toUpperCase().trim();
  
  if (!courseCode) {
    return {
      error: 'Please specify a course code (e.g., "LLAW 113")',
    };
  }

  try {
    const result = await scrapeEnrolledClasses(
      credentials.username,
      credentials.password
    );

    if (!result.classes || result.classes.length === 0) {
      return {
        error: 'No enrolled classes found. Are you enrolled in any courses this semester?',
      };
    }

    // Find matching course (flexible matching)
    const matchedClass = result.classes.find((c: EnrolledClass) => {
      const normalizedInput = courseCode.replace(/\s+/g, ' ');
      const normalizedCode = c.subject_code.replace(/\s+/g, ' ');
      return normalizedCode.includes(normalizedInput) || 
             normalizedInput.includes(normalizedCode) ||
             normalizedCode.startsWith(normalizedInput);
    });

    if (!matchedClass) {
      const availableCourses = result.classes.map((c: EnrolledClass) => c.subject_code).join(', ');
      return {
        error: `Course "${courseCode}" not found in your enrolled classes.`,
        enrolled_courses: availableCourses,
      };
    }

    // Return syllabus info
    if (matchedClass.syllabus_url) {
      return {
        course_code: matchedClass.subject_code,
        section: matchedClass.section,
        course_title: matchedClass.course_title,
        instructor: matchedClass.instructor,
        syllabus_url: matchedClass.syllabus_url,
        available: true,
        message: `Syllabus is available for ${matchedClass.subject_code} ${matchedClass.section}`,
      };
    } else {
      return {
        course_code: matchedClass.subject_code,
        section: matchedClass.section,
        course_title: matchedClass.course_title,
        instructor: matchedClass.instructor,
        syllabus_url: null,
        available: false,
        message: `Syllabus is not yet available for ${matchedClass.subject_code} ${matchedClass.section}`,
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[get_syllabus] Error:', errorMessage);
    return {
      error: 'Failed to retrieve syllabus from AISIS.',
      details: errorMessage,
    };
  }
}
