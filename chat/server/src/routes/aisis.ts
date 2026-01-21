/**
 * AISIS Credential Routes
 * 
 * Manages linking/unlinking of AISIS accounts with encryption.
 */

import { Router, Request, Response } from 'express';
import { createUserClient } from '../utils/supabase.js';
import { encrypt, decrypt, EncryptedData } from '../utils/crypto.js';
import { authMiddleware } from './auth.js';

export const aisisRouter = Router();

// All routes require authentication
aisisRouter.use(authMiddleware);

/**
 * POST /api/aisis/link
 * Link an AISIS account to the user's profile
 * Credentials are encrypted before storage
 */
aisisRouter.post('/link', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'AISIS username and password are required' });
    }
    
    // Encrypt credentials
    const encryptedUsername = encrypt(username);
    const encryptedPassword = encrypt(password);
    
    const userClient = createUserClient(req.user!.accessToken);
    
    // Upsert credential (replace if exists)
    const { data, error } = await userClient
      .from('aisis_credential')
      .upsert({
        user_id: req.user!.id,
        encrypted_username: encryptedUsername.encrypted,
        encrypted_password: encryptedPassword.encrypted,
        iv: `${encryptedUsername.iv}:${encryptedPassword.iv}`,
        auth_tag: `${encryptedUsername.authTag}:${encryptedPassword.authTag}`,
        linked_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single();
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({
      message: 'AISIS account linked successfully',
      linkedAt: data.linked_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/aisis/unlink
 * Remove linked AISIS account
 */
aisisRouter.delete('/unlink', async (req: Request, res: Response) => {
  try {
    const userClient = createUserClient(req.user!.accessToken);
    
    const { error } = await userClient
      .from('aisis_credential')
      .delete()
      .eq('user_id', req.user!.id);
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ message: 'AISIS account unlinked successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/aisis/status
 * Check if AISIS account is linked
 */
aisisRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const userClient = createUserClient(req.user!.accessToken);
    
    const { data } = await userClient
      .from('aisis_credential')
      .select('linked_at, last_used_at')
      .eq('user_id', req.user!.id)
      .single();
    
    res.json({
      linked: !!data,
      linkedAt: data?.linked_at,
      lastUsed: data?.last_used_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Internal helper: Get decrypted AISIS credentials for a user
 * Only used by scraping tools, never exposed via API
 */
export async function getDecryptedCredentials(userId: string, accessToken: string): Promise<{ username: string; password: string } | null> {
  const userClient = createUserClient(accessToken);
  
  const { data } = await userClient
    .from('aisis_credential')
    .select('encrypted_username, encrypted_password, iv, auth_tag')
    .eq('user_id', userId)
    .single();
  
  if (!data) return null;
  
  const [usernameIv, passwordIv] = data.iv.split(':');
  const [usernameAuthTag, passwordAuthTag] = data.auth_tag.split(':');
  
  const username = decrypt({
    encrypted: data.encrypted_username,
    iv: usernameIv,
    authTag: usernameAuthTag,
  });
  
  const password = decrypt({
    encrypted: data.encrypted_password,
    iv: passwordIv,
    authTag: passwordAuthTag,
  });
  
  // Update last_used_at
  await userClient
    .from('aisis_credential')
    .update({ last_used_at: new Date().toISOString() })
    .eq('user_id', userId);
  
  return { username, password };
}
