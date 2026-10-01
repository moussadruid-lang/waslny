import { Router, type Request } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { requirePerm, invalidateAuthCache, can } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { EgPhone } from './auth.ts';

const newReferral = () => 'MSH' + crypto.randomBytes(3).toString('hex').toUpperCase();
const pg = (q: any) => ({ take: Math.min(Number(q.limit) || 25, 100), skip: (Math.max(Number(q.page) || 1, 1) - 1) * Math.min(Number(q.limit) || 25, 100) });

/** Find-or-create a user by phone and make sure they hold a role (used for business staff). */
async function ensureUserWithRole(phone: string, name: string | undefined, roleCode: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const u = await prisma.user.findUnique({ where: { phone } }) ?? await prisma.user.create({ data: { phone, name, referralCode: newReferral() } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: role.id } }, update: {}, create: { userId: u.id, roleId: role.id } });
  invalidateAuthCache(u.id);
  return u;
}

// ---------------- Staff identity (dashboard bootstraps navigation from this) ----------------
export const staffRouter = Router();
staffRouter.get('/me', ah(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, phone: true, businessUsers: { select: { role: true, business: { select: { id: true, nameAr: true } } } } } });
  const perms = req.user!.roles.includes('SUPER_ADMIN') ? ['*'] : [...req.user!.perms];
  res.json({ id: u.id, name: u.name, phone: u.phone, roles: req.user!.roles, perms, isStaff: perms.length > 0, businesses: u.businessUsers.map((b) => ({ id: b.business.id, nameAr: b.business.nameAr, role: b.role })) });
}));

// ---------------- Admin extras ----------------
export const adminExtraRouter = Router();

adminExtraRouter.get('/customers/:id', requirePerm('customers.read'), ah(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true, referralCode: true,
    roles: { select: { role: { select: { code: true } } } }, addresses: true, driver: { select: { id: true, status: true } } } });
  if (!u) throw E.notFound('العميل');
  const [orders, wallet, ratings, tickets, counts] = await Promise.all([
    prisma.order.findMany({ where: { customerId: u.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, code: true, status: true, total: true, createdAt: true } }),
    prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: u.id } }, include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } } }),
    prisma.rating.findMany({ where: { rateeType: 'CUSTOMER', rateeId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.groupBy({ by: ['status'], where: { customerId: u.id }, _count: true }),
  ]);
  res.json({ ...u, roles: u.roles.map((r) => r.role.code), orders, wallet, ratings, tickets, counts });
}));

adminExtraRouter.get('/tickets/:id', requirePerm('support.read'), ah(async (req, res) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!t) throw E.notFound('التذكرة');
  const [user, order] = await Promise.all([
    prisma.user.findUnique({ where: { id: t.userId }, select: { id: true, name: true, phone: true } }),
    t.orderId ? prisma.order.findUnique({ where: { id: t.orderId }, select: { id: true, code: true, status: true, total: true } }) : null,
  ]);
  res.json({ ...t, user, order });
}));

adminExtraRouter.get('/businesses', requirePerm('customers.read'), ah(async (req, res) => {
  const q = String(req.query.q ?? '');
  const where = q ? { nameAr: { contains: q, mode: 'insensitive' as const } } : {};
  const [items, total] = await Promise.all([
    prisma.business.findMany({ where, ...pg(req.query), orderBy: { createdAt: 'desc' }, include: { _count: { select: { orders: true, branches: true, users: true } } } }),
    prisma.business.count({ where })]);
  res.json({ items, total });
}));
adminExtraRouter.post('/businesses', requirePerm('customers.manage'), ah(async (req, res) => {
  const b = z.object({ nameAr: z.string().min(2).max(120), taxId: z.string().max(40).optional(), ownerPhone: EgPhone, ownerName: z.string().min(2).max(80).optional() }).parse(req.body);
  const owner = await ensureUserWithRole(b.ownerPhone, b.ownerName, 'BUSINESS');
  const biz = await prisma.business.create({ data: { nameAr: b.nameAr, taxId: b.taxId, users: { create: { userId: owner.id, role: 'OWNER' } } } });
  invalidateAuthCache(owner.id);
  await audit(prisma, { actorId: req.user!.id, action: 'business.create', entityType: 'Business', entityId: biz.id, after: { ...b }, ip: req.ip });
  res.status(201).json(biz);
}));
adminExtraRouter.patch('/businesses/:id', requirePerm('customers.manage'), ah(async (req, res) => {
  const b = z.object({ nameAr: z.string().min(2).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), taxId: z.string().optional() }).parse(req.body);
  const before = await prisma.business.findUniqueOrThrow({ where: { id: req.params.id } });
  const row = await prisma.business.update({ where: { id: before.id }, data: b });
  await audit(prisma, { actorId: req.user!.id, action: 'business.update', entityType: 'Business', entityId: before.id, before, after: row, ip: req.ip });
  res.json(row);
}));

// ---------------- Business extras (merchant dashboard) ----------------
export const businessExtraRouter = Router();
const bizId = (req: Request) => {
  const id = String(req.headers['x-business-id'] ?? req.user!.businessIds[0] ?? '');
  if (!req.user!.businessIds.includes(id)) throw E.forbidden();
  return id;
};
async function requireBizManager(req: Request) {
  const id = bizId(req);
  const bu = await prisma.businessUser.findUnique({ where: { businessId_userId: { businessId: id, userId: req.user!.id } } });
  if (!bu || !['OWNER', 'MANAGER'].includes(bu.role)) throw E.forbidden();
  return id;
}

businessExtraRouter.get('/profile', ah(async (req, res) => {
  const id = bizId(req);
  const b = await prisma.business.findUniqueOrThrow({ where: { id }, include: { branches: true, users: { include: { user: { select: { id: true, name: true, phone: true } } } } } });
  const me = b.users.find((u) => u.userId === req.user!.id);
  res.json({ id: b.id, nameAr: b.nameAr, status: b.status, taxId: b.taxId, myRole: me?.role, branches: b.branches, staff: b.users.map((u) => ({ ...u.user, role: u.role })) });
}));
businessExtraRouter.post('/branches', ah(async (req, res) => {
  const id = await requireBizManager(req);
  const b = z.object({ name: z.string().min(2).max(80), lat: z.number().min(21).max(32), lng: z.number().min(24).max(37), address: z.string().max(300).optional() }).parse(req.body);
  res.status(201).json(await prisma.businessBranch.create({ data: { ...b, businessId: id } }));
}));
businessExtraRouter.delete('/branches/:branchId', ah(async (req, res) => {
  const id = await requireBizManager(req);
  await prisma.businessBranch.deleteMany({ where: { id: req.params.branchId, businessId: id } });
  res.json({ ok: true });
}));
businessExtraRouter.post('/staff', ah(async (req, res) => {
  const id = await requireBizManager(req);
  const b = z.object({ phone: EgPhone, name: z.string().min(2).max(80).optional(), role: z.enum(['MANAGER', 'STAFF']) }).parse(req.body);
  const u = await ensureUserWithRole(b.phone, b.name, 'BUSINESS');
  await prisma.businessUser.upsert({ where: { businessId_userId: { businessId: id, userId: u.id } }, update: { role: b.role }, create: { businessId: id, userId: u.id, role: b.role } });
  invalidateAuthCache(u.id);
  await audit(prisma, { actorId: req.user!.id, action: 'business.staff.add', entityType: 'Business', entityId: id, after: { userId: u.id, role: b.role } });
  res.status(201).json({ ok: true });
}));
businessExtraRouter.delete('/staff/:userId', ah(async (req, res) => {
  const id = await requireBizManager(req);
  const target = await prisma.businessUser.findUnique({ where: { businessId_userId: { businessId: id, userId: req.params.userId } } });
  if (!target || target.role === 'OWNER') throw E.bad('CANNOT_REMOVE', 'لا يمكن حذف المالك');
  await prisma.businessUser.delete({ where: { businessId_userId: { businessId: id, userId: req.params.userId } } });
  invalidateAuthCache(req.params.userId);
  res.json({ ok: true });
}));
businessExtraRouter.get('/api-keys', ah(async (req, res) => {
  const id = await requireBizManager(req);
  res.json(await prisma.apiKey.findMany({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, prefix: true, scopes: true, rateLimitPerMin: true, revokedAt: true, lastUsedAt: true, createdAt: true } }));
}));
businessExtraRouter.post('/api-keys/:keyId/revoke', ah(async (req, res) => {
  const id = await requireBizManager(req);
  await prisma.apiKey.updateMany({ where: { id: req.params.keyId, businessId: id }, data: { revokedAt: new Date() } });
  await audit(prisma, { actorId: req.user!.id, action: 'apikey.revoke', entityType: 'Business', entityId: id, after: { keyId: req.params.keyId } });
  res.json({ ok: true });
}));
businessExtraRouter.get('/webhooks', ah(async (req, res) => {
  const id = await requireBizManager(req);
  res.json(await prisma.webhook.findMany({ where: { businessId: id }, select: { id: true, url: true, events: true, active: true, deliveries: { orderBy: { createdAt: 'desc' }, take: 5, select: { event: true, statusCode: true, attempts: true, succeededAt: true, createdAt: true } } } }));
}));
businessExtraRouter.get('/summary', ah(async (req, res) => {
  const id = bizId(req);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400_000);
  const [byStatus, delivered, codOpen] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { businessId: id, createdAt: { gte: from } }, _count: true }),
    prisma.order.aggregate({ where: { businessId: id, status: 'DELIVERED', deliveredAt: { gte: from } }, _sum: { total: true, codAmount: true }, _count: true }),
    prisma.order.aggregate({ where: { businessId: id, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }, _sum: { codAmount: true }, _count: true }),
  ]);
  res.json({ byStatus: byStatus.map((b) => ({ status: b.status, count: b._count })), deliveredCount: delivered._count, fees: delivered._sum.total ?? 0, codCollected: delivered._sum.codAmount ?? 0, openOrders: codOpen._count, codPending: codOpen._sum.codAmount ?? 0 });
}));
businessExtraRouter.get('/orders/:id', ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, businessId: bizId(req) }, include: { stops: { orderBy: { seq: 'asc' } }, history: { orderBy: { at: 'asc' } }, proofs: { where: { kind: 'DELIVERY' } } } });
  if (!o) throw E.notFound('الطلب');
  const { deliveryOtpHash, ...safe } = o;
  res.json({ ...safe, history: o.history.map((h) => ({ ...h, id: h.id.toString() })) });
}));

export { can };
