/**
 * General Chat Tool (Catch-All)
 * 
 * Handles generic queries that don't match specific tools.
 * Used with FunctionCallingMode.ANY to ensure every query triggers a tool.
 */

import { SchemaType } from '@google/generative-ai';

export const definition = {
  name: 'general_chat',
  description: 'Handle greetings, general questions, capabilities inquiry, or any query that does not match a specific tool. Use this when the user says hi, asks what you can do, or makes general conversation.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query_type: {
        type: SchemaType.STRING,
        description: 'Type of query: "greeting", "capabilities", "thanks", "clarification", "other"',
      },
      user_message: {
        type: SchemaType.STRING,
        description: 'The user message being responded to',
      },
    },
    required: ['query_type'],
  },
};

export async function handler(
  args: { query_type: string; user_message?: string }
) {
  const capabilities = {
    course_schedule: [
      'search_courses - Search for courses by code, title, or department',
      'get_course_sections - Get all sections of a specific course',
      'compare_sections - Compare sections by slots, time, or instructor',
      'build_schedule - Generate conflict-free schedules',
      'check_conflicts - Check if courses have schedule conflicts',
    ],
    personal_aisis: [
      'get_my_schedule - Your personal class schedule',
      'get_my_grades - Your grades and QPI',
      'get_my_ips - Your Individual Plan of Study progress',
      'get_my_enrolled_classes - Your enrolled classes with instructors',
      'get_my_hold_orders - Check for any holds on your account',
    ],
    instructors: [
      'search_instructors - Find instructors by name',
      'get_instructor_schedule - See what an instructor teaches',
      'get_professor_feedback - Get student reviews of a professor',
      'compare_instructors - Compare instructors for a course',
    ],
    rooms_facilities: [
      'get_room_schedule - See schedule for a specific room',
      'find_free_rooms - Find available rooms at a specific time',
      'get_room_stats - Room usage statistics',
    ],
    academic_policies: [
      'get_grading_system - Ateneo grading scale and QPI calculation',
      'get_qpi_requirements - QPI requirements for promotion/graduation',
      'get_honors_requirements - Latin honors and Dean\'s List requirements',
      'search_rules - Search student handbook rules',
    ],
    curriculum: [
      'get_curriculum - View program curriculum by year/semester',
      'get_prerequisites - Get prerequisites for a course',
      'list_programs - List available degree programs',
    ],
  };

  switch (args.query_type) {
    case 'greeting':
      return {
        response_type: 'greeting',
        message: 'Hello! I\'m SISIA, your Ateneo student assistant.',
        suggestion: 'Ask me about courses, schedules, grades, professors, or academic policies.',
      };
    
    case 'capabilities':
      return {
        response_type: 'capabilities',
        message: 'Here\'s what I can help you with:',
        capabilities,
        suggestion: 'Try asking: "What\'s my schedule?", "Search for CSCI courses", or "Who is Prof. Garcia?"',
      };
    
    case 'thanks':
      return {
        response_type: 'thanks',
        message: 'You\'re welcome! Let me know if you need anything else.',
      };
    
    case 'clarification':
      return {
        response_type: 'clarification',
        message: 'I\'m not sure what you\'re asking. Could you be more specific?',
        suggestion: 'Try asking about: your schedule, grades, course search, professor info, or academic policies.',
      };
    
    default:
      return {
        response_type: 'general',
        message: 'I can help with Ateneo course info, schedules, grades, and academic policies.',
        capabilities: Object.keys(capabilities),
        suggestion: 'What would you like to know?',
      };
  }
}
