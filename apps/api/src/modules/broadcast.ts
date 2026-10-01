import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.ts';
import { notify } from './notify.ts';
import { emit } from './realtime.ts';

export const BroadcastInput = z.object({
  target: z.enum(['USER', 'ALL_DRIVERS', 'ONLINE_DRIVERS', 'ALL_CUSTOMERS', 'BUSINESS']),
  userId: z.string().optional(), businessId: z.string().optional(),
  titleAr: z.string().min(2).max(80), bodyAr: z.string().min(3).max(300), deepLink: z.string().max(200).optional(),
}).refine((b) => (b.target !== 'USER' || !!b.userId) && (b.target !== 'BUSINESS' || !!b.businessId), 'حدد المستلم');
export type BroadcastInput = z.infer<typeof BroadcastInput>;

export function recipientsWhere(b: BroadcastInput): Prisma.UserWhereInput {
  const active = { status: 'ACTIVE' as const };
  switch (b.target) {
    case 'USER': return { ...active, id: b.userId };
    case 'ALL_DRIVERS': return { ...active, driver: { status: 'APPROVED' } };
    case 'ONLINE_DRIVERS': return { ...active, driver: { status: 'APPROVED', online: true } };
    case 'ALL_CUSTOMERS': return { ...active, roles: { some: { role: { code: 'CUSTOMER' } } } };
    case 'BUSINESS': return { ...active, businessUsers: { some: { businessId: b.businessId } } };
  }
}

/** Runs in the worker: pages through recipients so a 100k-user segment never blocks the API. */
export async function runBroadcast(b: BroadcastInput) {
  let cursor: string | undefined; let sent = 0;
  for (;;) {
    const users = await prisma.user.findMany({ where: recipientsWhere(b), select: { id: true, driver: { select: { id: true } } }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!users.length) break;
    for (const u of users) {
      await notify(u.id, { type: 'ADMIN_MESSAGE', titleAr: b.titleAr, bodyAr: b.bodyAr, deepLink: b.deepLink });
      if (u.driver) emit(`driver:${u.driver.id}`, 'admin:message', { bodyAr: b.bodyAr });
      sent++;
    }
    cursor = users.at(-1)!.id;
  }
  return sent;
}
