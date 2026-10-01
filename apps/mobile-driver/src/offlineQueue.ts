import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { ApiError, api, uploadBase64, type UploadPurpose } from '@mashawir/mobile-core';

/**
 * Offline mode for drivers (§56). Actions (status steps, proof of delivery, failures, returns) are
 * executed immediately when online; on network failure they are persisted and replayed IN ORDER.
 * Conflicts are prevented server-side: repeating the same status is a no-op, proofs carry a clientId
 * (unique), and the state machine rejects stale transitions — those are dropped and reported.
 */
export interface QueuedFile { field: 'photoUrl' | 'signatureUrl'; uri: string; mime: 'image/jpeg' | 'image/png'; purpose: UploadPurpose }
export interface QueuedAction { id: string; path: string; body: Record<string, unknown>; files?: QueuedFile[]; label: string; createdAt: number }
export interface DroppedAction { label: string; message: string; at: number }

const KEY = 'msh.driver.queue';
const DROPPED = 'msh.driver.dropped';
const listeners = new Set<(n: number) => void>();
let flushing = false;

async function read(): Promise<QueuedAction[]> { try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'); } catch { return []; } }
async function write(q: QueuedAction[]) { await AsyncStorage.setItem(KEY, JSON.stringify(q)); listeners.forEach((l) => l(q.length)); }
export const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Copy a temp file (camera/manipulator cache) to persistent storage so it survives until synced. */
export async function persistFile(uri: string, ext: 'jpg' | 'png') {
  const dest = `${FileSystem.documentDirectory}proof-${newClientId()}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}
export async function persistBase64(b64: string, ext: 'png' | 'jpg') {
  const dest = `${FileSystem.documentDirectory}proof-${newClientId()}.${ext}`;
  await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}

async function send(a: Omit<QueuedAction, 'id' | 'createdAt'>) {
  const body: Record<string, unknown> = { ...a.body };
  for (const f of a.files ?? []) {
    const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
    body[f.field] = await uploadBase64(b64, f.mime, f.purpose);
  }
  const r = await api(a.path, { body, timeoutMs: 30_000 });
  for (const f of a.files ?? []) FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => {});
  return r;
}

export async function runOrQueue(a: Omit<QueuedAction, 'id' | 'createdAt'>): Promise<{ queued: boolean; result?: any }> {
  const q = await read();
  if (q.length === 0) { // preserve ordering: go direct only when nothing is pending
    try { return { queued: false, result: await send(a) }; }
    catch (e) { if (!(e instanceof ApiError && e.isNetwork)) throw e; }
  }
  await write([...q, { ...a, id: newClientId(), createdAt: Date.now() }]);
  return { queued: true };
}

export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let q = await read();
    while (q.length) {
      const a = q[0];
      try { await send(a); }
      catch (e) {
        if (e instanceof ApiError && e.isNetwork) break; // still offline, try later
        const d: DroppedAction[] = JSON.parse((await AsyncStorage.getItem(DROPPED)) ?? '[]');
        await AsyncStorage.setItem(DROPPED, JSON.stringify([{ label: a.label, message: e instanceof ApiError ? e.message : 'تعذر التنفيذ', at: Date.now() }, ...d].slice(0, 20)));
      }
      q = q.slice(1); await write(q);
    }
  } finally { flushing = false; }
}

export async function takeDropped(): Promise<DroppedAction[]> {
  const d: DroppedAction[] = JSON.parse((await AsyncStorage.getItem(DROPPED)) ?? '[]');
  if (d.length) await AsyncStorage.removeItem(DROPPED);
  return d;
}

let started = false;
export function startQueueSync() {
  if (started) return; started = true;
  NetInfo.addEventListener((s) => { if (s.isConnected) flushQueue(); });
  flushQueue();
}

export function useQueueSize() {
  const [n, setN] = useState(0);
  useEffect(() => { read().then((q) => setN(q.length)); listeners.add(setN); return () => { listeners.delete(setN); }; }, []);
  return n;
}
