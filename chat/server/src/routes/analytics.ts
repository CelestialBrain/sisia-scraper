/**
 * Analytics Routes
 * 
 * Handles analytics and usage statistics endpoints.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabase.js';
import { getUsageInfo } from '../utils/usage.js';

export const analyticsRouter = Router();

// API Usage endpoint (real-time memory stats)
analyticsRouter.get('/usage', (req: Request, res: Response) => {
  res.json(getUsageInfo());
});

// Analytics endpoint (historical data from Supabase)
analyticsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { days = '7' } = req.query;
    const daysAgo = parseInt(days as string, 10);
    const since = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    
    // Get total messages
    const { count: totalMessages } = await supabaseAdmin
      .from('chat_message')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since);
    
    // Get messages by role
    const { data: byRole } = await supabaseAdmin
      .from('chat_message')
      .select('role')
      .gte('created_at', since);
    
    const roleCount = byRole?.reduce((acc: Record<string, number>, m: { role: string }) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Get unique sessions
    const { data: sessions } = await supabaseAdmin
      .from('chat_message')
      .select('session_id')
      .gte('created_at', since);
    
    const uniqueSessions = new Set(sessions?.map((s: { session_id: string }) => s.session_id)).size;
    
    // Get intents breakdown
    const { data: intents } = await supabaseAdmin
      .from('chat_message')
      .select('intent')
      .not('intent', 'is', null)
      .gte('created_at', since);
    
    const intentCount = intents?.reduce((acc: Record<string, number>, m: { intent: string }) => {
      acc[m.intent] = (acc[m.intent] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};
    
    // Get tool usage
    const { data: toolMessages } = await supabaseAdmin
      .from('chat_message')
      .select('tool_calls')
      .not('tool_calls', 'is', null)
      .gte('created_at', since);
    
    const toolUsage: Record<string, number> = {};
    toolMessages?.forEach((m: { tool_calls: Array<{ name: string }> }) => {
      if (m.tool_calls) {
        m.tool_calls.forEach((tc: { name: string }) => {
          toolUsage[tc.name] = (toolUsage[tc.name] || 0) + 1;
        });
      }
    });
    
    // Get token totals
    const { data: tokenData } = await supabaseAdmin
      .from('chat_message')
      .select('token_count')
      .not('token_count', 'is', null)
      .gte('created_at', since);
    
    const totalTokens = tokenData?.reduce((sum: number, m: { token_count: number }) => 
      sum + (m.token_count || 0), 0) || 0;
    
    // Get daily breakdown
    const { data: dailyData } = await supabaseAdmin
      .from('chat_message')
      .select('created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    
    const dailyMessages: Record<string, number> = {};
    dailyData?.forEach((m: { created_at: string }) => {
      const date = m.created_at.split('T')[0];
      dailyMessages[date] = (dailyMessages[date] || 0) + 1;
    });
    
    res.json({
      period: { days: daysAgo, since },
      totals: {
        messages: totalMessages || 0,
        userMessages: roleCount['user'] || 0,
        assistantMessages: roleCount['assistant'] || 0,
        uniqueSessions,
        estimatedTokens: totalTokens,
      },
      byIntent: intentCount,
      toolUsage: Object.entries(toolUsage)
        .sort((a, b) => b[1] - a[1])
        .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {}),
      dailyMessages,
      realTimeUsage: getUsageInfo(),
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});
