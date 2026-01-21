/**
 * Auth Context & Provider
 * 
 * Manages user authentication state throughout the app.
 * Implements auto-refresh to keep sessions alive.
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  aisisLinked?: boolean;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  linkAisis: (username: string, password: string) => Promise<void>;
  unlinkAisis: () => Promise<void>;
  checkAisisStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = 'http://localhost:6102/api';

// Refresh 5 minutes before expiry
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending refresh timeout
  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  // Logout function - defined early for use in refreshSession
  const performLogout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }, []);

  // Schedule next token refresh using a ref to avoid circular deps
  const scheduleRefreshRef = useRef<(expiresInSeconds: number) => void>(() => {});

  // Refresh the session using refresh token
  const refreshSession = useCallback(async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem('refreshToken');
    
    if (!refreshToken) {
      console.log('[Auth] No refresh token available');
      return false;
    }
    
    try {
      console.log('[Auth] Refreshing session...');
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      
      if (!res.ok) {
        console.error('[Auth] Refresh failed, logging out');
        clearRefreshTimeout();
        performLogout();
        return false;
      }
      
      const data = await res.json();
      
      // Update tokens
      setAccessToken(data.accessToken);
      localStorage.setItem('accessToken', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      
      // Schedule next refresh
      if (data.expiresIn) {
        scheduleRefreshRef.current(data.expiresIn);
      }
      
      console.log('[Auth] Session refreshed successfully');
      return true;
    } catch (err) {
      console.error('[Auth] Refresh error:', err);
      return false;
    }
  }, [clearRefreshTimeout, performLogout]);

  // Now set up the scheduleRefresh function
  useEffect(() => {
    scheduleRefreshRef.current = (expiresInSeconds: number) => {
      clearRefreshTimeout();
      
      // Calculate when to refresh (before expiry)
      const refreshInMs = Math.max(
        (expiresInSeconds * 1000) - REFRESH_MARGIN_MS,
        60000 // At minimum, wait 1 minute
      );
      
      console.log(`[Auth] Token refresh scheduled in ${Math.round(refreshInMs / 60000)} minutes`);
      
      refreshTimeoutRef.current = setTimeout(() => {
        refreshSession();
      }, refreshInMs);
    };
  }, [clearRefreshTimeout, refreshSession]);

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');
      const storedRefresh = localStorage.getItem('refreshToken');
      
      if (storedToken && storedUser) {
        setAccessToken(storedToken);
        setUser(JSON.parse(storedUser));
        
        // Try to verify/refresh the token
        if (storedRefresh) {
          const refreshed = await refreshSession();
          if (!refreshed) {
            // Token expired and couldn't refresh - clear everything
            performLogout();
          }
        }
      }
      setIsLoading(false);
    };
    
    initAuth();
    
    return () => clearRefreshTimeout();
  }, [refreshSession, clearRefreshTimeout, performLogout]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    
    setUser(data.user);
    setAccessToken(data.accessToken);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken || '');
    localStorage.setItem('user', JSON.stringify(data.user));
    
    // Schedule token refresh
    if (data.expiresIn) {
      scheduleRefreshRef.current(data.expiresIn);
    }
  };

  const register = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    
    // Auto-login after registration
    await login(email, password);
  };

  const logout = async () => {
    clearRefreshTimeout();
    
    if (accessToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      }).catch(() => {}); // Ignore logout errors
    }
    
    performLogout();
  };

  const linkAisis = async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/aisis/link`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ username, password }),
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to link AISIS');
    
    setUser(prev => prev ? { ...prev, aisisLinked: true } : null);
  };

  const unlinkAisis = async () => {
    const res = await fetch(`${API_URL}/aisis/unlink`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    if (!res.ok) throw new Error('Failed to unlink AISIS');
    
    setUser(prev => prev ? { ...prev, aisisLinked: false } : null);
  };

  const checkAisisStatus = async (): Promise<boolean> => {
    if (!accessToken) return false;
    
    const res = await fetch(`${API_URL}/aisis/status`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    const data = await res.json();
    const isLinked = data.linked ?? false;
    
    setUser(prev => prev ? { ...prev, aisisLinked: isLinked } : null);
    return isLinked;
  };

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      isLoading,
      login,
      register,
      logout,
      linkAisis,
      unlinkAisis,
      checkAisisStatus,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
