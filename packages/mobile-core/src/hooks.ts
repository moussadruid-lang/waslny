import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { ApiError } from './api';

export interface Loadable<T> {
  data: T | undefined; error: ApiError | null; loading: boolean; refreshing: boolean;
  reload: () => Promise<void>; refresh: () => Promise<void>; setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/** Loading / error / retry / pull-to-refresh state for one request. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { enabled?: boolean } = {}): Loadable<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(opts.enabled !== false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (mode: 'load' | 'refresh') => {
    mode === 'load' ? setLoading(true) : setRefreshing(true);
    try { const d = await fn(); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e instanceof ApiError ? e : new ApiError('UNKNOWN', 'تعذر التحميل، حاول مرة أخرى')); }
    finally { if (alive.current) { setLoading(false); setRefreshing(false); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { if (opts.enabled !== false) run('load'); }, [run, opts.enabled]);
  return { data, error, loading, refreshing, reload: () => run('load'), refresh: () => run('refresh'), setData };
}

/** Cursor-paginated list with infinite scroll (§64). */
export function usePaged<T extends { id: string }>(fetchPage: (cursor?: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const gen = useRef(0);

  const first = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    const g = ++gen.current;
    mode === 'load' ? setLoading(true) : setRefreshing(true);
    try {
      const r = await fetchPage(null);
      if (g !== gen.current) return;
      setItems(r.items); setCursor(r.nextCursor); setDone(!r.nextCursor || r.items.length === 0); setError(null);
    } catch (e) { if (g === gen.current) setError(e as ApiError); }
    finally { if (g === gen.current) { setLoading(false); setRefreshing(false); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const more = useCallback(async () => {
    if (done || loadingMore || loading || !cursor) return;
    const g = gen.current;
    setLoadingMore(true);
    try {
      const r = await fetchPage(cursor);
      if (g !== gen.current) return;
      setItems((p) => [...p, ...r.items.filter((i) => !p.some((x) => x.id === i.id))]);
      setCursor(r.nextCursor); if (!r.nextCursor || r.items.length === 0) setDone(true);
    } catch { /* keep list; user can scroll again */ }
    finally { setLoadingMore(false); }
  }, [cursor, done, loadingMore, loading, fetchPage]);

  useEffect(() => { first('load'); }, [first]);
  return { items, error, loading, loadingMore, refreshing, done, reload: () => first('load'), refresh: () => first('refresh'), more };
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)), []);
  return online;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (ms == null) return; const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}
