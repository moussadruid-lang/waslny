import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { requirePerm, invalidateAuthCache } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { acceptOffer, cancelOrder, releaseDriver, startDispatch } from './orders.service.ts';
import { post } from './ledger.ts';
import { clearSettingsCache, DEFAULTS } from './settings.ts';
import { notify } from './notify.ts';
import { emit } from './realtime.ts';
import { ACTIVE_DRIVER_STATUSES } from '@mashawir/domain';

export const adminRouter = Router();
const pg = (q: any) => ({ take: Math.min(Number(q.limit) || 25, 100), skip: (Math.max(Number(q.page) || 1, 1) - 1) * Math.min(Number(q.limit) || 25, 100) });

// ---- Orders ----
adminRouter.get('/orders', requirePerm('orders.read_all'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',') as any } } : {}),
    ...(q.driverId ? { driverId: q.driverId } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.businessId ? { businessId: q.businessId } : {}),
    ...(q.paymentMethod ? { paymentMethod: q.paymentMethod as any } : {}),
    ...(q.geoUnitId ? { stops: { some: { OR: [{ geoUnitId: q.geoUnitId }, { cityId: q.geoUnitId }, { governorateId: q.geoUnitId }] } } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    ...(q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { customer: { phone: { contains: q.q } } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, ...pg(q), select: { id: true, code: true, status: true, total: true, paymentMethod: true, createdAt: true,
      customer: { select: { id: true, name: true, phone: true } }, driver: { select: { id: true, user: { select: { name: true } } } }, business: { select: { id: true, nameAr: true } } } }),
    prisma.order.count({ where })]);
  res.json({ items, total });
}));
adminRouter.get('/orders/:id', requirePerm('orders.read_all'), ah(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { stops: true, history: { orderBy: { at: 'asc' } }, offers: true, payments: true, proofs: true, ratings: true,
    customer: { select: { id: true, name: true, phone: true } }, driver: { include: { user: { select: { name: true, phone: true } } } }, chat: { include: { messages: true } } } });
  if (!o) throw E.notFound('الطلب');
  const path = await prisma.driverLocation.findMany({ where: { orderId: o.id }, orderBy: { at: 'asc' }, select: { lat: true, lng: true, at: true } });
  const ledger = await prisma.walletTransaction.findMany({ where: { orderId: o.id } });
  res.json(JSON.parse(JSON.stringify({ ...o, deliveryOtpHash: undefined, path, ledger }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))));
}));
adminRouter.post('/orders/:id/cancel', requirePerm('orders.cancel'), ah(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  await cancelOrder(req.params.id, { type: 'OPERATIONS', id: req.user!.id }, reason);
  await audit(prisma, { actorId: req.user!.id, action: 'order.cancel', entityType: 'Order', entityId: req.params.id, after: { reason }, ip: req.ip });
  res.json({ ok: true });
}));
adminRouter.post('/orders/:id/reassign', requirePerm('orders.reassign'), ah(async (req, res) => {
  const { driverId, reason } = z.object({ driverId: z.string().optional(), reason: z.string().min(3) }).parse(req.body);
  const o = await prisma.order.findUniqueOrThrow({ where: { id: req.params.id } });
  if (o.driverId) await releaseDriver(o.id, { type: 'OPERATIONS', id: req.user!.id }, reason);
  else if (o.status === 'NEW') await startDispatch(o.id);
  if (driverId) { // direct manual assignment: create offer then accept atomically on behalf of ops
    await prisma.dispatchOffer.upsert({ where: { orderId_driverId: { orderId: o.id, driverId } }, update: { status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) }, create: { orderId: o.id, driverId, wave: 99, distanceKm: 0, expiresAt: new Date(Date.now() + 60_000) } });
    await acceptOffer(o.id, driverId);
  }
  await audit(prisma, { actorId: req.user!.id, action: 'order.reassign', entityType: 'Order', entityId: o.id, before: { driverId: o.driverId }, after: { driverId, reason }, ip: req.ip });
  res.json({ ok: true });
}));

// ---- Live operations (🟢 available, 🔵 busy, 🟠 searching, 🔴 problem/late) ----
adminRouter.get('/live', requirePerm('ops.live'), ah(async (_req, res) => {
  const since = new Date(Date.now() - 10 * 60_000);
  const [drivers, searching, active] = await Promise.all([
    prisma.driver.findMany({ where: { online: true, lastLocationAt: { gte: since } }, select: { id: true, lastLat: true, lastLng: true, activeOrders: true, user: { select: { name: true } } } }),
    prisma.order.findMany({ where: { status: 'SEARCHING_DRIVER' }, select: { id: true, code: true, createdAt: true, dispatchWave: true, stops: { where: { seq: 0 }, select: { lat: true, lng: true } } } }),
    prisma.order.findMany({ where: { status: { in: ACTIVE_DRIVER_STATUSES as any } }, select: { id: true, code: true, status: true, updatedAt: true, driverId: true, createdAt: true } }),
  ]);
  const lateMin = 45;
  res.json({
    drivers: drivers.map((d) => ({ ...d, marker: d.activeOrders ? 'BUSY_BLUE' : 'AVAILABLE_GREEN' })),
    orders: [
      ...searching.map((o) => ({ ...o, marker: Date.now() - +o.createdAt > 10 * 60_000 ? 'PROBLEM_RED' : 'SEARCHING_ORANGE' })),
      ...active.map((o) => ({ ...o, marker: o.status === 'FAILED_DELIVERY' || Date.now() - +o.createdAt > lateMin * 60_000 ? 'PROBLEM_RED' : 'ACTIVE_BLUE' })),
    ],
  });
}));

// ---- Drivers ----
adminRouter.get('/drivers', requirePerm('drivers.read'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: Prisma.DriverWhereInput = { ...(q.status ? { status: q.status as any } : {}), ...(q.q ? { user: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } } : {}) };
  const [items, total] = await Promise.all([prisma.driver.findMany({ where, ...pg(q), orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true, phone: true } }, vehicles: { include: { vehicleType: true } } } }), prisma.driver.count({ where })]);
  res.json({ items, total });
}));
adminRouter.get('/drivers/:id', requirePerm('drivers.read'), ah(async (req, res) => {
  const d = await prisma.driver.findUnique({ where: { id: req.params.id }, include: { user: true, vehicles: { include: { vehicleType: true } }, documents: true } });
  if (!d) throw E.notFound('المندوب');
  const [stats, wallet, ratings, signals] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { driverId: d.id }, _count: true }),
    prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'DRIVER', ownerId: d.id } } }),
    prisma.rating.findMany({ where: { rateeType: 'DRIVER', rateeId: d.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.fraudSignal.findMany({ where: { userId: d.userId }, orderBy: { createdAt: 'desc' }, take: 20 })]);
  res.json({ ...d, stats, wallet, ratings, signals });
}));
adminRouter.post('/drivers/:id/status', requirePerm('drivers.manage'), ah(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']), reason: z.string().optional() }).parse(req.body);
  const before = await prisma.driver.findUniqueOrThrow({ where: { id: req.params.id } });
  const d = await prisma.driver.update({ where: { id: req.params.id }, data: { status, rejectionReason: reason, ...(status !== 'APPROVED' ? { online: false } : {}) } });
  await audit(prisma, { actorId: req.user!.id, action: `driver.${status.toLowerCase()}`, entityType: 'Driver', entityId: d.id, before: { status: before.status }, after: { status, reason }, ip: req.ip });
  invalidateAuthCache(d.userId);
  await notify(d.userId, { type: 'DRIVER_STATUS', titleAr: 'مشاوير', bodyAr: status === 'APPROVED' ? 'تم قبول حسابك، يمكنك الآن استقبال الطلبات' : status === 'REJECTED' ? `تم رفض طلبك: ${reason ?? ''}` : 'تم إيقاف حسابك مؤقتًا' });
  res.json({ ok: true });
}));

// ---- Customers ----
adminRouter.get('/customers', requirePerm('customers.read'), ah(async (req, res) => {
  const q = String(req.query.q ?? '');
  const where: Prisma.UserWhereInput = { roles: { some: { role: { code: 'CUSTOMER' } } }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}) };
  const [items, total] = await Promise.all([prisma.user.findMany({ where, ...pg(req.query), select: { id: true, name: true, phone: true, status: true, createdAt: true, _count: { select: { orders: true } } } }), prisma.user.count({ where })]);
  res.json({ items, total });
}));
adminRouter.post('/users/:id/status', requirePerm('customers.manage'), ah(async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(req.body);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } });
  await prisma.user.update({ where: { id: before.id }, data: { status } });
  if (status === 'SUSPENDED') await prisma.session.updateMany({ where: { userId: before.id }, data: { revokedAt: new Date() } });
  invalidateAuthCache(before.id);
  await audit(prisma, { actorId: req.user!.id, action: 'user.status', entityType: 'User', entityId: before.id, before: { status: before.status }, after: { status }, ip: req.ip });
  res.json({ ok: true });
}));
adminRouter.post('/users/:id/roles', requirePerm('roles.manage'), ah(async (req, res) => {
  const { roles } = z.object({ roles: z.array(z.string()).min(1) }).parse(req.body);
  if (roles.includes('SUPER_ADMIN') && !req.user!.roles.includes('SUPER_ADMIN')) throw E.forbidden();
  const rs = await prisma.role.findMany({ where: { code: { in: roles } } });
  const before = await prisma.userRole.findMany({ where: { userId: req.params.id }, include: { role: true } });
  await prisma.$transaction([prisma.userRole.deleteMany({ where: { userId: req.params.id } }), prisma.userRole.createMany({ data: rs.map((r) => ({ userId: req.params.id, roleId: r.id })) })]);
  invalidateAuthCache(req.params.id);
  await audit(prisma, { actorId: req.user!.id, action: 'role.change', entityType: 'User', entityId: req.params.id, before: before.map((b) => b.role.code), after: roles, ip: req.ip });
  res.json({ ok: true });
}));

// ---- Generic audited CRUD for config tables (geo, pricing, packages, vehicles, coupons, commissions, failure reasons, hours) ----
const CRUD: Record<string, { model: any; perm: string; schema: z.ZodObject<any>; id?: string }> = {
  geo: { model: prisma.geoUnit, perm: 'geo.write', schema: z.object({ level: z.enum(['GOVERNORATE', 'CITY', 'DISTRICT', 'VILLAGE', 'AREA']), nameAr: z.string(), nameEn: z.string().optional(), parentId: z.string().nullable().optional(), centerLat: z.number(), centerLng: z.number(), radiusKm: z.number().positive(), active: z.boolean().default(true), extraFee: z.number().int().min(0).default(0) }) },
  'pricing-rules': { model: prisma.pricingRule, perm: 'pricing.write', schema: z.object({ name: z.string(), active: z.boolean().default(true), priority: z.number().int().default(0), governorateId: z.string().nullable().optional(), cityId: z.string().nullable().optional(), areaId: z.string().nullable().optional(), vehicleTypeCode: z.string().nullable().optional(), baseFare: z.number().int().min(0), perKm: z.number().int().min(0), includedKm: z.number().min(0), minimumFare: z.number().int().min(0), perKgOverIncluded: z.number().int().min(0), includedKg: z.number().min(0), urgentFee: z.number().int().min(0), scheduledFee: z.number().int().min(0), extraStopFee: z.number().int().min(0), waitingPerMinute: z.number().int().min(0), freeWaitingMinutes: z.number().int().min(0), returnFeePercent: z.number().min(0).max(100) }) },
  'commission-rules': { model: prisma.commissionRule, perm: 'finance.commission', schema: z.object({ active: z.boolean().default(true), vehicleTypeCode: z.string().nullable().optional(), governorateId: z.string().nullable().optional(), businessId: z.string().nullable().optional(), type: z.enum(['PERCENT', 'FIXED', 'PERCENT_PLUS_FIXED']), percent: z.number().min(0).max(100), fixed: z.number().int().min(0), min: z.number().int().nullable().optional(), max: z.number().int().nullable().optional() }) },
  'package-sizes': { model: prisma.packageSize, perm: 'pricing.write', id: 'code', schema: z.object({ code: z.string(), nameAr: z.string(), fee: z.number().int().min(0), multiplierBp: z.number().int().min(1000), maxKg: z.number().positive(), active: z.boolean().default(true) }) },
  'vehicle-types': { model: prisma.vehicleType, perm: 'pricing.write', schema: z.object({ code: z.string(), nameAr: z.string(), maxKg: z.number().positive(), maxVolumeL: z.number().optional(), avgSpeedKmh: z.number().positive(), active: z.boolean(), allowedSizes: z.array(z.string()) }) },
  coupons: { model: prisma.coupon, perm: 'coupons.write', schema: z.object({ code: z.string().transform((s) => s.toUpperCase()), type: z.enum(['PERCENT', 'FIXED']), value: z.number().int().positive(), maxDiscount: z.number().int().nullable().optional(), minOrder: z.number().int().nullable().optional(), startsAt: z.coerce.date().nullable().optional(), expiresAt: z.coerce.date().nullable().optional(), maxUses: z.number().int().nullable().optional(), maxUsesPerUser: z.number().int().default(1), userIds: z.array(z.string()).default([]), geoUnitIds: z.array(z.string()).default([]), active: z.boolean().default(true) }) },
  'failure-reasons': { model: prisma.failureReason, perm: 'settings.write', id: 'code', schema: z.object({ code: z.string(), nameAr: z.string(), requiresPhoto: z.boolean(), nextAction: z.enum(['RETRY', 'RETURN', 'CONTACT_SUPPORT']), appliesTo: z.string() }) },
  'operating-hours': { model: prisma.operatingHours, perm: 'settings.write', schema: z.object({ scope: z.enum(['PLATFORM', 'GEO', 'DRIVER']), geoUnitId: z.string().nullable().optional(), driverId: z.string().nullable().optional(), weekday: z.number().int().min(0).max(6), opensAt: z.string().regex(/^\d\d:\d\d$/), closesAt: z.string().regex(/^\d\d:\d\d$/) }) },
};
for (const [name, c] of Object.entries(CRUD)) {
  const idField = c.id ?? 'id';
  adminRouter.get(`/${name}`, requirePerm(c.perm.split('.')[0] + '.read'), ah(async (req, res) => {
    const where = name === 'geo' && req.query.parentId !== undefined ? { parentId: req.query.parentId ? String(req.query.parentId) : null } : {};
    res.json(await c.model.findMany({ where, take: 500 }));
  }));
  adminRouter.post(`/${name}`, requirePerm(c.perm), ah(async (req, res) => {
    const row = await c.model.create({ data: c.schema.parse(req.body) });
    await audit(prisma, { actorId: req.user!.id, action: `${name}.create`, entityType: name, entityId: row[idField], after: row, ip: req.ip });
    res.status(201).json(row);
  }));
  adminRouter.patch(`/${name}/:id`, requirePerm(c.perm), ah(async (req, res) => {
    const before = await c.model.findUnique({ where: { [idField]: req.params.id } });
    if (!before) throw E.notFound();
    const row = await c.model.update({ where: { [idField]: req.params.id }, data: c.schema.partial().parse(req.body) });
    await audit(prisma, { actorId: req.user!.id, action: `${name}.update`, entityType: name, entityId: req.params.id, before, after: row, ip: req.ip });
    res.json(row);
  }));
}

// ---- Settings ----
adminRouter.get('/settings', requirePerm('settings.read'), ah(async (_req, res) => {
  const rows = await prisma.setting.findMany();
  res.json(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, { ...(DEFAULTS as any)[k], ...((rows.find((r) => r.key === k)?.value as object) ?? {}) }])));
}));
adminRouter.put('/settings/:key', requirePerm('settings.write'), ah(async (req, res) => {
  if (!(req.params.key in DEFAULTS)) throw E.notFound('الإعداد');
  const before = await prisma.setting.findUnique({ where: { key: req.params.key } });
  const row = await prisma.setting.upsert({ where: { key: req.params.key }, update: { value: req.body }, create: { key: req.params.key, value: req.body } });
  clearSettingsCache();
  await audit(prisma, { actorId: req.user!.id, action: 'settings.update', entityType: 'Setting', entityId: req.params.key, before: before?.value, after: req.body, ip: req.ip });
  res.json(row);
}));

// ---- Finance: wallets, settlements, adjustments ----
adminRouter.get('/finance/driver-balances', requirePerm('finance.read'), ah(async (_req, res) => {
  res.json(await prisma.wallet.findMany({ where: { ownerType: 'DRIVER', balance: { lt: 0 } }, orderBy: { balance: 'asc' }, take: 200 }));
}));
adminRouter.post('/finance/settlements', requirePerm('finance.settle'), ah(async (req, res) => {
  const b = z.object({ driverId: z.string(), amount: z.number().int().positive(), method: z.enum(['CASH', 'BANK', 'MOBILE_WALLET', 'INSTAPAY']), reference: z.string().optional() }).parse(req.body);
  const s = await prisma.$transaction(async (tx) => {
    const s = await tx.settlement.create({ data: { ...b, createdById: req.user!.id } });
    await post(tx, { ownerType: 'DRIVER', ownerId: b.driverId, type: 'SETTLEMENT', amount: b.amount, settlementId: s.id, createdById: req.user!.id, idempotencyKey: `stl:${s.id}` });
    await audit(tx, { actorId: req.user!.id, action: 'wallet.settlement', entityType: 'Driver', entityId: b.driverId, after: b, ip: req.ip });
    return s;
  });
  res.status(201).json(s);
}));
adminRouter.post('/finance/adjust', requirePerm('finance.adjust'), ah(async (req, res) => {
  const b = z.object({ ownerType: z.enum(['CUSTOMER', 'DRIVER', 'BUSINESS']), ownerId: z.string(), amount: z.number().int(), note: z.string().min(5) }).parse(req.body);
  const t = await prisma.$transaction(async (tx) => {
    const t = await post(tx, { ...b, type: 'ADJUSTMENT', createdById: req.user!.id, allowNegative: true });
    await audit(tx, { actorId: req.user!.id, action: 'wallet.adjust', entityType: b.ownerType, entityId: b.ownerId, after: b, ip: req.ip });
    return t;
  });
  res.status(201).json(t);
}));

// ---- Support ----
adminRouter.get('/tickets', requirePerm('support.read'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  res.json(await prisma.supportTicket.findMany({ where: { ...(q.status ? { status: q.status as any } : {}), ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}), ...(q.q ? { OR: [{ code: { contains: q.q } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}) }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], ...pg(q) }));
}));
adminRouter.post('/tickets/:id/reply', requirePerm('support.write'), ah(async (req, res) => {
  const b = z.object({ body: z.string().min(1), internal: z.boolean().default(false), status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']).optional(), assigneeId: z.string().optional() }).parse(req.body);
  const t = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { ...(b.status ? { status: b.status } : {}), assigneeId: b.assigneeId ?? req.user!.id, messages: { create: { senderId: req.user!.id, body: b.body, internal: b.internal } } } });
  if (!b.internal) await notify(t.userId, { type: 'SUPPORT_REPLY', titleAr: 'رد من دعم مشاوير', bodyAr: b.body.slice(0, 120), deepLink: `mashawir://support/${t.id}` });
  res.json({ ok: true });
}));

adminRouter.get('/audit-logs', requirePerm('audit.read'), ah(async (req, res) => {
  const rows = await prisma.auditLog.findMany({ where: { ...(req.query.entityType ? { entityType: String(req.query.entityType) } : {}), ...(req.query.actorId ? { actorId: String(req.query.actorId) } : {}) }, orderBy: { at: 'desc' }, ...pg(req.query) });
  res.json(rows.map((r) => ({ ...r, id: r.id.toString() })));
}));
adminRouter.get('/fraud-signals', requirePerm('audit.read'), ah(async (_req, res) => res.json(await prisma.fraudSignal.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 }))));

adminRouter.post('/broadcast/drivers', requirePerm('ops.live'), ah(async (req, res) => {
  const { bodyAr } = z.object({ bodyAr: z.string().min(3).max(300) }).parse(req.body);
  const ds = await prisma.driver.findMany({ where: { status: 'APPROVED' }, select: { userId: true, id: true } });
  for (const d of ds) { await notify(d.userId, { type: 'ADMIN_MESSAGE', titleAr: 'رسالة من الإدارة', bodyAr }); emit(`driver:${d.id}`, 'admin:message', { bodyAr }); }
  res.json({ sent: ds.length });
}));
