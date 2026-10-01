import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { tokens } from './api';

let socket: Socket | null = null;

/** One authenticated socket per app. The auth callback re-reads the latest access token on every reconnect. */
export function getSocket(): Socket | null {
  if (!tokens.access) return null;
  if (!socket) {
    socket = io(API_URL, { transports: ['websocket'], reconnection: true, reconnectionDelayMax: 10000, auth: (cb) => cb({ token: tokens.access }) });
  }
  return socket;
}
export function closeSocket() { socket?.disconnect(); socket = null; }

export function useSocketEvent<T = any>(event: string, handler: (p: T) => void, enabled = true) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket(); if (!s) return;
    const h = (p: T) => ref.current(p);
    s.on(event, h);
    return () => { s.off(event, h); };
  }, [event, enabled]);
}

/** Join the order room (server checks participation) and re-join after reconnects. */
export function useOrderRoom(orderId: string | undefined) {
  useEffect(() => {
    if (!orderId) return;
    const s = getSocket(); if (!s) return;
    const join = () => s.emit('order:join', orderId);
    join(); s.on('connect', join);
    return () => { s.off('connect', join); };
  }, [orderId]);
}
