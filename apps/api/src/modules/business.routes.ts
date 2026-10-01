import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { hashSecret } from './auth.ts';
import { queues } from '../jobs/queues.ts';
import { createOrder, cancelOrder } from './orders.service.ts';
import { audit } from '../lib/audit.ts';

/** Business dashboard (JWT users that belong to a business). */
export const businessRouter = Router();
const biz = (req: Request) => {
  const id = String(req.headers['x-business-id'] ?? req.user!.businessIds[0] ?? '');
  if (!req.user!.businessIds.includes(id)) throw E.forbidden();
  return id;
};

businessRouter.post('/bulk', ah(async (req, res) => {
  const { rows, fileUrl } = z.object({ rows: z.array(z.record(z.any())).min(1).max(2000), fileUrl: z.string().default('inline') }).parse(req.body);
  const businessId = biz(req);
  const up = await prisma.bulkUpload.create({ data: { businessId, fileUrl, status: 'QUEUED' } });
  await queues.bulk.add('bulk', { uploadId: up.id, rows, userId: req.user!.id, businessId });
  res.status(202).json({ uploadId: up.id, messageAr: 'جارٍ معالجة الملف' });
}));
businessRouter.get('/bulk/:id', ah(async (req, res) => res.json(await prisma.bulkUpload.findFirstOrThrow({ where: { id: req.params.id, businessId: biz(req) } }))));
businessRouter.get('/orders', ah(async (req, res) => {
  const items = await prisma.order.findMany({ where: { businessId: biz(req), ...(req.query.status ? { status: String(req.query.status) as any } : {}) }, orderBy: { createdAt: 'desc' }, take: 50, skip: Number(req.query.skip) || 0,
    select: { id: true, code: true, status: true, total: true, codAmount: true, createdAt: true, deliveredAt: true, stops: { where: { type: 'DROPOFF' }, select: { contactName: true, formatted: true } } } });
  res.json(items);
}));
businessRouter.get('/statement', ah(async (req, res) => {
  const businessId = biz(req);
  const w = await prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'BUSINESS', ownerId: businessId } } });
  const tx = w ? await prisma.walletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take: 500 }) : [];
  const codPending = await prisma.order.aggregate({ where: { businessId, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }, _sum: { codAmount: true } });
  res.json({ balance: w?.balance ?? 0, codPending: codPending._sum.codAmount ?? 0, transactions: tx });
}));
businessRouter.post('/api-keys', ah(async (req, res) => {
  const businessId = biz(req);
  const { scopes } = z.object({ scopes: z.array(z.enum(['orders:create', 'orders:read', 'orders:cancel', 'tracking:read'])).min(1) }).parse(req.body);
  const prefix = 'msh_' + crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  await prisma.apiKey.create({ data: { businessId, prefix, keyHash: hashSecret(secret), scopes } });
  await audit(prisma, { actorId: req.user!.id, action: 'apikey.create', entityType: 'Business', entityId: businessId, after: { prefix, scopes } });
  res.status(201).json({ apiKey: `${prefix}.${secret}`, noteAr: 'احفظ المفتاح الآن، لن يظهر مرة أخرى' });
}));
businessRouter.post('/webhooks', ah(async (req, res) => {
  const b = z.object({ url: z.string().url().startsWith('https://'), events: z.array(z.string()).min(1) }).parse(req.body);
  const secret = crypto.randomBytes(24).toString('hex');
  const w = await prisma.webhook.create({ data: { businessId: biz(req), url: b.url, events: b.events, secret } });
  res.status(201).json({ id: w.id, signingSecret: secret });
}));

/** Public Business API v1 (API-key auth, scoped, rate-limited per key). */
export const businessApiRouter = Router();
async function apiKeyAuth(req: any, _res: Response, next: NextFunction) {
  try {
    const raw = String(req.headers['x-api-key'] ?? '');
    const [prefix, secret] = raw.split('.');
    const k = prefix ? await prisma.apiKey.findUnique({ where: { prefix } }) : null;
    if (!k || k.revokedAt || !secret || hashSecret(secret) !== k.keyHash) throw E.unauthorized();
    req.apiKey = k;
    prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    next();
  } catch (e) { next(e); }
}
businessApiRouter.use(apiKeyAuth);
businessApiRouter.use(rateLimit({ windowMs: 60_000, limit: (req: any) => req.apiKey?.rateLimitPerMin ?? 60, keyGenerator: (req: any) => req.apiKey?.prefix ?? req.ip }));
const scope = (s: string) => (req: any, _res: Response, next: NextFunction) => (req.apiKey.scopes.includes(s) ? next() : next(E.forbidden()));
businessApiRouter.post('/orders', scope('orders:create'), ah(async (req: any, res) => {
  const owner = await prisma.businessUser.findFirstOrThrow({ where: { businessId: req.apiKey.businessId, role: 'OWNER' } });
  const r = await createOrder({ ...req.body, customerId: owner.userId, businessId: req.apiKey.businessId, paymentMethod: 'CASH' });
  res.status(201).json({ id: r.order.id, code: r.order.code, status: r.order.status, total: r.order.total, trackingToken: r.order.trackingToken });
}));
businessApiRouter.get('/orders/:id', scope('orders:read'), ah(async (req: any, res) => {
  res.json(await prisma.order.findFirstOrThrow({ where: { id: req.params.id, businessId: req.apiKey.businessId }, select: { id: true, code: true, status: true, total: true, codAmount: true, createdAt: true, deliveredAt: true, trackingToken: true } }));
}));
businessApiRouter.post('/orders/:id/cancel', scope('orders:cancel'), ah(async (req: any, res) => {
  const o = await prisma.order.findFirstOrThrow({ where: { id: req.params.id, businessId: req.apiKey.businessId } });
  await cancelOrder(o.id, { type: 'BUSINESS', id: req.apiKey.businessId }, String(req.body?.reason ?? 'api'));
  res.json({ ok: true });
}));
