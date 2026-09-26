import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthenticated, refreshSession, setAccessToken } from './api';
import type { Me } from './types';

type LoginResult = { ok: true } | { ok: false; organizations: { id: string; name: string }[] };

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  me: Me | null;
  can: (...perms: string[]) => boolean;
  login: (email: string, password: string, organizationId?: string) => Promise<LoginResult>;
  register: (data: { organizationName: string; name: string; email: string; password: string; acceptTerms: true }) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const loadMe = useCallback(async () => {
    const data = await api<Me>('/auth/me');
    setMe(data);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  // Ao abrir o app, tenta recuperar a sessão pelo cookie de refresh.
  useEffect(() => {
    onUnauthenticated(clear);
    (async () => {
      if (await refreshSession()) {
        try {
          await loadMe();
          return;
        } catch {
          /* cai para anônimo */
        }
      }
      setStatus('anonymous');
    })();
  }, [clear, loadMe]);

  const login = useCallback<AuthState['login']>(
    async (email, password, organizationId) => {
      const r = await api<{ accessToken?: string; requiresOrganization?: boolean; organizations?: { id: string; name: string }[] }>(
        '/auth/login',
        { method: 'POST', body: { email, password, organizationId }, auth: false },
      );
      if (r.requiresOrganization) return { ok: false, organizations: r.organizations ?? [] };
      setAccessToken(r.accessToken!);
      await loadMe();
      return { ok: true };
    },
    [loadMe],
  );

  const register = useCallback<AuthState['register']>(
    async (data) => {
      const r = await api<{ accessToken: string }>('/auth/register', { method: 'POST', body: data, auth: false });
      setAccessToken(r.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', auth: false });
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      can: (...perms) => !!me && perms.every((p) => me.permissions.includes(p)),
      login,
      register,
      logout,
      reload: loadMe,
    }),
    [status, me, login, register, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
