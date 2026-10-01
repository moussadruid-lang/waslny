import type { Request } from 'express';
import { prisma } from './db.ts';
import { AppError, E } from './errors.ts';

export const idemKey = (req: Request): string | undefined => {
  const k = (req.headers['idempotency-key'] as string | undefined) ?? (typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : undefined);
  return k?.trim() || undefined;
};

/**
 * Runs `fn` at most once per (scope, key). A row is reserved BEFORE running (unique constraint), so two
 * concurrent requests with the same key cannot both execute: the loser gets 409 while the first is in flight,
 * and later replays receive the stored response. If `fn` throws, the reservation is released so the client can retry.
 */
export async function idempotent<T>(scope: string, key: string | undefined, fn: () => Promise<{ status: number; body: T }>, opts: { required?: boolean } = {}) {
  if (!key) {
    if (opts.required) throw E.bad('IDEMPOTENCY_REQUIRED', 'مفتاح منع التكرار (Idempotency-Key) مطلوب');
    return { ...(await fn()), replayed: false };
  }
  if (!/^[\w\-:.]{8,100}$/.test(key)) throw E.bad('BAD_IDEMPOTENCY_KEY', 'مفتاح منع التكرار غير صالح');
  try {
    await prisma.idempotencyRecord.create({ data: { scope, key, status: 0, response: {} } });
  } catch {
    const hit = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!hit || hit.status === 0) throw new AppError(409, 'IN_PROGRESS', 'الطلب نفسه قيد التنفيذ');
    return { status: hit.status, body: hit.response as T, replayed: true };
  }
  try {
    const r = await fn();
    await prisma.idempotencyRecord.update({ where: { scope_key: { scope, key } }, data: { status: r.status, response: r.body as any } });
    return { ...r, replayed: false };
  } catch (e) {
    await prisma.idempotencyRecord.delete({ where: { scope_key: { scope, key } } }).catch(() => {});
    throw e;
  }
}
