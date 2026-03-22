'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  isSessionValid,
  setSession,
  seedInitialData,
} from '@/utils/storage';

const MASTER_PASSWORD = 'MBBB';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (name: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isSessionValid()) {
      setIsAuthenticated(true);
      seedInitialData();
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((name: string, password: string): boolean => {
    if (!name || password !== MASTER_PASSWORD) return false;
    if (typeof window !== 'undefined') {
      localStorage.setItem('bb_user_name', name);
    }
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
