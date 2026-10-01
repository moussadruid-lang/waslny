import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env } from '../config.ts';
import { loadAuthUser, can } from '../middleware/auth.ts';
import { prisma } from '../lib/db.ts';

let io: Server | null = null;

/** Rooms: user:<id>, driver:<id>, order:<id>, track:<token> (public, redacted), ops (live operations). */
export function initRealtime(server: HttpServer, pub: any, sub: any) {
  io = new Server(server, { cors: { origin: env.CORS_ORIGINS.split(',') }, adapter: createAdapter(pub, sub) });
  io.on('connection', async (socket) => {
    const { token, trackingToken } = socket.handshake.auth ?? {};
    if (trackingToken) {
      const o = await prisma.order.findUnique({ where: { trackingToken: String(trackingToken) }, select: { id: true } });
      if (o) socket.join(`track:${trackingToken}`); else socket.disconnect();
      return;
    }
    try {
      const { sub: userId } = jwt.verify(String(token), env.JWT_SECRET) as { sub: string };
      const u = await loadAuthUser(userId);
      socket.join(`user:${u.id}`);
      if (u.driverId) socket.join(`driver:${u.driverId}`);
      if (can(u, 'ops.live')) socket.join('ops');
      socket.on('order:join', async (orderId: string) => {
        const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true, driverId: true, businessId: true } });
        if (o && (o.customerId === u.id || o.driverId === u.driverId || (o.businessId && u.businessIds.includes(o.businessId)) || can(u, 'orders.read_all'))) socket.join(`order:${orderId}`);
      });
    } catch { socket.disconnect(); }
  });
  return io;
}

export function emit(room: string, event: string, payload: unknown) { io?.to(room).emit(event, payload); }
