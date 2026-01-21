/**
 * Authentication Routes
 * 
 * Handles user registration, login, and session management using Supabase Auth.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin, createUserClient } from '../utils/supabase.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export const authRouter = Router();

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        accessToken: string;
      };
    }
  }
}

/**
 * Auth middleware - validates JWT and attaches user to request
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  
  const token = authHeader.slice(7);
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    req.user = {
      id: user.id,
      email: user.email || '',
      accessToken: token,
    };
    
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /api/auth/register
 * Register a new user with email/password
 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({
      message: 'Registration successful',
      user: { id: data.user?.id, email: data.user?.email },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Login with email/password
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      return res.status(401).json({ error: error.message });
    }
    
    res.json({
      message: 'Login successful',
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
      expiresIn: data.session?.expires_in,
      user: { id: data.user?.id, email: data.user?.email },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * Logout current user
 */
authRouter.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
authRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    
    if (error) {
      return res.status(401).json({ error: error.message });
    }
    
    res.json({
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
      expiresIn: data.session?.expires_in,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
authRouter.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userClient = createUserClient(req.user!.accessToken);
    
    // Check if user has linked AISIS account
    const { data: credential } = await userClient
      .from('aisis_credential')
      .select('linked_at, last_used_at')
      .eq('user_id', req.user!.id)
      .single();
    
    res.json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        aisisLinked: !!credential,
        aisisLinkedAt: credential?.linked_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
