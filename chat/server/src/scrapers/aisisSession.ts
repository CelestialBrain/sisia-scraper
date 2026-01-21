/**
 * AISIS Session Helper (Optimized)
 * 
 * Features:
 * - Session caching (30 min TTL) to avoid repeated logins
 * - Login validation
 * - Authenticated fetch wrapper
 */

import * as cheerio from 'cheerio';

const AISIS_BASE = 'https://aisis.ateneo.edu';
const DISPLAY_LOGIN_URL = `${AISIS_BASE}/j_aisis/displayLogin.do`;
const LOGIN_URL = `${AISIS_BASE}/j_aisis/login.do`;

// Session cache: key = username, value = { session, expiry }
const SESSION_CACHE = new Map<string, { 
  cookies: string; 
  expiry: number;
}>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface AISISSession {
  cookies: string;
  fetch: (url: string) => Promise<Response>;
}

/**
 * Get cached session or create new one
 */
export async function loginToAISIS(username: string, password: string): Promise<AISISSession> {
  const cacheKey = username;
  const cached = SESSION_CACHE.get(cacheKey);
  
  // Return cached session if valid
  if (cached && cached.expiry > Date.now()) {
    console.log('[AISIS] Using cached session');
    return createSessionObject(cached.cookies);
  }
  
  // Create new session
  console.log('[AISIS] Creating new session...');
  const cookies = await performLogin(username, password);
  
  // Cache the session
  SESSION_CACHE.set(cacheKey, {
    cookies,
    expiry: Date.now() + SESSION_TTL_MS,
  });
  
  return createSessionObject(cookies);
}

/**
 * Perform AISIS login
 */
async function performLogin(username: string, password: string): Promise<string> {
  console.log('[AISIS] Attempting login for:', username.substring(0, 5) + '***');
  
  // Step 1: GET login page for rnd token
  console.log('[AISIS] Step 1: Fetching login page...');
  const loginPageResponse = await fetch(DISPLAY_LOGIN_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
  });
  
  console.log('[AISIS] Login page status:', loginPageResponse.status);
  
  const setCookies = loginPageResponse.headers.getSetCookie?.() || [];
  let cookies = setCookies.map(c => c.split(';')[0]).join('; ');
  
  const loginPageHtml = await loginPageResponse.text();
  const $ = cheerio.load(loginPageHtml);
  const rndToken = $('input[name="rnd"]').val() as string || '';
  
  console.log('[AISIS] Got rnd token:', rndToken ? 'yes' : 'no');
  
  // Step 2: POST credentials
  console.log('[AISIS] Step 2: Posting credentials...');
  const formData = new URLSearchParams();
  formData.append('userName', username);
  formData.append('password', password);
  formData.append('command', 'login');
  formData.append('rnd', rndToken);
  
  const loginResponse = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': DISPLAY_LOGIN_URL,
    },
    body: formData.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
  });
  
  console.log('[AISIS] Login response status:', loginResponse.status);
  
  // Merge cookies
  const loginCookies = loginResponse.headers.getSetCookie?.() || [];
  if (loginCookies.length > 0) {
    const cookieMap = new Map<string, string>();
    cookies.split('; ').forEach(c => {
      const [name, val] = c.split('=');
      if (name) cookieMap.set(name, val);
    });
    loginCookies.forEach(c => {
      const [nameVal] = c.split(';');
      const [name, val] = nameVal.split('=');
      if (name) cookieMap.set(name, val);
    });
    cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  
  // Verify login
  console.log('[AISIS] Step 3: Verifying login...');
  const verifyResponse = await fetch(`${AISIS_BASE}/j_aisis/J_VMCS.do`, {
    headers: { 'Cookie': cookies },
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
  });
  
  const verifyHtml = await verifyResponse.text();
  if (verifyHtml.includes('displayLogin.do') || verifyHtml.includes('login.do')) {
    console.log('[AISIS] Login verification FAILED');
    throw new Error('AISIS login failed - invalid credentials');
  }
  
  console.log('[AISIS] Login successful');
  return cookies;
}

/**
 * Create session object with authenticated fetch
 */
function createSessionObject(cookies: string): AISISSession {
  return {
    cookies,
    fetch: async (url: string) => {
      return fetch(url, {
        headers: { 'Cookie': cookies },
        signal: AbortSignal.timeout(45000), // 45s timeout for slow AISIS
      });
    },
  };
}

/**
 * Invalidate cached session (call on auth error)
 */
export function invalidateSession(username: string): void {
  SESSION_CACHE.delete(username);
  console.log('[AISIS] Session invalidated for:', username);
}

/**
 * Get session cache stats
 */
export function getSessionStats(): { cached: number; keys: string[] } {
  return {
    cached: SESSION_CACHE.size,
    keys: Array.from(SESSION_CACHE.keys()),
  };
}

/**
 * Parse table rows from AISIS HTML (utility)
 */
export function parseTableRows($: cheerio.CheerioAPI, tableSelector: string) {
  const rows: Array<Record<string, string>> = [];
  
  $(tableSelector).find('tr').each((index, row) => {
    if (index === 0) return;
    
    const cells: string[] = [];
    $(row).find('td').each((_, cell) => {
      cells.push($(cell).text().trim());
    });
    
    if (cells.length > 0) {
      rows.push({ cells: cells.join('|') });
    }
  });
  
  return rows;
}
