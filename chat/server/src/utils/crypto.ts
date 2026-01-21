/**
 * AISIS Credential Encryption Utilities
 * 
 * Uses AES-256-GCM for secure credential storage.
 * Credentials are encrypted before being sent to Supabase.
 */

import crypto from 'crypto';

// Encryption key should be 32 bytes for AES-256
// In production, this should be loaded from a secure environment variable
const ENCRYPTION_KEY = process.env.AISIS_ENCRYPTION_KEY || 'sisia_dev_key_32_bytes_long!!!';

// Ensure key is exactly 32 bytes
function getKey(): Buffer {
  const key = Buffer.from(ENCRYPTION_KEY);
  if (key.length < 32) {
    // Pad with zeros if too short (dev only)
    return Buffer.concat([key, Buffer.alloc(32 - key.length)]);
  }
  return key.slice(0, 32);
}

export interface EncryptedData {
  encrypted: string;  // Base64 encoded encrypted data
  iv: string;         // Base64 encoded initialization vector
  authTag: string;    // Base64 encoded GCM auth tag
}

/**
 * Encrypt sensitive data using AES-256-GCM
 */
export function encrypt(plainText: string): EncryptedData {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt data that was encrypted with encrypt()
 */
export function decrypt(data: EncryptedData): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(data.iv, 'base64')
  );
  
  decipher.setAuthTag(Buffer.from(data.authTag, 'base64'));
  
  let decrypted = decipher.update(data.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash password using Argon2
 * (Requires argon2 package to be installed)
 */
export async function hashPassword(password: string): Promise<string> {
  // Dynamic import to avoid issues if argon2 isn't installed yet
  const argon2 = await import('argon2');
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const argon2 = await import('argon2');
  return argon2.verify(hash, password);
}

/**
 * Generate a secure random token (for sessions, etc.)
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
