/**
 * Cliente HTTP.
 * - Access token só em memória (não vai para localStorage — reduz o impacto de XSS).
 * - Refresh token em cookie httpOnly, renovado automaticamente em /auth/refresh.
 * - Várias requisições que expiram juntas compartilham uma única renovação.
 */
import { demoFetch } from './demo-backend';

const BASE = '/api/v1';
// Prévia de demonstração: as chamadas vão para um backend simulado no navegador.
const doFetch: typeof fetch = import.meta.env.VITE_DEMO ? demoFetch : (...a) => fetch(...a);

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function onUnauthenticated(fn: () => void) {
  onSessionLost = fn;
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function extractMessage(body: any, status: number): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join(' · ');
  if (typeof m === 'string') return m;
  if (typeof m?.message === 'string') return m.message;
  if (status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  if (status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
  return 'Não foi possível concluir a operação.';
}

async function doRefresh(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await doFetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      accessToken = data.accessToken;
      return true;
    }
    const body = await r.json().catch(() => null);
    // Outra aba acabou de renovar: o navegador já tem o cookie novo — tenta mais uma vez.
    if (body?.message?.code === 'ROTATED' || body?.code === 'ROTATED') {
      await new Promise((res) => setTimeout(res, 400));
      continue;
    }
    break;
  }
  accessToken = null;
  return false;
}

export function refreshSession() {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;
  const send = () =>
    doFetch(BASE + path, {
      method,
      signal,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (res.status === 401 && auth) {
    if (await refreshSession()) res = await send();
    else {
      onSessionLost?.();
      throw new ApiError(401, 'Sua sessão expirou. Entre novamente.');
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, extractMessage(data, res.status), data);
  return data as T;
}
