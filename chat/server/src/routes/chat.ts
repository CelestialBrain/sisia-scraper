/**
 * Chat Routes
 * 
 * Handles public and authenticated chat endpoints.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Database from 'better-sqlite3';

import { handleFunctionCall, publicDefinitions, definitions } from '../mcp/tools/index.js';
import { authMiddleware } from './auth.js';
import { getSystemPromptBase, SYSTEM_PROMPT_PERSONAL } from '../prompts/system.js';
import { trackUsage } from '../utils/usage.js';
import { logMessage } from '../utils/logging.js';
import { wsServer } from '../../websocket.js';

// AI Configuration
export const AI_CONFIG = {
  model: 'gemini-2.0-flash',
  temperature: 0.1,
  maxOutputTokens: 2048,
  topP: 0.7,
  topK: 20,
};

// Max context tokens for Gemini 2.0 Flash
const MAX_CONTEXT_TOKENS = 1048576;

export function createChatRouter(genAI: GoogleGenerativeAI, db: Database.Database) {
  const router = Router();

  // Generate session ID if not provided
  function getSessionId(req: Request): string {
    return req.headers['x-session-id'] as string || 
           `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Public chat endpoint (no auth required, only public tools)
  router.post('/', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    
    try {
      const { message, history = [] } = req.body;
      
      // Log user message
      await logMessage(sessionId, null, { role: 'user', content: message });
      
      const model = genAI.getGenerativeModel({ 
        model: AI_CONFIG.model,
        systemInstruction: getSystemPromptBase(),
        tools: [{ functionDeclarations: publicDefinitions as any }],
        generationConfig: {
          temperature: AI_CONFIG.temperature,
          maxOutputTokens: AI_CONFIG.maxOutputTokens,
          topP: AI_CONFIG.topP,
          topK: AI_CONFIG.topK,
        },
      });
      
      const chat = model.startChat({
        history: history.map((msg: { role: string; content: string }) => ({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }],
        })),
      });
      
      let response = await chat.sendMessage(message);
      let result = response.response;
      
      // Track tool calls for logging with duration
      const toolCallLog: Array<{ name: string; args: unknown; result: unknown; durationMs: number }> = [];
      
      // Handle function calls
      let functionCalls = result.functionCalls();
      while (functionCalls && functionCalls.length > 0) {
        const functionResponses = [];
        
        for (const call of functionCalls) {
          // Stream function call to debug subscribers
          wsServer.streamLog('function', `Calling ${call.name}`, { args: call.args });
          
          const startTime = Date.now();
          const functionResult = await handleFunctionCall(call.name, call.args as Record<string, unknown>);
          const durationMs = Date.now() - startTime;
          
          // Stream result
          wsServer.streamLog('result', `${call.name} completed in ${durationMs}ms`, { 
            durationMs,
            resultPreview: typeof functionResult === 'object' 
              ? Object.keys(functionResult as object).join(', ')
              : String(functionResult).slice(0, 100)
          });
          
          toolCallLog.push({
            name: call.name,
            args: call.args,
            result: functionResult,
            durationMs,
          });
          
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: functionResult,
            },
          });
        }
        
        response = await chat.sendMessage(functionResponses as any);
        result = response.response;
        functionCalls = result.functionCalls();
      }
      
      const text = result.text();
      
      // Track API usage (estimate tokens: ~4 chars per token)
      const estimatedTokens = Math.ceil((message.length + text.length) / 4);
      trackUsage(estimatedTokens);
      
      // Log assistant response
      await logMessage(sessionId, null, { 
        role: 'assistant', 
        content: text,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
      });
      
      res.json({ 
        response: text, 
        sessionId,
        debug: {
          toolsCalled: toolCallLog,
          tokensUsed: {
            prompt: Math.ceil(message.length / 4),
            response: Math.ceil(text.length / 4),
            total: estimatedTokens,
          },
          historyLength: history.length,
          model: AI_CONFIG.model,
          timestamp: new Date().toISOString(),
        }
      });
      
    } catch (error: unknown) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Authenticated chat endpoint (full tools including personal)
  router.post('/personal', authMiddleware, async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const userId = req.user!.id;
    
    try {
      const { message, history = [] } = req.body;
      
      // CRITICAL: Limit chat history to prevent context overflow and hallucination
      // Keep last 100 messages (50 exchanges) - Gemini 2.0 Flash has 1M token context
      const trimmedHistory = history.slice(-100);
      
      // Log user message
      await logMessage(sessionId, userId, { role: 'user', content: message });
      
      // Build enhanced prompt with user context
      const enhancedPrompt = getSystemPromptBase() + SYSTEM_PROMPT_PERSONAL;
      
      const model = genAI.getGenerativeModel({ 
        model: AI_CONFIG.model,
        systemInstruction: enhancedPrompt,
        tools: [{ functionDeclarations: definitions as any }],
        generationConfig: {
          temperature: AI_CONFIG.temperature,
          maxOutputTokens: AI_CONFIG.maxOutputTokens,
          topP: AI_CONFIG.topP,
          topK: AI_CONFIG.topK,
        },
      });
      
      const chat = model.startChat({
        history: trimmedHistory.map((msg: { role: string; content: string }) => ({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }],
        })),
      });
      
      let response = await chat.sendMessage(message);
      let result = response.response;
      
      // Track tool calls for logging with duration
      const toolCallLog: Array<{ name: string; args: unknown; result: unknown; durationMs: number }> = [];
      
      // Handle function calls with user context
      let functionCalls = result.functionCalls();
      while (functionCalls && functionCalls.length > 0) {
        const functionResponses = [];
        
        for (const call of functionCalls) {
          // Stream function call to debug subscribers
          wsServer.streamLog('function', `Calling ${call.name} (personal)`, { args: call.args });
          
          const startTime = Date.now();
          const functionResult = await handleFunctionCall(
            call.name, 
            call.args as Record<string, unknown>,
            { userId: req.user!.id, accessToken: req.user!.accessToken }
          );
          const durationMs = Date.now() - startTime;
          
          // Stream result
          wsServer.streamLog('result', `${call.name} completed in ${durationMs}ms`, { 
            durationMs,
            resultPreview: typeof functionResult === 'object' 
              ? Object.keys(functionResult as object).join(', ')
              : String(functionResult).slice(0, 100)
          });
          
          toolCallLog.push({
            name: call.name,
            args: call.args,
            result: functionResult,
            durationMs,
          });
          
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: functionResult,
            },
          });
        }
        
        response = await chat.sendMessage(functionResponses as any);
        result = response.response;
        functionCalls = result.functionCalls();
      }
      
      const text = result.text();
      
      // Get real token usage from Gemini API response
      const usageMetadata = response.response.usageMetadata;
      const tokensUsed = usageMetadata?.totalTokenCount || 0;
      const promptTokens = usageMetadata?.promptTokenCount || 0;
      const responseTokens = usageMetadata?.candidatesTokenCount || 0;
      
      // Track API usage with real token count
      trackUsage(tokensUsed);
      
      // Log assistant response with token count
      await logMessage(sessionId, userId, { 
        role: 'assistant', 
        content: text,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
        tokenCount: tokensUsed,
      });
      
      // Return response with token usage for frontend context bar
      res.json({ 
        response: text, 
        sessionId,
        tokenUsage: {
          promptTokens,
          responseTokens,
          totalTokens: tokensUsed,
          maxTokens: MAX_CONTEXT_TOKENS,
          usagePercent: Math.round((tokensUsed / MAX_CONTEXT_TOKENS) * 100 * 100) / 100,
        },
        debug: {
          toolsCalled: toolCallLog,
          tokensUsed: {
            prompt: promptTokens,
            response: responseTokens,
            total: tokensUsed,
          },
          historyLength: trimmedHistory.length,
          model: AI_CONFIG.model,
          timestamp: new Date().toISOString(),
        }
      });
      
    } catch (error: unknown) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get chat history for a session
  router.get('/history/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { supabaseAdmin } = await import('../utils/supabase.js');
      
      const { data, error } = await supabaseAdmin
        .from('chat_message')
        .select('role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({ 
        sessionId,
        messages: data || [],
        count: data?.length || 0,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Streaming chat endpoint (Server-Sent Events)
  router.post('/stream', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
      const { message, history = [] } = req.body;
      
      const model = genAI.getGenerativeModel({ 
        model: AI_CONFIG.model,
        systemInstruction: getSystemPromptBase(),
        tools: [{ functionDeclarations: publicDefinitions as unknown[] }],
        generationConfig: {
          temperature: AI_CONFIG.temperature,
          maxOutputTokens: AI_CONFIG.maxOutputTokens,
          topP: AI_CONFIG.topP,
          topK: AI_CONFIG.topK,
        },
      });
      
      // Use history for context
      const chat = model.startChat({
        history: history.map((msg: { role: string; content: string }) => ({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }],
        })),
      });
      
      // Use streaming
      const streamResult = await chat.sendMessageStream(message);
      
      let fullText = '';
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          res.write(`data: ${JSON.stringify({ text, done: false })}\n\n`);
        }
      }
      
      // Log the complete message
      await logMessage(sessionId, null, { role: 'user', content: message });
      await logMessage(sessionId, null, { role: 'assistant', content: fullText });
      
      res.write(`data: ${JSON.stringify({ text: '', done: true, sessionId })}\n\n`);
      res.end();
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.write(`data: ${JSON.stringify({ error: errorMessage, done: true })}\n\n`);
      res.end();
    }
  });

  return router;
}
