/**
 * HTTP-based AISIS Authentication Module
 * Pure HTTP requests - no browser needed!
 * 
 * Based on n8n workflow pattern:
 * 1. GET /displayLogin.do → extract rnd token + JSESSIONID
 * 2. POST /login.do → get authenticated session
 * 3. Use cookies for subsequent requests
 */

const BASE_URL = 'https://aisis.ateneo.edu/j_aisis';

export interface HTTPSession {
  cookies: string;
  jsessionid: string;
  rnd: string;
  authenticated: boolean;
}

/**
 * Parse Set-Cookie header(s) into cookie string
 */
function parseCookies(headers: Headers): string {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return '';
  
  // Handle multiple cookies (may be semicolon separated in single header)
  return setCookie
    .split(',')
    .map(cookie => cookie.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ');
}

/**
 * Merge existing cookies with new ones
 */
function mergeCookies(existing: string, newCookies: string): string {
  const cookieMap = new Map<string, string>();
  
  for (const cookie of existing.split('; ').filter(c => c)) {
    const [name] = cookie.split('=');
    if (name) cookieMap.set(name.trim(), cookie);
  }
  
  for (const cookie of newCookies.split('; ').filter(c => c)) {
    const [name] = cookie.split('=');
    if (name) cookieMap.set(name.trim(), cookie);
  }
  
  return Array.from(cookieMap.values()).join('; ');
}

/**
 * Extract rnd token from login page HTML
 */
function extractRndToken(html: string): string | null {
  const patterns = [
    /name\s*=\s*["']?rnd["']?\s+value\s*=\s*["']?([^"'\s>]+)["']?/i,
    /value\s*=\s*["']?([^"'\s>]+)["']?\s+name\s*=\s*["']?rnd["']?/i,
    /<input[^>]+name\s*=\s*["']rnd["'][^>]+value\s*=\s*["']([^"']+)["']/i,
    /<input[^>]+value\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']rnd["']/i,
    /name=rnd\s+value=([a-z0-9]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  
  return null;
}

/**
 * Authenticate with AISIS using pure HTTP
 */
export async function httpLogin(username: string, password: string): Promise<HTTPSession> {
  console.log('🔐 Authenticating with AISIS (HTTP)...');
  
  // Step 1: GET login page to extract rnd token and initial cookies
  const loginPageRes = await fetch(`${BASE_URL}/displayLogin.do`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'manual',
  });
  
  let cookies = parseCookies(loginPageRes.headers);
  const loginHtml = await loginPageRes.text();
  
  const rnd = extractRndToken(loginHtml);
  if (!rnd) {
    throw new Error('Could not extract rnd token from login page');
  }
  
  console.log(`  ✓ Got rnd token: ${rnd.substring(0, 8)}...`);
  
  // Step 2: POST login credentials
  const formData = new URLSearchParams({
    userName: username,
    password: password,
    command: 'login',
    submit: 'Sign in',
    rnd: rnd,
  });
  
  const loginRes = await fetch(`${BASE_URL}/login.do`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': `${BASE_URL}/displayLogin.do`,
    },
    body: formData.toString(),
    redirect: 'manual',
  });
  
  // Merge cookies from login response
  const newCookies = parseCookies(loginRes.headers);
  cookies = mergeCookies(cookies, newCookies);
  
  // Extract JSESSIONID
  const jsessionMatch = cookies.match(/JSESSIONID=([^;]+)/);
  const jsessionid = jsessionMatch ? jsessionMatch[1] : '';
  
  // Step 3: Verify login by checking redirect or welcome page
  const welcomeRes = await fetch(`${BASE_URL}/welcome.do`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookies,
    },
    redirect: 'manual',
  });
  
  // Merge any new cookies
  cookies = mergeCookies(cookies, parseCookies(welcomeRes.headers));
  
  const welcomeHtml = await welcomeRes.text();
  const authenticated = welcomeHtml.includes('Welcome') || 
                        welcomeHtml.includes('User Identified') ||
                        !welcomeHtml.includes('displayLogin');
  
  if (!authenticated) {
    throw new Error('Login failed - invalid credentials or session');
  }
  
  console.log('✅ Authentication successful!');
  
  return {
    cookies,
    jsessionid,
    rnd,
    authenticated,
  };
}

/**
 * Make an authenticated HTTP request
 */
export async function httpGet(url: string, session: HTTPSession): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cookie': session.cookies,
      'Referer': `${BASE_URL}/welcome.do`,
    },
    redirect: 'follow',
  });
  
  return response.text();
}

/**
 * Make an authenticated POST request (for form submissions)
 */
export async function httpPost(
  url: string, 
  session: HTTPSession, 
  formData: Record<string, string>
): Promise<string> {
  const body = new URLSearchParams(formData).toString();
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cookie': session.cookies,
      'Referer': `${BASE_URL}/welcome.do`,
    },
    body,
    redirect: 'follow',
  });
  
  return response.text();
}

export const AISIS_URLS = {
  BASE: BASE_URL,
  LOGIN_PAGE: `${BASE_URL}/displayLogin.do`,
  LOGIN_ACTION: `${BASE_URL}/login.do`,
  WELCOME: `${BASE_URL}/welcome.do`,
  SCHEDULE: `${BASE_URL}/J_VCSC.do`,
  CURRICULUM: `${BASE_URL}/J_VOFC.do`,
  PERSONAL_SCHEDULE: `${BASE_URL}/J_VMCS.do`,
};
