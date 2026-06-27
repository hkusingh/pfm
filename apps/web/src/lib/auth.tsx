import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return {};
  }
}

interface AuthState {
  accessToken: string | null;
  isDemo: boolean;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setDemoToken: (accessToken: string) => void;
  clearTokens: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(
    () => localStorage.getItem('accessToken'),
  );
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    const token = localStorage.getItem('accessToken');
    return token ? !!decodeJwtPayload(token).isDemo : false;
  });

  const setTokens = useCallback((at: string, rt: string) => {
    localStorage.setItem('accessToken', at);
    localStorage.setItem('refreshToken', rt);
    setAccessToken(at);
    setIsDemo(false);
  }, []);

  const setDemoToken = useCallback((at: string) => {
    localStorage.setItem('accessToken', at);
    localStorage.removeItem('refreshToken');
    setAccessToken(at);
    setIsDemo(true);
  }, []);

  const clearTokens = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setAccessToken(null);
    setIsDemo(false);
  }, []);

  // Idle timeout — sign out after 30 min of inactivity (demo sessions excluded)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessTokenRef = useRef(accessToken);
  const isDemoRef = useRef(isDemo);
  accessTokenRef.current = accessToken;
  isDemoRef.current = isDemo;

  useEffect(() => {
    function resetTimer() {
      if (!accessTokenRef.current || isDemoRef.current) return;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setAccessToken(null);
        setIsDemo(false);
        window.location.href = '/';
      }, IDLE_TIMEOUT_MS);
    }

    resetTimer();
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ accessToken, isDemo, setTokens, setDemoToken, clearTokens, isAuthenticated: !!accessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
