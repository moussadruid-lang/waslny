import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env } from '../config.ts';
import { loadAuthUser, can } from '../middleware/auth.ts';
import { prisma } from '../lib/db.ts';
import { isTokenShape, trackingExpired } from './tracking.ts';

let io: Server | null = null;

/**
 * Rooms: user:<id>, driver:<id>, order:<id>, track:<token> (public, redacted), ops (live operations).
 * Clients must treat events as hints: on (re)connect they refetch the current state over REST (DB = source of truth).
 */
export function initRealtime(server: HttpServer, pub: any, sub: any) {
  io = new Server(server, { cors: { origin: env.CORS_ORIGINS.split(',') }, adapter: createAdapter(pub, sub) });
  io.on('connection', async (socket) => {
    const { token, trackingToken } = socket.handshake.auth ?? {};
    if (trackingToken) {
      const t = String(trackingToken);
      const o = isTokenShape(t) ? await prisma.order.findUnique({ where: { trackingToken: t }, select: { status: true, deliveredAt: true, updatedAt: true } }) : null;
      if (!o || await trackingExpired(o)) { socket.emit('track:error', { code: o ? 'TRACKING_EXPIRED' : 'NOT_FOUND' }); socket.disconnect(); return; }
      socket.join(`track:${t}`);
      socket.emit('ready', { at: new Date() });
      return;
    }
    try {
      const { sub: userId } = jwt.verify(String(token), env.JWT_SECRET) as { sub: string };
      const u = await loadAuthUser(userId);
      socket.join(`user:${u.id}`);
      if (u.driverId) socket.join(`driver:${u.driverId}`);
      if (can(u, 'ops.live')) socket.join('ops');
      socket.on('order:join', async (orderId: string) => {
        if (typeof orderId !== 'string') return;
        const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true, driverId: true, businessId: true } });
        if (o && (o.customerId === u.id || (!!u.driverId && o.driverId === u.driverId) || (o.businessId && u.businessIds.includes(o.businessId)) || can(u, 'orders.read_all'))) socket.join(`order:${orderId}`);
      });
      socket.emit('ready', { at: new Date(), ops: can(u, 'ops.live') });
    } catch { socket.disconnect(); }
  });
  return io;
}

export function emit(room: string, event: string, payload: unknown) { io?.to(room).emit(event, payload); }
export function realtimeStats() { return io ? { up: true, clients: io.engine.clientsCount } : { up: false, clients: 0 }; }
