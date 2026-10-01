import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from './config';

export class ApiError extends Error {
  code: string; status: number; fields?: Record<string, string[]>;
  constructor(code: string, message: string, status = 0, fields?: Record<string, string[]>) {
    super(message); this.code = code; this.status = status; this.fields = fields;
  }
  get isNetwork() { return ['OFFLINE', 'TIMEOUT', 'NETWORK'].includes(this.code); }
}

export const MSG = {
  OFFLINE: 'لا يوجد اتصال بالإنترنت',
  TIMEOUT: 'الاتصال بطيء، حاول مرة أخرى',
  GENERIC: 'تعذر تنفيذ العملية، حاول مرة أخرى',
  SESSION: 'انتهت الجلسة، سجّل الدخول مرة أخرى',
};

const K_ACCESS = 'msh.access';
const K_REFRESH = 'msh.refresh';
let access: string | null = null;
let refresh: string | null = null;
let logoutListener: (() => void) | null = null;

/** Tokens live in the OS keystore (SecureStore), never AsyncStorage. */
export const tokens = {
  async load() {
    access = await SecureStore.getItemAsync(K_ACCESS);
    refresh = await SecureStore.getItemAsync(K_REFRESH);
    return !!refresh;
  },
  async set(a: string, r: string) {
    access = a; refresh = r;
    await SecureStore.setItemAsync(K_ACCESS, a);
    await SecureStore.setItemAsync(K_REFRESH, r);
  },
  async clear() {
    access = null; refresh = null;
    await SecureStore.deleteItemAsync(K_ACCESS);
    await SecureStore.deleteItemAsync(K_REFRESH);
  },
  get access() { return access; },
  get hasSession() { return !!refresh; },
  onLogout(fn: () => void) { logoutListener = fn; },
};

async function rawFetch(path: string, init: { method: string; body?: string }, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(API_URL + path, {
      method: init.method, body: init.body, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    });
  } finally { clearTimeout(t); }
}

// Single-flight refresh: concurrent 401s share one rotation (server revokes the old refresh token).
let refreshing: Promise<boolean> | null = null;
function doRefresh(): Promise<boolean> {
  if (!refresh) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await rawFetch('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: refresh }) });
        if (!r.ok) return false;
        const j = await r.json();
        await tokens.set(j.accessToken, j.refreshToken);
        return true;
      } catch { return false; }
    })().finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}

export interface ApiOptions { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, unknown>; timeoutMs?: number }

/** All network calls go through here: auth header, refresh rotation, timeout, safe Arabic errors. */
export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const qs = opts.query
    ? '?' + Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const init = { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined };
  let res: Response;
  try {
    res = await rawFetch(path + qs, init, opts.timeoutMs);
    if (res.status === 401 && !path.startsWith('/v1/auth/')) {
      if (await doRefresh()) res = await rawFetch(path + qs, init, opts.timeoutMs);
      else if (refresh || access) { await tokens.clear(); logoutListener?.(); throw new ApiError('UNAUTHORIZED', MSG.SESSION, 401); }
    }
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    const net = await NetInfo.fetch().catch(() => null);
    if (net && net.isConnected === false) throw new ApiError('OFFLINE', MSG.OFFLINE);
    if (e?.name === 'AbortError') throw new ApiError('TIMEOUT', MSG.TIMEOUT);
    throw new ApiError('NETWORK', MSG.GENERIC);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    // Server already sends safe Arabic messages; 5xx are always replaced by a generic one.
    const msg = res.status >= 500 || !data?.error?.message ? MSG.GENERIC : data.error.message;
    throw new ApiError(data?.error?.code ?? `HTTP_${res.status}`, msg, res.status, data?.error?.fields);
  }
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : MSG.GENERIC);
