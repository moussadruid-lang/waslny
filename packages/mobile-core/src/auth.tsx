import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokens } from './api';
import { closeSocket } from './socket';

export interface Me {
  id: string; name: string | null; phone: string; email: string | null; avatarUrl: string | null; referralCode: string;
  notificationPrefs: Record<string, boolean>; roles: string[]; driver: { id: string; status: string } | null;
}
interface AuthCtx {
  status: 'loading' | 'out' | 'in'; me: Me | null;
  signIn: (t: { accessToken: string; refreshToken: string }) => Promise<void>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<Me | null>;
}
const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    try { const m = await api<Me>('/v1/customer/me'); setMe(m); setStatus('in'); return m; }
    catch (e: any) {
      if (e?.status === 401 || e?.status === 403) { await tokens.clear(); setMe(null); setStatus('out'); return null; }
      // Offline at launch: keep the session, the app will retry when screens load.
      setStatus(tokens.hasSession ? 'in' : 'out'); return null;
    }
  }, []);

  useEffect(() => {
    tokens.onLogout(() => { closeSocket(); setMe(null); setStatus('out'); });
    (async () => { (await tokens.load()) ? await reloadMe() : setStatus('out'); })();
  }, [reloadMe]);

  const signIn = useCallback(async (t: { accessToken: string; refreshToken: string }) => { await tokens.set(t.accessToken, t.refreshToken); await reloadMe(); }, [reloadMe]);
  const signOut = useCallback(async () => {
    try { await api('/v1/auth/logout', { method: 'POST', body: {} }); } catch { /* offline logout still clears local session */ }
    closeSocket(); await tokens.clear(); setMe(null); setStatus('out');
  }, []);

  const v = useMemo(() => ({ status, me, signIn, signOut, reloadMe }), [status, me, signIn, signOut, reloadMe]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
