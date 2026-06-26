import React, { createContext, useContext, useState, useCallback } from 'react';

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
