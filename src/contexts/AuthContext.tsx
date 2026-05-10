'use client';

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  isSessionValid,
  setSession,
  seedInitialData,
  saveSetting,
} from '@/utils/storage';

const MASTER_PASSWORD = 'MBBB';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (name: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// useLayoutEffect on the client, useEffect on the server (avoids SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Resolve session synchronously after hydration so the auth-gated render
  // happens before the browser paints — eliminates the visible "Loading…"
  // flash on cold launch.
  useIsoLayoutEffect(() => {
    const valid = isSessionValid();
    if (valid) setIsAuthenticated(true);
    setIsLoading(false);
  }, []);

  // Heavy work (Firestore seed, dynamic imports) deferred to a normal effect
  // so it never blocks paint.
  useEffect(() => {
    if (!isAuthenticated) return;
    seedInitialData().catch(() => {});
    import('@/utils/eaa').then(({ loadCustomFoodsFromFirestore }) => loadCustomFoodsFromFirestore()).catch(() => {});
  }, [isAuthenticated]);

  // Fade the server-rendered boot splash once auth has resolved.
  useEffect(() => {
    if (isLoading) return;
    document.body.dataset.hydrated = 'true';
    const t = setTimeout(() => {
      const el = document.querySelector('.boot-splash');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 350);
    return () => clearTimeout(t);
  }, [isLoading]);

  const login = useCallback((name: string, password: string): boolean => {
    if (!name || password !== MASTER_PASSWORD) return false;
    saveSetting('userName', name);
    setSession(true);
    setIsAuthenticated(true);
    seedInitialData();
    return true;
  }, []);

  const logout = useCallback(() => {
    setSession(false);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
