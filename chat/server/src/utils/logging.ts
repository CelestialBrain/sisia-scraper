/**
 * Message Logging
 * 
 * Logs chat messages to Supabase with intent detection and entity extraction.
 */

import { supabaseAdmin } from './supabase.js';

export interface LoggedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: Array<{ name: string; args: unknown; result: unknown }>;
  latencyMs?: number;
  intent?: string;
  entities?: Array<{ type: string; value: string }>;
  tokenCount?: number;
}

// Simple intent detection from tool calls
export function detectIntent(toolCalls: Array<{ name: string }> | undefined): string | null {
  if (!toolCalls || toolCalls.length === 0) return null;
  
  const toolName = toolCalls[0].name;
  const intentMap: Record<string, string> = {
    'get_my_schedule': 'personal_schedule',
    'get_my_grades': 'personal_grades',
    'get_my_ips': 'personal_ips',
    'get_my_hold_orders': 'personal_holds',
    'search_courses': 'course_search',
    'get_course_sections': 'section_lookup',
    'search_instructors': 'instructor_search',
    'get_instructor_schedule': 'instructor_schedule',
    'get_room_schedule': 'room_schedule',
    'get_curriculum': 'curriculum_lookup',
    'build_schedule': 'schedule_builder',
    'search_by_natural_time': 'time_search',
  };
  
  return intentMap[toolName] || 'general';
}

// Extract entities from tool args
export function extractEntities(toolCalls: Array<{ name: string; args: unknown }> | undefined): Array<{ type: string; value: string }> {
  if (!toolCalls) return [];
  
  const entities: Array<{ type: string; value: string }> = [];
  
  for (const call of toolCalls) {
    const args = call.args as Record<string, unknown>;
    if (args.course_code) entities.push({ type: 'course', value: String(args.course_code) });
    if (args.instructor_name) entities.push({ type: 'instructor', value: String(args.instructor_name) });
    if (args.room_name) entities.push({ type: 'room', value: String(args.room_name) });
    if (args.term) entities.push({ type: 'term', value: String(args.term) });
  }
  
  return entities;
}

export async function logMessage(
  sessionId: string,
  userId: string | null,
  message: LoggedMessage
): Promise<void> {
  try {
    const intent = message.role === 'assistant' ? detectIntent(message.toolCalls) : null;
    const entities = message.role === 'assistant' ? extractEntities(message.toolCalls) : [];
    
    const { error } = await supabaseAdmin
      .from('chat_message')
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: message.role,
        content: message.content,
        tool_calls: message.toolCalls || null,
        latency_ms: message.latencyMs || null,
        intent,
        entities: entities.length > 0 ? entities : null,
        token_count: message.tokenCount || null,
      });
    
    if (error) {
      console.warn('[LogMessage] Failed to log:', error.message);
    }
  } catch (err) {
    console.warn('[LogMessage] Error:', err);
  }
}
