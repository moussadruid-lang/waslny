import { Router, type Request } from 'express';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ACTIVE_DRIVER_STATUSES, TERMINAL, etaMinutes, haversineKm, nextStatuses, type OrderStatus } from '@mashawir/domain';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { requirePerm, invalidateAuthCache, can } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { idempotent, idemKey } from '../lib/idempotency.ts';
import { orderFilters, orderWhereSql, num, json, paging, pageOut, parseRange } from '../lib/sql.ts';
import { acceptOffer, cancelOrder, releaseDriver, startDispatch, transition, failDelivery, completeReturn } from './orders.service.ts';
import { post, PLATFORM_ID } from './ledger.ts';
import { clearSettingsCache, DEFAULTS, SETTING_SCHEMAS, getSetting } from './settings.ts';
import { notify } from './notify.ts';
import { emit, realtimeStats } from './realtime.ts';
import { isValidPolygon } from './geo.ts';
import { newTrackingToken } from './tracking.ts';
import { BroadcastInput, recipientsWhere } from './broadcast.ts';
import { queues, redis } from '../jobs/queues.ts';
import { STAFF_ROLES } from './staff.routes.ts';
import { env } from '../config.ts';
import { EgPhone } from './auth.ts';

/**
 * Admin / Operations / Finance / Support API. Every route is permission-gated server-side; the dashboard only hides
 * what the server would refuse anyway. Every write is audited. All aggregates are computed in SQL.
 */
export const adminRouter = Router();
const OPS = (req: Request) => ({ type: 'OPERATIONS' as const, id: req.user!.id });
const ip = (req: Request) => req.ip;
const Reason = z.string().trim().min(3, 'اكتب السبب (3 أحرف على الأقل)').max(300);
const isSuper = (req: Request) => req.user!.roles.includes('SUPER_ADMIN');
const mask = (s?: string | null) => (s ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : null);
const qs = (req: Request) => req.query as Record<string, string | undefined>;

async function findOrder(id: string) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) throw E.notFound('الطلب');
  return o;
}

// ======================= Dashboard =======================
adminRouter.get('/dashboard', requirePerm('reports.read'), ah(async (req, res) => {
  const f = orderFilters(req.query, 7);
  const w = orderWhereSql(f);
  const fresh = new Date(Date.now() - (await getSetting('dispatch')).maxLocationAgeSec * 1000);
  const [k] = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
      COUNT(*) FILTER (WHERE o.status = 'CANCELLED') AS cancelled,
      COUNT(*) FILTER (WHERE o.status = 'FAILED_DELIVERY') AS failed,
      COUNT(*) FILTER (WHERE o.status IN ('RETURNING','RETURNED')) AS returned,
      COUNT(*) FILTER (WHERE o.status::text = ANY(${ACTIVE_DRIVER_STATUSES as string[]})) AS active,
      COUNT(*) FILTER (WHERE o.status IN ('NEW','SEARCHING_DRIVER')) AS searching,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DELIVERED'), 0)::bigint AS revenue,
      COALESCE(SUM(o.discount) FILTER (WHERE o.status = 'DELIVERED'), 0)::bigint AS discounts,
      COALESCE(SUM(o."codAmount") FILTER (WHERE o.status = 'DELIVERED'), 0)::bigint AS cod,
      AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt")) / 60) FILTER (WHERE o.status = 'DELIVERED')::float AS avg_delivery_min
    FROM "Order" o WHERE ${w}`;
  const [c] = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM(c.commission),0)::bigint AS commission, COALESCE(SUM(c."driverEarning"),0)::bigint AS driver_earnings
    FROM "Commission" c JOIN "Order" o ON o.id = c."orderId" WHERE ${w}`;
  const series = await prisma.$queryRaw<any[]>`
    SELECT to_char(date_trunc('day', o."createdAt" AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM-DD') AS day, COUNT(*) AS orders,
      COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered, COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DELIVERED'),0)::bigint AS revenue
    FROM "Order" o WHERE ${w} GROUP BY 1 ORDER BY 1`;
  const [onlineDrivers, busyDrivers, pendingDrivers, openTickets, urgentTickets, fraudOpen] = await Promise.all([
    prisma.driver.count({ where: { online: true, status: 'APPROVED', lastLocationAt: { gte: fresh } } }),
    prisma.driver.count({ where: { online: true, activeOrders: { gt: 0 } } }),
    prisma.driver.count({ where: { status: 'PENDING' } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_USER'] } } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'URGENT' } }),
    prisma.fraudSignal.count({ where: { resolvedAt: null } }),
  ]);
  const kk = num(k) as any; const total = kk.total || 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  res.json({
    range: { from: f.from, to: f.to },
    kpis: { ...kk, ...num(c), deliveryRate: pct(kk.delivered), cancelRate: pct(kk.cancelled), failRate: pct(kk.failed), platformNet: Number(c.commission) - Number(kk.discounts) },
    now: { onlineDrivers, busyDrivers, availableDrivers: Math.max(0, onlineDrivers - busyDrivers), pendingDrivers, openTickets, urgentTickets, fraudOpen },
    series: series.map(num),
  });
}));

// ======================= Live operations =======================
// Markers: 🟢 AVAILABLE_GREEN driver, 🔵 BUSY_BLUE driver / ACTIVE_BLUE order, 🟠 SEARCHING_ORANGE, 🔴 PROBLEM_RED (late / failed / stuck)
adminRouter.get('/live', requirePerm('ops.live'), ah(async (req, res) => {
  const q = qs(req);
  const [dispatch, ops] = await Promise.all([getSetting('dispatch'), getSetting('ops')]);
  const fresh = new Date(Date.now() - Math.max(dispatch.maxLocationAgeSec, 300) * 1000);
  const geo = q.geoUnitId ? { stops: { some: { OR: [{ geoUnitId: q.geoUnitId }, { cityId: q.geoUnitId }, { governorateId: q.geoUnitId }] } } } : {};
  const [drivers, orders] = await Promise.all([
    prisma.driver.findMany({ where: { online: true, status: 'APPROVED', lastLocationAt: { gte: fresh }, ...(q.geoUnitId ? { serviceAreaIds: { has: q.geoUnitId } } : {}) },
      select: { id: true, lastLat: true, lastLng: true, lastLocationAt: true, activeOrders: true, rating: true, user: { select: { name: true, phone: true } }, vehicles: { where: { isPrimary: true }, select: { vehicleType: { select: { code: true, nameAr: true } } } } } }),
    prisma.order.findMany({ where: { status: { in: ['NEW', 'SEARCHING_DRIVER', ...ACTIVE_DRIVER_STATUSES] as any }, ...geo }, orderBy: { createdAt: 'asc' }, take: 1000,
      select: { id: true, code: true, status: true, createdAt: true, updatedAt: true, dispatchWave: true, driverId: true, urgent: true, total: true, codAmount: true, businessId: true,
        stops: { orderBy: { seq: 'asc' }, select: { type: true, lat: true, lng: true, formatted: true, completedAt: true } }, business: { select: { nameAr: true } } } }),
  ]);
  const now = Date.now();
  const byDriver = new Map(drivers.map((d) => [d.id, d]));
  const picked = (s: string) => ['PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'FAILED_DELIVERY', 'RETURNING'].includes(s);
  const outOrders = orders.map((o) => {
    const ageMin = Math.round((now - +o.createdAt) / 60_000);
    const pickup = o.stops[0]; const drop = o.stops.find((s) => s.type === 'DROPOFF' && !s.completedAt) ?? o.stops.at(-1);
    const d = o.driverId ? byDriver.get(o.driverId) : undefined;
    const target = picked(o.status) ? drop : pickup;
    const eta = d?.lastLat != null && target ? etaMinutes(haversineKm({ lat: d.lastLat, lng: d.lastLng! }, target) * 1.3, 30) : null;
    const searching = o.status === 'NEW' || o.status === 'SEARCHING_DRIVER';
    const problems: string[] = [];
    if (searching && ageMin > ops.searchingAlertMinutes) problems.push('NO_DRIVER_TOO_LONG');
    if (!searching && ageMin > ops.deliveryLateMinutes) problems.push('LATE');
    if (o.status === 'FAILED_DELIVERY') problems.push('FAILED');
    if (o.driverId && !d) problems.push('DRIVER_SIGNAL_LOST');
    return { ...o, ageMin, etaMinutes: eta, problems, marker: problems.length ? 'PROBLEM_RED' : searching ? 'SEARCHING_ORANGE' : 'ACTIVE_BLUE', lat: (picked(o.status) ? drop : pickup)?.lat, lng: (picked(o.status) ? drop : pickup)?.lng };
  });
  const outDrivers = drivers.map((d) => ({ id: d.id, name: d.user.name, phone: d.user.phone, lat: d.lastLat, lng: d.lastLng, lastLocationAt: d.lastLocationAt, activeOrders: d.activeOrders, rating: d.rating,
    vehicle: d.vehicles[0]?.vehicleType ?? null, marker: d.activeOrders ? 'BUSY_BLUE' : 'AVAILABLE_GREEN' }));
  const driverMarker = q.marker === 'AVAILABLE_GREEN' || q.marker === 'BUSY_BLUE';
  const filteredOrders = !q.marker ? outOrders : driverMarker ? [] : outOrders.filter((o) => o.marker === q.marker);
  const filteredDrivers = !q.marker ? outDrivers : driverMarker ? outDrivers.filter((d) => d.marker === q.marker) : [];
  res.json({
    serverTime: new Date(), thresholds: ops,
    counts: { available: outDrivers.filter((d) => d.marker === 'AVAILABLE_GREEN').length, busy: outDrivers.filter((d) => d.marker === 'BUSY_BLUE').length,
      searching: outOrders.filter((o) => o.marker === 'SEARCHING_ORANGE').length, active: outOrders.filter((o) => o.marker === 'ACTIVE_BLUE').length, problems: outOrders.filter((o) => o.marker === 'PROBLEM_RED').length },
    drivers: filteredDrivers, orders: filteredOrders,
  });
}));

/** Closest eligible drivers for manual assignment (approved, online, fresh GPS, capacity, vehicle type). */
adminRouter.get('/orders/:id/candidates', requirePerm('orders.reassign'), ah(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { stops: { orderBy: { seq: 'asc' }, take: 1 } } });
  if (!o) throw E.notFound('الطلب');
  const dispatch = await getSetting('dispatch');
  const fresh = new Date(Date.now() - Math.max(dispatch.maxLocationAgeSec, 300) * 1000);
  const ds = await prisma.driver.findMany({ where: { status: 'APPROVED', online: true, lastLocationAt: { gte: fresh }, activeOrders: { lt: dispatch.maxActiveOrdersPerDriver }, id: o.driverId ? { not: o.driverId } : undefined,
    vehicles: { some: { vehicleType: { code: o.vehicleTypeCode } } } }, select: { id: true, lastLat: true, lastLng: true, lastLocationAt: true, activeOrders: true, rating: true, user: { select: { name: true, phone: true } } }, take: 300 });
  const p = o.stops[0];
  res.json(ds.map((d) => ({ ...d, name: d.user.name, phone: d.user.phone, distanceKm: Math.round(haversineKm({ lat: d.lastLat!, lng: d.lastLng! }, p) * 10) / 10 }))
    .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 20));
}));

// ======================= Orders =======================
const ORDER_SORT: Record<string, Prisma.OrderOrderByWithRelationInput> = { createdAt: { createdAt: 'desc' }, '-createdAt': { createdAt: 'asc' }, total: { total: 'desc' }, '-total': { total: 'asc' }, updatedAt: { updatedAt: 'desc' } };
adminRouter.get('/orders', requirePerm('orders.read_all'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const range = q.from || q.to ? parseRange(q) : null;
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',') as any } } : {}),
    ...(q.driverId ? { driverId: q.driverId } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.businessId ? { businessId: q.businessId } : {}),
    ...(q.paymentMethod ? { paymentMethod: q.paymentMethod as any } : {}), ...(q.vehicleTypeCode ? { vehicleTypeCode: q.vehicleTypeCode } : {}),
    ...(q.cod === '1' ? { codAmount: { gt: 0 } } : {}), ...(q.urgent === '1' ? { urgent: true } : {}),
    ...(q.geoUnitId ? { stops: { some: { OR: [{ geoUnitId: q.geoUnitId }, { cityId: q.geoUnitId }, { governorateId: q.geoUnitId }] } } } : {}),
    ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
    ...(q.q ? { OR: [{ code: { contains: q.q.trim(), mode: 'insensitive' } }, { customer: { phone: { contains: q.q.trim() } } }, { customer: { name: { contains: q.q.trim(), mode: 'insensitive' } } },
      { stops: { some: { contactPhone: { contains: q.q.trim() } } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: ORDER_SORT[q.sort ?? 'createdAt'] ?? ORDER_SORT.createdAt, take: p.take, skip: p.skip,
      select: { id: true, code: true, status: true, total: true, codAmount: true, paymentMethod: true, urgent: true, createdAt: true, deliveredAt: true, vehicleTypeCode: true,
        customer: { select: { id: true, name: true, phone: true } }, driver: { select: { id: true, user: { select: { name: true } } } }, business: { select: { id: true, nameAr: true } },
        stops: { orderBy: { seq: 'asc' }, select: { type: true, formatted: true, geoUnitId: true } } } }),
    prisma.order.count({ where })]);
  res.json(pageOut(items, total, p));
}));

adminRouter.get('/orders/:id', requirePerm('orders.read_all'), ah(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { stops: { orderBy: { seq: 'asc' } }, history: { orderBy: { at: 'asc' } }, offers: { orderBy: { createdAt: 'desc' }, take: 50 },
    payments: true, proofs: true, ratings: true, items: true, business: { select: { id: true, nameAr: true } },
    customer: { select: { id: true, name: true, phone: true } }, driver: { include: { user: { select: { name: true, phone: true } } } } } });
  if (!o) throw E.notFound('الطلب');
  const canChat = can(req.user, 'orders.chat_read');
  const [path, ledger, commission, auditRows, chat, coupon] = await Promise.all([
    prisma.driverLocation.findMany({ where: { orderId: o.id }, orderBy: { at: 'asc' }, take: 2000, select: { lat: true, lng: true, at: true, suspicious: true } }),
    can(req.user, 'finance.read') || can(req.user, 'orders.read_all') ? prisma.walletTransaction.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' }, include: { wallet: { select: { ownerType: true, ownerId: true } } } }) : [],
    prisma.commission.findUnique({ where: { orderId: o.id } }),
    prisma.auditLog.findMany({ where: { entityType: 'Order', entityId: o.id }, orderBy: { at: 'desc' }, take: 50 }),
    prisma.chat.findUnique({ where: { orderId: o.id }, include: canChat ? { messages: { orderBy: { createdAt: 'asc' } } } : { _count: { select: { messages: true } } } as any }),
    o.couponId ? prisma.coupon.findUnique({ where: { id: o.couponId }, select: { code: true, type: true, value: true } }) : null,
  ]);
  const { deliveryOtpHash, trackingToken, ...safe } = o;
  res.json(json({ ...safe, trackingPath: `/track/${trackingToken}`, path, ledger, commission, audit: auditRows, coupon,
    chat: canChat ? chat : { messageCount: (chat as any)?._count?.messages ?? 0, hidden: true },
    allowedActions: nextStatuses(o.status as OrderStatus, 'OPERATIONS'), terminal: TERMINAL.includes(o.status as OrderStatus) }));
}));

adminRouter.post('/orders/:id/cancel', requirePerm('orders.cancel'), ah(async (req, res) => {
  const { reason } = z.object({ reason: Reason }).parse(req.body);
  const o = await findOrder(req.params.id);
  await cancelOrder(o.id, OPS(req), reason);
  await audit(prisma, { actorId: req.user!.id, action: 'order.cancel', entityType: 'Order', entityId: o.id, before: { status: o.status, driverId: o.driverId }, after: { status: 'CANCELLED', reason }, ip: ip(req) });
  res.json({ ok: true });
}));

/**
 * Reassign: release current driver (if any) then either auto-redispatch or atomically assign the chosen driver.
 * Not allowed once the package is with a driver (picked up): that requires a return flow, not a swap.
 */
adminRouter.post('/orders/:id/reassign', requirePerm('orders.reassign'), ah(async (req, res) => {
  const { driverId, reason } = z.object({ driverId: z.string().optional(), reason: Reason }).parse(req.body);
  const o = await findOrder(req.params.id);
  const allowed = ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP'];
  if (!allowed.includes(o.status)) throw E.conflict('REASSIGN_NOT_ALLOWED', 'لا يمكن إعادة التعيين بعد استلام الشحنة أو بعد انتهاء الطلب');
  if (driverId) {
    if (driverId === o.driverId) throw E.bad('SAME_DRIVER', 'هذا المندوب معيّن بالفعل');
    const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { vehicles: { include: { vehicleType: true } } } });
    if (!d) throw E.notFound('المندوب');
    if (d.status !== 'APPROVED') throw E.bad('DRIVER_NOT_APPROVED', 'المندوب غير معتمد');
    if (!d.vehicles.some((v) => v.vehicleType.code === o.vehicleTypeCode)) throw E.bad('VEHICLE_MISMATCH', 'مركبة المندوب لا تناسب الطلب');
  }
  if (o.driverId) await releaseDriver(o.id, OPS(req), reason, !driverId);
  else if (o.status === 'NEW') await startDispatch(o.id, OPS(req));
  if (driverId) await acceptOffer(o.id, driverId, { userId: req.user!.id, reason });
  else if (o.status === 'SEARCHING_DRIVER' && !o.driverId) await queues.dispatch.add('wave', { orderId: o.id, wave: 0 }, { jobId: `wave:${o.id}:0:${Date.now()}` });
  await audit(prisma, { actorId: req.user!.id, action: 'order.reassign', entityType: 'Order', entityId: o.id, before: { driverId: o.driverId, status: o.status }, after: { driverId: driverId ?? null, mode: driverId ? 'MANUAL' : 'AUTO', reason }, ip: ip(req) });
  res.json({ ok: true });
}));

const OpsAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('START_DISPATCH'), reason: Reason }),
  z.object({ action: z.literal('REDISPATCH'), reason: Reason }),
  z.object({ action: z.literal('MARK_FAILED'), reason: Reason, reasonCode: z.string() }),
  z.object({ action: z.literal('RETRY_DELIVERY'), reason: Reason }),
  z.object({ action: z.literal('START_RETURN'), reason: Reason }),
  z.object({ action: z.literal('COMPLETE_RETURN'), reason: Reason }),
]);
adminRouter.post('/orders/:id/ops-action', requirePerm('orders.reassign'), ah(async (req, res) => {
  const b = OpsAction.parse(req.body);
  const o = await findOrder(req.params.id);
  switch (b.action) {
    case 'START_DISPATCH': await startDispatch(o.id, OPS(req)); break;
    case 'REDISPATCH':
      if (o.status !== 'SEARCHING_DRIVER') throw E.conflict('INVALID_TRANSITION', 'الطلب ليس في حالة البحث عن مندوب');
      await prisma.order.update({ where: { id: o.id }, data: { dispatchWave: 0 } });
      await prisma.dispatchOffer.updateMany({ where: { orderId: o.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await queues.dispatch.add('wave', { orderId: o.id, wave: 0 }, { jobId: `wave:${o.id}:0:${Date.now()}` });
      break;
    case 'MARK_FAILED': await failDelivery(o.id, OPS(req), b.reasonCode); break;
    case 'RETRY_DELIVERY': await transition(o.id, 'IN_DELIVERY', OPS(req), { reason: b.reason }); break;
    case 'START_RETURN': await transition(o.id, 'RETURNING', OPS(req), { reason: b.reason }); break;
    case 'COMPLETE_RETURN': await completeReturn(o.id, OPS(req)); break;
  }
  await audit(prisma, { actorId: req.user!.id, action: `order.ops.${b.action.toLowerCase()}`, entityType: 'Order', entityId: o.id, before: { status: o.status }, after: b, ip: ip(req) });
  res.json({ ok: true });
}));

/** Partial/full refund to the customer wallet from the platform. Idempotent; can never exceed what was paid. */
adminRouter.post('/orders/:id/refund', requirePerm('finance.adjust'), ah(async (req, res) => {
  const b = z.object({ amount: z.number().int().positive(), reason: Reason }).parse(req.body);
  const r = await idempotent(`refund:${req.params.id}`, idemKey(req), async () => {
    const o = await findOrder(req.params.id);
    const t = await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: o.customerId } } });
      const prev = w ? await tx.walletTransaction.aggregate({ where: { walletId: w.id, orderId: o.id, type: { in: ['REFUND', 'MANUAL_REFUND'] } }, _sum: { amount: true } }) : null;
      const refunded = prev?._sum.amount ?? 0;
      if (refunded + b.amount > o.total) throw E.bad('REFUND_TOO_LARGE', `أقصى مبلغ متاح للاسترداد ${(o.total - refunded) / 100} ج.م`);
      const credit = await post(tx, { ownerType: 'CUSTOMER', ownerId: o.customerId, type: 'MANUAL_REFUND', amount: b.amount, orderId: o.id, createdById: req.user!.id, note: b.reason });
      await post(tx, { ownerType: 'PLATFORM', ownerId: PLATFORM_ID, type: 'MANUAL_REFUND', amount: -b.amount, orderId: o.id, createdById: req.user!.id, note: b.reason, allowNegative: true });
      if (refunded + b.amount === o.total) await tx.payment.updateMany({ where: { orderId: o.id }, data: { status: 'REFUNDED' } });
      await audit(tx, { actorId: req.user!.id, action: 'order.refund', entityType: 'Order', entityId: o.id, before: { refunded }, after: { amount: b.amount, reason: b.reason }, ip: ip(req) });
      return credit;
    });
    await notify(o.customerId, { type: 'REFUND', titleAr: 'مشاوير', bodyAr: `تم رد ${b.amount / 100} ج.م إلى محفظتك للطلب ${o.code}` });
    return { status: 201, body: { ok: true, transactionId: t.id } };
  }, { required: true });
  res.status(r.status).json(r.body);
}));

/** Revoke the public link: rotates to a new random token; old links stop working immediately (and live viewers are kicked). */
adminRouter.post('/orders/:id/tracking/rotate', requirePerm('orders.reassign'), ah(async (req, res) => {
  const { reason } = z.object({ reason: Reason }).parse(req.body);
  const o = await findOrder(req.params.id);
  const token = newTrackingToken();
  await prisma.order.update({ where: { id: o.id }, data: { trackingToken: token } });
  emit(`track:${o.trackingToken}`, 'track:revoked', { at: new Date() });
  await audit(prisma, { actorId: req.user!.id, action: 'order.tracking.rotate', entityType: 'Order', entityId: o.id, after: { reason }, ip: ip(req) });
  res.json({ ok: true, trackingPath: `/track/${token}`, trackingUrl: `${env.PUBLIC_TRACKING_BASE_URL}/${token}` });
}));

// ======================= Drivers =======================
adminRouter.get('/drivers', requirePerm('drivers.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.DriverWhereInput = {
    ...(q.status ? { status: q.status as any } : {}), ...(q.online ? { online: q.online === '1' } : {}),
    ...(q.vehicleTypeCode ? { vehicles: { some: { vehicleType: { code: q.vehicleTypeCode } } } } : {}),
    ...(q.geoUnitId ? { serviceAreaIds: { has: q.geoUnitId } } : {}),
    ...(q.q ? { user: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driver.findMany({ where, take: p.take, skip: p.skip, orderBy: q.sort === 'rating' ? { rating: 'desc' } : { createdAt: 'desc' },
      select: { id: true, status: true, online: true, activeOrders: true, rating: true, ratingCount: true, acceptanceRate: true, lastLocationAt: true, createdAt: true, serviceAreaIds: true,
        user: { select: { id: true, name: true, phone: true, status: true } }, vehicles: { select: { plate: true, model: true, vehicleType: { select: { code: true, nameAr: true } } } }, _count: { select: { documents: true } } } }),
    prisma.driver.count({ where })]);
  const wallets = await prisma.wallet.findMany({ where: { ownerType: 'DRIVER', ownerId: { in: items.map((d) => d.id) } }, select: { ownerId: true, balance: true } });
  res.json(pageOut(items.map((d) => ({ ...d, balance: wallets.find((w) => w.ownerId === d.id)?.balance ?? 0 })), total, p));
}));

adminRouter.get('/drivers/:id', requirePerm('drivers.read'), ah(async (req, res) => {
  const d = await prisma.driver.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true, avatarUrl: true } },
    vehicles: { include: { vehicleType: true } }, documents: { orderBy: { createdAt: 'desc' } } } });
  if (!d) throw E.notFound('المندوب');
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byStatus, wallet, ratings, signals, current, earn, settlements, failed, recentOrderIds, areas] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { driverId: d.id }, _count: true }),
    prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'DRIVER', ownerId: d.id } } }),
    prisma.rating.findMany({ where: { rateeType: 'DRIVER', rateeId: d.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.fraudSignal.findMany({ where: { userId: d.userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.findMany({ where: { driverId: d.id, status: { in: ACTIVE_DRIVER_STATUSES as any } }, select: { id: true, code: true, status: true, createdAt: true } }),
    prisma.commission.aggregate({ where: { driverId: d.id, createdAt: { gte: since } }, _sum: { commission: true, driverEarning: true }, _count: true }),
    prisma.settlement.findMany({ where: { driverId: d.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.findMany({ where: { driverId: d.id, status: { in: ['FAILED_DELIVERY', 'RETURNING', 'RETURNED'] } }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, code: true, status: true, failReason: true, updatedAt: true } }),
    prisma.order.findMany({ where: { driverId: d.id }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true } }),
    prisma.geoUnit.findMany({ where: { id: { in: d.serviceAreaIds } }, select: { id: true, nameAr: true, level: true } }),
  ]);
  const complaints = recentOrderIds.length ? await prisma.supportTicket.findMany({ where: { orderId: { in: recentOrderIds.map((o) => o.id) }, category: 'DRIVER' }, orderBy: { createdAt: 'desc' }, take: 20 }) : [];
  res.json(json({ ...d, nationalIdNo: can(req.user, 'drivers.manage') ? d.nationalIdNo : mask(d.nationalIdNo), stats: byStatus, wallet, ratings, signals, currentOrders: current,
    earnings30d: { deliveries: earn._count, commission: earn._sum.commission ?? 0, driverEarning: earn._sum.driverEarning ?? 0 }, settlements, failed, complaints, serviceAreas: areas,
    location: d.lastLat != null ? { lat: d.lastLat, lng: d.lastLng, at: d.lastLocationAt } : null }));
}));

adminRouter.post('/drivers/:id/status', requirePerm('drivers.manage'), ah(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']), reason: z.string().max(300).optional() }).parse(req.body);
  if (status !== 'APPROVED' && !reason?.trim()) throw E.bad('REASON_REQUIRED', 'اكتب سبب الرفض أو الإيقاف');
  const before = await prisma.driver.findUnique({ where: { id: req.params.id }, include: { vehicles: true } });
  if (!before) throw E.notFound('المندوب');
  if (status === 'APPROVED' && (!before.nationalIdNo || !before.vehicles.length)) throw E.bad('INCOMPLETE_PROFILE', 'بيانات المندوب غير مكتملة (الرقم القومي / المركبة)');
  const d = await prisma.driver.update({ where: { id: before.id }, data: { status, rejectionReason: status === 'APPROVED' ? null : reason, ...(status !== 'APPROVED' ? { online: false } : {}) } });
  await audit(prisma, { actorId: req.user!.id, action: `driver.${status.toLowerCase()}`, entityType: 'Driver', entityId: d.id, before: { status: before.status }, after: { status, reason }, ip: ip(req) });
  invalidateAuthCache(d.userId);
  emit(`driver:${d.id}`, 'driver:status', { status });
  await notify(d.userId, { type: 'DRIVER_STATUS', titleAr: 'مشاوير', bodyAr: status === 'APPROVED' ? 'تم قبول حسابك، يمكنك الآن استقبال الطلبات' : status === 'REJECTED' ? `تم رفض طلبك: ${reason ?? ''}` : 'تم إيقاف حسابك مؤقتًا' });
  res.json({ ok: true, activeOrders: before.activeOrders });
}));

adminRouter.post('/drivers/:id/documents/:docId', requirePerm('drivers.manage'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(300).optional() }).parse(req.body);
  const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.docId, driverId: req.params.id } });
  if (!doc) throw E.notFound('المستند');
  await prisma.driverDocument.update({ where: { id: doc.id }, data: { status: b.status, note: b.note } });
  await audit(prisma, { actorId: req.user!.id, action: 'driver.document.review', entityType: 'Driver', entityId: req.params.id, before: { docId: doc.id, status: doc.status }, after: b, ip: ip(req) });
  res.json({ ok: true });
}));

adminRouter.put('/drivers/:id/service-areas', requirePerm('drivers.manage'), ah(async (req, res) => {
  const { geoUnitIds } = z.object({ geoUnitIds: z.array(z.string()).max(50) }).parse(req.body);
  const found = await prisma.geoUnit.count({ where: { id: { in: geoUnitIds } } });
  if (found !== new Set(geoUnitIds).size) throw E.bad('BAD_AREA', 'منطقة غير موجودة');
  const before = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!before) throw E.notFound('المندوب');
  await prisma.driver.update({ where: { id: before.id }, data: { serviceAreaIds: [...new Set(geoUnitIds)] } });
  await audit(prisma, { actorId: req.user!.id, action: 'driver.service_areas', entityType: 'Driver', entityId: before.id, before: before.serviceAreaIds, after: geoUnitIds, ip: ip(req) });
  res.json({ ok: true });
}));

// ======================= Customers =======================
adminRouter.get('/customers', requirePerm('customers.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.UserWhereInput = { roles: { some: { role: { code: 'CUSTOMER' } } }, ...(q.status ? { status: q.status as any } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, take: p.take, skip: p.skip, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, phone: true, status: true, createdAt: true, _count: { select: { orders: true } } } }),
    prisma.user.count({ where })]);
  const wallets = await prisma.wallet.findMany({ where: { ownerType: 'CUSTOMER', ownerId: { in: items.map((u) => u.id) } }, select: { ownerId: true, balance: true } });
  res.json(pageOut(items.map((u) => ({ ...u, balance: wallets.find((w) => w.ownerId === u.id)?.balance ?? 0 })), total, p));
}));

adminRouter.get('/customers/:id', requirePerm('customers.read'), ah(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true, referralCode: true,
    roles: { select: { role: { select: { code: true } } } }, _count: { select: { orders: true, addresses: true, referrals: true } } } });
  if (!u) throw E.notFound('العميل');
  const [orders, wallet, tickets, byStatus, signals] = await Promise.all([
    prisma.order.findMany({ where: { customerId: u.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, code: true, status: true, total: true, createdAt: true } }),
    prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: u.id } }, include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } } }),
    prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.groupBy({ by: ['status'], where: { customerId: u.id }, _count: true }),
    prisma.fraudSignal.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  res.json({ ...u, roles: u.roles.map((r) => r.role.code), orders, wallet, tickets, stats: byStatus, signals });
}));

adminRouter.post('/users/:id/status', requirePerm('customers.manage'), ah(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().max(300).optional() }).parse(req.body);
  if (req.params.id === req.user!.id) throw E.bad('SELF', 'لا يمكنك تعديل حالة حسابك');
  const before = await prisma.user.findUnique({ where: { id: req.params.id }, include: { roles: { include: { role: true } } } });
  if (!before) throw E.notFound('المستخدم');
  const theirRoles = before.roles.map((r) => r.role.code);
  if (theirRoles.includes('SUPER_ADMIN') && !isSuper(req)) throw E.forbidden();
  if (theirRoles.some((r) => STAFF_ROLES.includes(r)) && !can(req.user, 'roles.manage')) throw E.forbidden();
  await prisma.user.update({ where: { id: before.id }, data: { status } });
  if (status === 'SUSPENDED') {
    await prisma.session.updateMany({ where: { userId: before.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.driver.updateMany({ where: { userId: before.id }, data: { online: false } });
  }
  invalidateAuthCache(before.id);
  await audit(prisma, { actorId: req.user!.id, action: 'user.status', entityType: 'User', entityId: before.id, before: { status: before.status }, after: { status, reason }, ip: ip(req) });
  res.json({ ok: true });
}));

// ======================= Users, roles & permissions =======================
adminRouter.get('/staff', requirePerm('roles.manage'), ah(async (_req, res) => {
  const users = await prisma.user.findMany({ where: { roles: { some: { role: { code: { in: STAFF_ROLES } } } } }, orderBy: { createdAt: 'asc' }, take: 500,
    select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true, roles: { select: { role: { select: { code: true } } } } } });
  res.json(users.map((u) => ({ ...u, roles: u.roles.map((r) => r.role.code) })));
}));
/** Minimal list for "assign to" pickers (support/ops). */
adminRouter.get('/staff/assignable', requirePerm('support.read'), ah(async (_req, res) => {
  res.json(await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { code: { in: STAFF_ROLES } } } } }, select: { id: true, name: true }, take: 500 }));
}));
adminRouter.get('/users/lookup', requirePerm('roles.manage'), ah(async (req, res) => {
  const phone = String(req.query.phone ?? '').trim();
  if (phone.length < 6) throw E.bad('PHONE_REQUIRED', 'أدخل رقم الموبايل');
  const u = await prisma.user.findFirst({ where: { phone: { endsWith: phone.replace(/^0/, '') } }, select: { id: true, name: true, phone: true, status: true, roles: { select: { role: { select: { code: true } } } } } });
  if (!u) throw E.notFound('المستخدم');
  res.json({ ...u, roles: u.roles.map((r) => r.role.code) });
}));
/** Sets the STAFF roles of a user (customer/driver/business roles are preserved). Guards against privilege escalation. */
adminRouter.post('/users/:id/roles', requirePerm('roles.manage'), ah(async (req, res) => {
  const { roles } = z.object({ roles: z.array(z.enum(STAFF_ROLES as [string, ...string[]])).max(5) }).parse(req.body);
  if (req.params.id === req.user!.id) throw E.bad('SELF', 'لا يمكنك تعديل صلاحياتك بنفسك');
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { roles: { include: { role: true } } } });
  if (!target) throw E.notFound('المستخدم');
  const current = target.roles.map((r) => r.role.code);
  if ((roles.includes('SUPER_ADMIN') || current.includes('SUPER_ADMIN')) && !isSuper(req)) throw E.forbidden();
  if (current.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN')) {
    const supers = await prisma.userRole.count({ where: { role: { code: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' } } });
    if (supers <= 1) throw E.bad('LAST_SUPER_ADMIN', 'لا يمكن إزالة آخر مدير عام');
  }
  const keep = current.filter((c) => !STAFF_ROLES.includes(c));
  const rs = await prisma.role.findMany({ where: { code: { in: [...keep, ...roles] } } });
  await prisma.$transaction([prisma.userRole.deleteMany({ where: { userId: target.id } }), prisma.userRole.createMany({ data: rs.map((r) => ({ userId: target.id, roleId: r.id })) })]);
  invalidateAuthCache(target.id);
  await audit(prisma, { actorId: req.user!.id, action: 'role.change', entityType: 'User', entityId: target.id, before: current, after: rs.map((r) => r.code), ip: ip(req) });
  res.json({ ok: true, roles: rs.map((r) => r.code) });
}));
adminRouter.get('/roles', requirePerm('roles.manage'), ah(async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { code: 'asc' } });
  res.json(roles.map((r) => ({ code: r.code, nameAr: r.nameAr, users: r._count.users, permissions: r.permissions.map((p) => p.permission.code).sort() })));
}));
adminRouter.get('/permissions', requirePerm('roles.manage'), ah(async (_req, res) => res.json((await prisma.permission.findMany({ orderBy: { code: 'asc' } })).map((p) => p.code))));
adminRouter.put('/roles/:code/permissions', requirePerm('roles.manage'), ah(async (req, res) => {
  const { permissions } = z.object({ permissions: z.array(z.string()).max(200) }).parse(req.body);
  if (req.params.code === 'SUPER_ADMIN') throw E.bad('IMMUTABLE_ROLE', 'صلاحيات المدير العام ثابتة');
  if (permissions.includes('roles.manage') && !isSuper(req)) throw E.forbidden(); // only super admins can mint role managers
  const role = await prisma.role.findUnique({ where: { code: req.params.code }, include: { permissions: { include: { permission: true } }, users: { select: { userId: true } } } });
  if (!role) throw E.notFound('الدور');
  if (req.user!.roles.includes(role.code) && !isSuper(req)) throw E.bad('SELF', 'لا يمكنك تعديل صلاحيات دورك');
  const ps = await prisma.permission.findMany({ where: { code: { in: permissions } } });
  if (ps.length !== new Set(permissions).size) throw E.bad('BAD_PERMISSION', 'صلاحية غير معروفة');
  await prisma.$transaction([prisma.rolePermission.deleteMany({ where: { roleId: role.id } }), prisma.rolePermission.createMany({ data: ps.map((p) => ({ roleId: role.id, permissionId: p.id })) })]);
  role.users.forEach((u) => invalidateAuthCache(u.userId));
  await audit(prisma, { actorId: req.user!.id, action: 'role.permissions', entityType: 'Role', entityId: role.code, before: role.permissions.map((p) => p.permission.code), after: permissions, ip: ip(req) });
  res.json({ ok: true });
}));

// ======================= Businesses =======================
adminRouter.get('/businesses', requirePerm('businesses.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.BusinessWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { nameAr: { contains: q.q, mode: 'insensitive' } } : {}) };
  const [items, total] = await Promise.all([
    prisma.business.findMany({ where, take: p.take, skip: p.skip, orderBy: { createdAt: 'desc' }, include: { _count: { select: { orders: true, users: true, branches: true, apiKeys: true } } }),
    prisma.business.count({ where })]);
  res.json(pageOut(items, total, p));
}));
const BizInput = z.object({ nameAr: z.string().trim().min(2).max(120), taxId: z.string().max(40).optional(), ownerPhone: z.string().regex(/^01[0125]\d{8}$/, 'رقم موبايل مصري غير صحيح'), ownerName: z.string().max(80).optional() });
/** Finds or creates the user by phone in the same normalized format as OTP login (+20…), so they can sign in later. */
async function userByPhone(phone: string, name?: string) {
  const intl = EgPhone.parse(phone);
  const u = await prisma.user.findUnique({ where: { phone: intl } });
  if (u) return u;
  const created = await prisma.user.create({ data: { phone: intl, name, referralCode: 'B' + crypto.randomBytes(4).toString('hex').toUpperCase() } });
  await ensureRole(created.id, 'CUSTOMER');
  return created;
}
async function ensureRole(userId: string, code: string) {
  const role = await prisma.role.findUnique({ where: { code } });
  if (role) await prisma.userRole.upsert({ where: { userId_roleId: { userId, roleId: role.id } }, update: {}, create: { userId, roleId: role.id } });
  invalidateAuthCache(userId);
}
adminRouter.post('/businesses', requirePerm('businesses.manage'), ah(async (req, res) => {
  const b = BizInput.parse(req.body);
  const owner = await userByPhone(b.ownerPhone, b.ownerName);
  const biz = await prisma.business.create({ data: { nameAr: b.nameAr, taxId: b.taxId, users: { create: { userId: owner.id, role: 'OWNER' } } } });
  await ensureRole(owner.id, 'BUSINESS');
  await audit(prisma, { actorId: req.user!.id, action: 'business.create', entityType: 'Business', entityId: biz.id, after: { ...b }, ip: ip(req) });
  res.status(201).json(biz);
}));
adminRouter.patch('/businesses/:id', requirePerm('businesses.manage'), ah(async (req, res) => {
  const b = z.object({ nameAr: z.string().trim().min(2).max(120).optional(), taxId: z.string().max(40).nullable().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), reason: z.string().max(300).optional() }).parse(req.body);
  const before = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!before) throw E.notFound('الشركة');
  const { reason, ...data } = b;
  const row = await prisma.business.update({ where: { id: before.id }, data });
  await audit(prisma, { actorId: req.user!.id, action: 'business.update', entityType: 'Business', entityId: before.id, before, after: { ...data, reason }, ip: ip(req) });
  res.json(row);
}));
adminRouter.get('/businesses/:id', requirePerm('businesses.read'), ah(async (req, res) => {
  const b = await prisma.business.findUnique({ where: { id: req.params.id }, include: { users: { include: { user: { select: { id: true, name: true, phone: true, status: true } } } }, branches: true,
    apiKeys: { select: { id: true, name: true, prefix: true, scopes: true, rateLimitPerMin: true, revokedAt: true, lastUsedAt: true, createdAt: true } },
    webhooks: { select: { id: true, url: true, events: true, active: true, createdAt: true } }, _count: { select: { orders: true } } } });
  if (!b) throw E.notFound('الشركة');
  const [wallet, codPending, bulk, byStatus] = await Promise.all([
    prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'BUSINESS', ownerId: b.id } } }),
    prisma.order.aggregate({ where: { businessId: b.id, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }, _sum: { codAmount: true } }),
    prisma.bulkUpload.findMany({ where: { businessId: b.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, totalRows: true, okRows: true, createdAt: true, finishedAt: true } }),
    prisma.order.groupBy({ by: ['status'], where: { businessId: b.id }, _count: true }),
  ]);
  res.json({ ...b, wallet, codPending: codPending._sum.codAmount ?? 0, bulk, stats: byStatus });
}));
adminRouter.post('/businesses/:id/users', requirePerm('businesses.manage'), ah(async (req, res) => {
  const b = z.object({ phone: z.string().regex(/^01[0125]\d{8}$/, 'رقم موبايل مصري غير صحيح'), name: z.string().max(80).optional(), role: z.enum(['OWNER', 'MANAGER', 'STAFF']) }).parse(req.body);
  const biz = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!biz) throw E.notFound('الشركة');
  const u = await userByPhone(b.phone, b.name);
  await prisma.businessUser.upsert({ where: { businessId_userId: { businessId: biz.id, userId: u.id } }, update: { role: b.role }, create: { businessId: biz.id, userId: u.id, role: b.role } });
  await ensureRole(u.id, 'BUSINESS');
  await audit(prisma, { actorId: req.user!.id, action: 'business.user.add', entityType: 'Business', entityId: biz.id, after: { userId: u.id, role: b.role }, ip: ip(req) });
  res.status(201).json({ ok: true, userId: u.id });
}));
adminRouter.post('/businesses/:id/api-keys/:keyId/revoke', requirePerm('apikeys.manage'), ah(async (req, res) => {
  const k = await prisma.apiKey.findFirst({ where: { id: req.params.keyId, businessId: req.params.id } });
  if (!k) throw E.notFound('المفتاح');
  if (!k.revokedAt) await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
  await audit(prisma, { actorId: req.user!.id, action: 'apikey.revoke', entityType: 'Business', entityId: req.params.id, after: { prefix: k.prefix }, ip: ip(req) });
  res.json({ ok: true });
}));
adminRouter.patch('/businesses/:id/webhooks/:wid', requirePerm('businesses.manage'), ah(async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const w = await prisma.webhook.findFirst({ where: { id: req.params.wid, businessId: req.params.id } });
  if (!w) throw E.notFound('الويب هوك');
  await prisma.webhook.update({ where: { id: w.id }, data: { active } });
  await audit(prisma, { actorId: req.user!.id, action: 'webhook.toggle', entityType: 'Business', entityId: req.params.id, before: { active: w.active }, after: { webhookId: w.id, active }, ip: ip(req) });
  res.json({ ok: true });
}));
adminRouter.get('/businesses/:id/webhooks/:wid/deliveries', requirePerm('businesses.read'), ah(async (req, res) => {
  const p = paging(req.query);
  const w = await prisma.webhook.findFirst({ where: { id: req.params.wid, businessId: req.params.id } });
  if (!w) throw E.notFound('الويب هوك');
  const [items, total] = await Promise.all([prisma.webhookDelivery.findMany({ where: { webhookId: w.id }, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.webhookDelivery.count({ where: { webhookId: w.id } })]);
  res.json(pageOut(items, total, p));
}));

// ======================= Config CRUD (audited) =======================
const GeoBase = z.object({ level: z.enum(['GOVERNORATE', 'CITY', 'DISTRICT', 'VILLAGE', 'AREA']), nameAr: z.string().trim().min(2).max(80), nameEn: z.string().max(80).nullable().optional(),
  parentId: z.string().nullable().optional(), centerLat: z.number().min(21).max(32).nullable().optional(), centerLng: z.number().min(24).max(37).nullable().optional(),
  radiusKm: z.number().positive().max(300).nullable().optional(), polygon: z.any().nullable().optional(), active: z.boolean().default(true), extraFee: z.number().int().min(0).max(1_000_000).default(0) });
const LEVEL_RANK = { GOVERNORATE: 0, CITY: 1, DISTRICT: 2, VILLAGE: 2, AREA: 3 } as const;
async function checkGeo(g: z.infer<typeof GeoBase>, selfId?: string) {
  if (g.polygon != null && !isValidPolygon(g.polygon)) throw E.bad('BAD_POLYGON', 'حدود المنطقة غير صالحة (GeoJSON Polygon داخل مصر)');
  if (g.polygon == null && (g.centerLat == null || g.centerLng == null || g.radiusKm == null)) throw E.bad('COVERAGE_REQUIRED', 'حدد حدود المنطقة أو المركز ونصف القطر');
  if (g.level === 'GOVERNORATE' && g.parentId) throw E.bad('BAD_PARENT', 'المحافظة لا تتبع منطقة أخرى');
  if (g.level !== 'GOVERNORATE' && !g.parentId) throw E.bad('PARENT_REQUIRED', 'حدد المنطقة الأعلى');
  if (g.parentId) {
    if (g.parentId === selfId) throw E.bad('BAD_PARENT', 'لا يمكن أن تتبع المنطقة نفسها');
    const parent = await prisma.geoUnit.findUnique({ where: { id: g.parentId } });
    if (!parent) throw E.bad('BAD_PARENT', 'المنطقة الأعلى غير موجودة');
    if (LEVEL_RANK[parent.level] >= LEVEL_RANK[g.level]) throw E.bad('BAD_PARENT', 'مستوى المنطقة الأعلى غير صحيح');
    // cycle guard
    let cur: string | null = parent.parentId; let hops = 0;
    while (cur && hops++ < 10) { if (cur === selfId) throw E.bad('BAD_PARENT', 'تسلسل المناطق دائري'); cur = (await prisma.geoUnit.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null; }
  }
}
const PricingInput = z.object({ name: z.string().trim().min(2).max(80), active: z.boolean().default(true), priority: z.number().int().min(0).max(1000).default(0),
  governorateId: z.string().nullable().optional(), cityId: z.string().nullable().optional(), areaId: z.string().nullable().optional(), vehicleTypeCode: z.string().nullable().optional(),
  baseFare: z.number().int().min(0), perKm: z.number().int().min(0), includedKm: z.number().min(0), minimumFare: z.number().int().min(0), perKgOverIncluded: z.number().int().min(0), includedKg: z.number().min(0),
  urgentFee: z.number().int().min(0), scheduledFee: z.number().int().min(0), extraStopFee: z.number().int().min(0), waitingPerMinute: z.number().int().min(0), freeWaitingMinutes: z.number().int().min(0),
  returnFeePercent: z.number().min(0).max(100) });
const CouponInput = z.object({ code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, 'حروف إنجليزية وأرقام فقط').transform((s) => s.toUpperCase()), type: z.enum(['PERCENT', 'FIXED']), value: z.number().int().positive(),
  maxDiscount: z.number().int().positive().nullable().optional(), minOrder: z.number().int().min(0).nullable().optional(), startsAt: z.coerce.date().nullable().optional(), expiresAt: z.coerce.date().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(), maxUsesPerUser: z.number().int().min(1).default(1), userIds: z.array(z.string()).default([]), geoUnitIds: z.array(z.string()).default([]),
  businessIds: z.array(z.string()).default([]), active: z.boolean().default(true) });
const checkCoupon = (c: any) => {
  if (c.type === 'PERCENT' && c.value > 100) throw E.bad('BAD_VALUE', 'نسبة الخصم لا تتجاوز 100%');
  if (c.startsAt && c.expiresAt && new Date(c.startsAt) >= new Date(c.expiresAt)) throw E.bad('BAD_DATES', 'تاريخ الانتهاء يجب أن يكون بعد البداية');
};

interface Crud { model: any; perm: string; schema: z.ZodObject<any>; id?: string; validate?: (merged: any, id?: string) => Promise<void> | void; listWhere?: (q: Record<string, string | undefined>) => any; orderBy?: any }
const CRUD: Record<string, Crud> = {
  geo: { model: prisma.geoUnit, perm: 'geo.write', schema: GeoBase, validate: (g, id) => checkGeo(g, id), orderBy: [{ level: 'asc' }, { nameAr: 'asc' }],
    listWhere: (q) => ({ ...(q.parentId !== undefined ? { parentId: q.parentId || null } : {}), ...(q.level ? { level: q.level } : {}), ...(q.active ? { active: q.active === '1' } : {}),
      ...(q.q ? { OR: [{ nameAr: { contains: q.q } }, { nameEn: { contains: q.q, mode: 'insensitive' } }] } : {}) }) },
  'pricing-rules': { model: prisma.pricingRule, perm: 'pricing.write', schema: PricingInput, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    listWhere: (q) => (q.history === '1' ? {} : { supersededById: null }) },
  'commission-rules': { model: prisma.commissionRule, perm: 'finance.commission', schema: z.object({ active: z.boolean().default(true), vehicleTypeCode: z.string().nullable().optional(), governorateId: z.string().nullable().optional(), businessId: z.string().nullable().optional(), type: z.enum(['PERCENT', 'FIXED', 'PERCENT_PLUS_FIXED']), percent: z.number().min(0).max(100), fixed: z.number().int().min(0), min: z.number().int().min(0).nullable().optional(), max: z.number().int().min(0).nullable().optional() }) },
  'package-sizes': { model: prisma.packageSize, perm: 'pricing.write', id: 'code', schema: z.object({ code: z.string().regex(/^[A-Z_]+$/), nameAr: z.string().min(2), fee: z.number().int().min(0), multiplierBp: z.number().int().min(1000).max(100000), maxKg: z.number().positive(), active: z.boolean().default(true) }) },
  'package-categories': { model: prisma.packageCategory, perm: 'pricing.write', id: 'code', schema: z.object({ code: z.string().regex(/^[A-Z_]+$/), nameAr: z.string().min(2), active: z.boolean().default(true) }) },
  'vehicle-types': { model: prisma.vehicleType, perm: 'pricing.write', schema: z.object({ code: z.string().regex(/^[A-Z_]+$/), nameAr: z.string().min(2), maxKg: z.number().positive(), maxVolumeL: z.number().positive().nullable().optional(), avgSpeedKmh: z.number().positive().max(150), active: z.boolean(), allowedSizes: z.array(z.string()).min(1) }) },
  coupons: { model: prisma.coupon, perm: 'coupons.write', schema: CouponInput, validate: checkCoupon, listWhere: (q) => ({ ...(q.active ? { active: q.active === '1' } : {}), ...(q.q ? { code: { contains: q.q.toUpperCase() } } : {}), ...(q.businessId ? { businessIds: { has: q.businessId } } : {}) }) },
  'failure-reasons': { model: prisma.failureReason, perm: 'settings.write', id: 'code', schema: z.object({ code: z.string().regex(/^[A-Z_]+$/), nameAr: z.string().min(2), requiresPhoto: z.boolean(), nextAction: z.enum(['RETRY', 'RETURN', 'CONTACT_SUPPORT']), appliesTo: z.string() }) },
  'operating-hours': { model: prisma.operatingHours, perm: 'geo.write', schema: z.object({ scope: z.enum(['PLATFORM', 'GEO', 'DRIVER']), geoUnitId: z.string().nullable().optional(), driverId: z.string().nullable().optional(), weekday: z.number().int().min(0).max(6), opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
    validate: (h) => { if (h.opensAt >= h.closesAt) throw E.bad('BAD_HOURS', 'وقت الإغلاق يجب أن يكون بعد الفتح'); if (h.scope === 'GEO' && !h.geoUnitId) throw E.bad('AREA_REQUIRED', 'حدد المنطقة'); },
    listWhere: (q) => (q.geoUnitId ? { geoUnitId: q.geoUnitId } : {}) },
};
for (const [name, c] of Object.entries(CRUD)) {
  const idField = c.id ?? 'id';
  const readPerm = c.perm.split('.')[0] + '.read';
  adminRouter.get(`/${name}`, requirePerm(readPerm), ah(async (req, res) => {
    res.json(await c.model.findMany({ where: c.listWhere?.(qs(req)) ?? {}, take: 1000, ...(c.orderBy ? { orderBy: c.orderBy } : {}) }));
  }));
  adminRouter.post(`/${name}`, requirePerm(c.perm), ah(async (req, res) => {
    const data = c.schema.parse(req.body);
    await c.validate?.(data);
    const row = await c.model.create({ data });
    await audit(prisma, { actorId: req.user!.id, action: `${name}.create`, entityType: name, entityId: String(row[idField]), after: row, ip: ip(req) });
    res.status(201).json(row);
  }));
  adminRouter.patch(`/${name}/:id`, requirePerm(c.perm), ah(async (req, res) => {
    const before = await c.model.findUnique({ where: { [idField]: req.params.id } });
    if (!before) throw E.notFound();
    const patch = c.schema.partial().parse(req.body);
    if (idField !== 'id') delete (patch as any)[idField]; // natural keys are immutable
    await c.validate?.({ ...before, ...patch }, req.params.id);
    let row: any;
    if (name === 'pricing-rules') {
      // Versioning: never edit a rule in place. Old orders keep pointing at the exact version that priced them.
      if (before.supersededById) throw E.conflict('SUPERSEDED', 'هذه نسخة قديمة، عدّل النسخة الحالية');
      const { id: _id, createdAt: _c, updatedAt: _u, supersededAt: _sa, supersededById: _sb, ...rest } = before;
      row = await prisma.$transaction(async (tx) => {
        const next = await tx.pricingRule.create({ data: { ...rest, ...patch } });
        await tx.pricingRule.update({ where: { id: before.id }, data: { active: false, supersededById: next.id, supersededAt: new Date() } });
        return next;
      });
    } else row = await c.model.update({ where: { [idField]: req.params.id }, data: patch });
    await audit(prisma, { actorId: req.user!.id, action: `${name}.update`, entityType: name, entityId: req.params.id, before, after: row, ip: ip(req) });
    res.json(row);
  }));
}
adminRouter.get('/pricing-rules/:id/history', requirePerm('pricing.read'), ah(async (req, res) => {
  const chain: any[] = [];
  let cur = await prisma.pricingRule.findUnique({ where: { id: req.params.id } });
  if (!cur) throw E.notFound('قاعدة التسعير');
  while (cur && chain.length < 100) { chain.push(cur); cur = await prisma.pricingRule.findFirst({ where: { supersededById: cur.id } }); }
  const counts = await prisma.order.groupBy({ by: ['pricingRuleId'], where: { pricingRuleId: { in: chain.map((r) => r.id) } }, _count: true });
  res.json(chain.map((r) => ({ ...r, orders: counts.find((x) => x.pricingRuleId === r.id)?._count ?? 0 })));
}));
adminRouter.get('/coupons/:id/usage', requirePerm('coupons.read'), ah(async (req, res) => {
  const c = await prisma.coupon.findUnique({ where: { id: req.params.id } });
  if (!c) throw E.notFound('الكوبون');
  const [agg, recent, users] = await Promise.all([
    prisma.couponRedemption.aggregate({ where: { couponId: c.id }, _sum: { amount: true }, _count: true }),
    prisma.couponRedemption.findMany({ where: { couponId: c.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.couponRedemption.groupBy({ by: ['userId'], where: { couponId: c.id }, _count: true }),
  ]);
  const orders = await prisma.order.findMany({ where: { id: { in: recent.map((r) => r.orderId) } }, select: { id: true, code: true, status: true, total: true } });
  res.json({ coupon: c, redemptions: agg._count, totalDiscount: agg._sum.amount ?? 0, uniqueUsers: users.length, remaining: c.maxUses != null ? Math.max(0, c.maxUses - c.usedCount) : null,
    recent: recent.map((r) => ({ ...r, order: orders.find((o) => o.id === r.orderId) ?? null })) });
}));

// ======================= Settings =======================
adminRouter.get('/settings', requirePerm('settings.read'), ah(async (_req, res) => {
  const rows = await prisma.setting.findMany();
  res.json(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, { ...(DEFAULTS as any)[k], ...((rows.find((r) => r.key === k)?.value as object) ?? {}) }])));
}));
adminRouter.put('/settings/:key', requirePerm('settings.write'), ah(async (req, res) => {
  const key = req.params.key as keyof typeof DEFAULTS;
  if (!(key in DEFAULTS)) throw E.notFound('الإعداد');
  const before = await prisma.setting.findUnique({ where: { key } });
  const merged = { ...(DEFAULTS as any)[key], ...((before?.value as object) ?? {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
  const value = SETTING_SCHEMAS[key].parse(merged); // strict: unknown keys / wrong types are rejected (422)
  const row = await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  clearSettingsCache();
  await audit(prisma, { actorId: req.user!.id, action: 'settings.update', entityType: 'Setting', entityId: key, before: before?.value, after: value, ip: ip(req) });
  res.json(row);
}));

// ======================= Finance (ledger is the source of truth) =======================
adminRouter.get('/finance/summary', requirePerm('finance.read'), ah(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const byType = await prisma.$queryRaw<any[]>`
    SELECT w."ownerType"::text AS owner, t.type, COUNT(*) AS n, COALESCE(SUM(t.amount),0)::bigint AS amount
    FROM "WalletTransaction" t JOIN "Wallet" w ON w.id = t."walletId" WHERE t."createdAt" BETWEEN ${from} AND ${to} GROUP BY 1,2 ORDER BY 1,2`;
  const [bal] = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM(-balance) FILTER (WHERE "ownerType"='DRIVER' AND balance < 0),0)::bigint AS drivers_owe,
           COALESCE(SUM(balance) FILTER (WHERE "ownerType"='DRIVER' AND balance > 0),0)::bigint AS drivers_payable,
           COALESCE(SUM(balance) FILTER (WHERE "ownerType"='BUSINESS'),0)::bigint AS business_balance,
           COALESCE(SUM(balance) FILTER (WHERE "ownerType"='CUSTOMER'),0)::bigint AS customer_wallets,
           COALESCE(SUM(balance) FILTER (WHERE "ownerType"='PLATFORM'),0)::bigint AS platform
    FROM "Wallet"`;
  const [comm] = await prisma.$queryRaw<any[]>`SELECT COUNT(*) AS deliveries, COALESCE(SUM(commission),0)::bigint AS commission, COALESCE(SUM("driverEarning"),0)::bigint AS driver_earnings, COALESCE(SUM("grossFee"),0)::bigint AS gross FROM "Commission" WHERE "createdAt" BETWEEN ${from} AND ${to}`;
  const [stl] = await prisma.$queryRaw<any[]>`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0)::bigint AS amount FROM "Settlement" WHERE "createdAt" BETWEEN ${from} AND ${to}`;
  const [pay] = await prisma.$queryRaw<any[]>`SELECT COALESCE(SUM(amount) FILTER (WHERE status='PENDING'),0)::bigint AS pending, COALESCE(SUM(amount) FILTER (WHERE status='PAID'),0)::bigint AS paid, COALESCE(SUM(amount) FILTER (WHERE status='REFUNDED'),0)::bigint AS refunded FROM "Payment" WHERE "createdAt" BETWEEN ${from} AND ${to}`;
  res.json({ range: { from, to }, balances: num(bal), commissions: num(comm), settlements: num(stl), payments: num(pay), byType: byType.map(num) });
}));
adminRouter.get('/finance/ledger', requirePerm('finance.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q, 200);
  const range = q.from || q.to ? parseRange(q) : null;
  const where: Prisma.WalletTransactionWhereInput = { ...(q.type ? { type: q.type } : {}), ...(q.orderId ? { orderId: q.orderId } : {}),
    ...(q.ownerType || q.ownerId ? { wallet: { ...(q.ownerType ? { ownerType: q.ownerType as any } : {}), ...(q.ownerId ? { ownerId: q.ownerId } : {}) } } : {}),
    ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}) };
  const [items, total] = await Promise.all([prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip, include: { wallet: { select: { ownerType: true, ownerId: true } } } }), prisma.walletTransaction.count({ where })]);
  res.json(pageOut(items, total, p));
}));
adminRouter.get('/finance/payments', requirePerm('finance.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.PaymentWhereInput = { ...(q.status ? { status: q.status as any } : {}), ...(q.method ? { method: q.method as any } : {}) };
  const [items, total] = await Promise.all([prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip, include: { order: { select: { id: true, code: true, status: true } } } }), prisma.payment.count({ where })]);
  res.json(pageOut(items, total, p));
}));
adminRouter.get('/finance/commissions', requirePerm('finance.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q); const { from, to } = parseRange(q);
  const where: Prisma.CommissionWhereInput = { createdAt: { gte: from, lte: to }, ...(q.driverId ? { driverId: q.driverId } : {}) };
  const [items, total, sum] = await Promise.all([prisma.commission.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.commission.count({ where }),
    prisma.commission.aggregate({ where, _sum: { commission: true, driverEarning: true, grossFee: true } })]);
  const orders = await prisma.order.findMany({ where: { id: { in: items.map((i) => i.orderId) } }, select: { id: true, code: true } });
  res.json({ ...pageOut(items.map((i) => ({ ...i, orderCode: orders.find((o) => o.id === i.orderId)?.code })), total, p), totals: sum._sum });
}));
adminRouter.get('/finance/settlements', requirePerm('finance.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.SettlementWhereInput = q.driverId ? { driverId: q.driverId } : {};
  const [items, total] = await Promise.all([prisma.settlement.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.settlement.count({ where })]);
  const drivers = await prisma.driver.findMany({ where: { id: { in: items.map((s) => s.driverId) } }, select: { id: true, user: { select: { name: true, phone: true } } } });
  const actors = await prisma.user.findMany({ where: { id: { in: items.map((s) => s.createdById) } }, select: { id: true, name: true } });
  res.json(pageOut(items.map((s) => ({ ...s, driver: drivers.find((d) => d.id === s.driverId)?.user ?? null, createdBy: actors.find((a) => a.id === s.createdById)?.name ?? null })), total, p));
}));
adminRouter.get('/finance/driver-balances', requirePerm('finance.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const filter = q.filter === 'payable' ? Prisma.sql`w.balance > 0` : q.filter === 'all' ? Prisma.sql`w.balance <> 0` : Prisma.sql`w.balance < 0`;
  const search = q.q ? Prisma.sql`AND (u.name ILIKE ${'%' + q.q + '%'} OR u.phone LIKE ${'%' + q.q + '%'})` : Prisma.empty;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT d.id AS "driverId", u.name, u.phone, w.balance, d.online, d.status::text AS status,
      (SELECT MAX(s."createdAt") FROM "Settlement" s WHERE s."driverId" = d.id) AS "lastSettlementAt"
    FROM "Wallet" w JOIN "Driver" d ON d.id = w."ownerId" JOIN "User" u ON u.id = d."userId"
    WHERE w."ownerType" = 'DRIVER' AND ${filter} ${search} ORDER BY w.balance ASC LIMIT ${p.take} OFFSET ${p.skip}`;
  const [{ n }] = await prisma.$queryRaw<any[]>`SELECT COUNT(*) AS n FROM "Wallet" w JOIN "Driver" d ON d.id = w."ownerId" JOIN "User" u ON u.id = d."userId" WHERE w."ownerType" = 'DRIVER' AND ${filter} ${search}`;
  res.json(pageOut(rows.map(num), Number(n), p));
}));
/**
 * Cash settlement from a driver. Atomic (wallet row locked FOR UPDATE), idempotent (Idempotency-Key required),
 * can't exceed what the driver owes, audited.
 */
adminRouter.post('/finance/settlements', requirePerm('finance.settle'), ah(async (req, res) => {
  const b = z.object({ driverId: z.string(), amount: z.number().int().positive(), method: z.enum(['CASH', 'BANK', 'MOBILE_WALLET', 'INSTAPAY']), reference: z.string().max(100).optional() }).parse(req.body);
  const r = await idempotent('settlement', idemKey(req), async () => {
    const s = await prisma.$transaction(async (tx) => {
      const [w] = await tx.$queryRaw<{ balance: number }[]>`SELECT balance FROM "Wallet" WHERE "ownerType" = 'DRIVER' AND "ownerId" = ${b.driverId} FOR UPDATE`;
      const owed = Math.max(0, -(w?.balance ?? 0));
      if (!owed) throw E.bad('NOTHING_OWED', 'لا توجد مستحقات على هذا المندوب');
      if (b.amount > owed) throw E.bad('AMOUNT_TOO_LARGE', `المبلغ أكبر من المستحق (${owed / 100} ج.م)`);
      const s = await tx.settlement.create({ data: { ...b, createdById: req.user!.id } });
      await post(tx, { ownerType: 'DRIVER', ownerId: b.driverId, type: 'SETTLEMENT', amount: b.amount, settlementId: s.id, createdById: req.user!.id, idempotencyKey: `stl:${s.id}` });
      await audit(tx, { actorId: req.user!.id, action: 'wallet.settlement', entityType: 'Driver', entityId: b.driverId, before: { owed }, after: { ...b, settlementId: s.id }, ip: ip(req) });
      return s;
    });
    return { status: 201, body: s };
  }, { required: true });
  res.status(r.status).json(r.body);
}));
adminRouter.post('/finance/adjust', requirePerm('finance.adjust'), ah(async (req, res) => {
  const b = z.object({ ownerType: z.enum(['CUSTOMER', 'DRIVER', 'BUSINESS']), ownerId: z.string(), amount: z.number().int().refine((n) => n !== 0, 'المبلغ لا يساوي صفر'), note: z.string().trim().min(5).max(300) }).parse(req.body);
  const r = await idempotent('adjust', idemKey(req), async () => {
    const t = await prisma.$transaction(async (tx) => {
      const t = await post(tx, { ...b, type: 'ADJUSTMENT', createdById: req.user!.id, allowNegative: true });
      await audit(tx, { actorId: req.user!.id, action: 'wallet.adjust', entityType: b.ownerType, entityId: b.ownerId, after: b, ip: ip(req) });
      return t;
    });
    return { status: 201, body: t };
  }, { required: true });
  res.status(r.status).json(r.body);
}));

// ======================= Support =======================
adminRouter.get('/tickets', requirePerm('support.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.SupportTicketWhereInput = { ...(q.status ? { status: { in: q.status.split(',') as any } } : {}), ...(q.priority ? { priority: q.priority as any } : {}),
    ...(q.category ? { category: q.category } : {}), ...(q.assigneeId ? { assigneeId: q.assigneeId === 'none' ? null : q.assigneeId === 'me' ? req.user!.id : q.assigneeId } : {}),
    ...(q.q ? { OR: [{ code: { contains: q.q.toUpperCase() } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}) };
  const [items, total] = await Promise.all([prisma.supportTicket.findMany({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: p.take, skip: p.skip, include: { _count: { select: { messages: true } } } }), prisma.supportTicket.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: [...items.map((t) => t.userId), ...items.map((t) => t.assigneeId).filter(Boolean) as string[]] } }, select: { id: true, name: true, phone: true } });
  res.json(pageOut(items.map((t) => ({ ...t, user: users.find((u) => u.id === t.userId) ?? null, assignee: users.find((u) => u.id === t.assigneeId) ?? null })), total, p));
}));
adminRouter.get('/tickets/:id', requirePerm('support.read'), ah(async (req, res) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!t) throw E.notFound('التذكرة');
  const ids = [t.userId, t.assigneeId, ...t.messages.map((m) => m.senderId)].filter(Boolean) as string[];
  const [users, order] = await Promise.all([prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } }),
    t.orderId ? prisma.order.findUnique({ where: { id: t.orderId }, select: { id: true, code: true, status: true, driverId: true, businessId: true } }) : null]);
  const name = (id?: string | null) => users.find((u) => u.id === id) ?? null;
  res.json({ ...t, user: name(t.userId), assignee: name(t.assigneeId), order, messages: t.messages.map((m) => ({ ...m, sender: name(m.senderId), fromStaff: m.senderId !== t.userId })) });
}));
adminRouter.post('/tickets/:id/reply', requirePerm('support.write'), ah(async (req, res) => {
  const b = z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }).parse(req.body);
  const before = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!before) throw E.notFound('التذكرة');
  if (before.status === 'CLOSED') throw E.conflict('TICKET_CLOSED', 'التذكرة مغلقة');
  await prisma.supportTicket.update({ where: { id: before.id }, data: { ...(before.status === 'OPEN' && !b.internal ? { status: 'WAITING_USER' } : {}), assigneeId: before.assigneeId ?? req.user!.id,
    messages: { create: { senderId: req.user!.id, body: b.body, internal: b.internal } } } });
  if (!b.internal) await notify(before.userId, { type: 'SUPPORT_REPLY', titleAr: 'رد من دعم مشاوير', bodyAr: b.body.slice(0, 120), deepLink: `mashawir://support/${before.id}` });
  await audit(prisma, { actorId: req.user!.id, action: b.internal ? 'ticket.note' : 'ticket.reply', entityType: 'SupportTicket', entityId: before.id, ip: ip(req) });
  res.json({ ok: true });
}));
adminRouter.patch('/tickets/:id', requirePerm('support.write'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']).optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(), assigneeId: z.string().nullable().optional() }).parse(req.body);
  const before = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!before) throw E.notFound('التذكرة');
  if (b.assigneeId) {
    const staff = await prisma.user.findFirst({ where: { id: b.assigneeId, status: 'ACTIVE', roles: { some: { role: { code: { in: STAFF_ROLES } } } } } });
    if (!staff) throw E.bad('BAD_ASSIGNEE', 'الموظف غير موجود');
  }
  const t = await prisma.supportTicket.update({ where: { id: before.id }, data: b });
  if (b.status && b.status !== before.status && ['RESOLVED', 'CLOSED'].includes(b.status)) await notify(before.userId, { type: 'SUPPORT_STATUS', titleAr: 'دعم مشاوير', bodyAr: `تم ${b.status === 'RESOLVED' ? 'حل' : 'إغلاق'} تذكرتك ${before.code}`, deepLink: `mashawir://support/${before.id}` });
  await audit(prisma, { actorId: req.user!.id, action: 'ticket.update', entityType: 'SupportTicket', entityId: before.id, before: { status: before.status, priority: before.priority, assigneeId: before.assigneeId }, after: b, ip: ip(req) });
  res.json(t);
}));

// ======================= Notifications (segmented broadcast) =======================
adminRouter.post('/notifications/preview', requirePerm('notifications.send'), ah(async (req, res) => {
  const b = BroadcastInput.parse(req.body);
  res.json({ recipients: await prisma.user.count({ where: recipientsWhere(b) }) });
}));
adminRouter.post('/notifications', requirePerm('notifications.send'), ah(async (req, res) => {
  const b = BroadcastInput.parse(req.body);
  if (b.target === 'ALL_CUSTOMERS' && !can(req.user, 'customers.manage')) throw E.forbidden(); // mass customer messaging needs a higher permission
  const recipients = await prisma.user.count({ where: recipientsWhere(b) });
  if (!recipients) throw E.bad('NO_RECIPIENTS', 'لا يوجد مستلمون لهذا الاختيار');
  const r = await idempotent(`broadcast:${req.user!.id}`, idemKey(req), async () => {
    const job = await queues.broadcast.add('broadcast', b);
    await audit(prisma, { actorId: req.user!.id, action: 'notification.broadcast', entityType: 'Notification', entityId: String(job.id), after: { ...b, recipients }, ip: ip(req) });
    return { status: 202, body: { queued: true, recipients, jobId: job.id } };
  });
  res.status(r.status).json(r.body);
}));
adminRouter.get('/notifications/history', requirePerm('notifications.send'), ah(async (req, res) => {
  const p = paging(req.query);
  const where = { action: 'notification.broadcast' };
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: p.take, skip: p.skip }), prisma.auditLog.count({ where })]);
  const actors = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.actorId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  res.json(pageOut(json(items.map((i) => ({ id: i.id, at: i.at, jobId: i.entityId, ...(i.after as object), actor: actors.find((a) => a.id === i.actorId)?.name ?? null }))), total, p));
}));

// ======================= Audit & fraud =======================
adminRouter.get('/audit-logs', requirePerm('audit.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q, 200);
  const range = q.from || q.to ? parseRange(q) : null;
  const where: Prisma.AuditLogWhereInput = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}), ...(range ? { at: { gte: range.from, lte: range.to } } : {}) };
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: p.take, skip: p.skip }), prisma.auditLog.count({ where })]);
  const actors = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.actorId).filter(Boolean) as string[] } }, select: { id: true, name: true, phone: true } });
  res.json(pageOut(json(items.map((i) => ({ ...i, actor: actors.find((a) => a.id === i.actorId) ?? null }))), total, p));
}));
adminRouter.get('/fraud-signals', requirePerm('audit.read'), ah(async (req, res) => {
  const q = qs(req); const p = paging(q);
  const where: Prisma.FraudSignalWhereInput = { ...(q.all === '1' ? {} : { resolvedAt: null }), ...(q.kind ? { kind: q.kind } : {}) };
  const [items, total] = await Promise.all([prisma.fraudSignal.findMany({ where, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }], take: p.take, skip: p.skip }), prisma.fraudSignal.count({ where })]);
  res.json(pageOut(items, total, p));
}));
adminRouter.post('/fraud-signals/:id/resolve', requirePerm('audit.read', 'customers.manage'), ah(async (req, res) => {
  const { note } = z.object({ note: Reason }).parse(req.body);
  const s = await prisma.fraudSignal.findUnique({ where: { id: req.params.id } });
  if (!s) throw E.notFound('الإشارة');
  await prisma.fraudSignal.update({ where: { id: s.id }, data: { resolvedAt: new Date() } });
  await audit(prisma, { actorId: req.user!.id, action: 'fraud.resolve', entityType: 'FraudSignal', entityId: s.id, after: { note }, ip: ip(req) });
  res.json({ ok: true });
}));

// ======================= System health (no secrets, ever) =======================
adminRouter.get('/system/health', requirePerm('system.read'), ah(async (_req, res) => {
  const t = async <T>(fn: () => Promise<T>) => { const s = Date.now(); try { const v = await fn(); return { ok: true, ms: Date.now() - s, ...(v && typeof v === 'object' ? v : {}) }; } catch (e: any) { return { ok: false, ms: Date.now() - s, error: String(e?.code ?? 'ERROR') }; } };
  const [db, cache, storage] = await Promise.all([
    t(async () => { await prisma.$queryRaw`SELECT 1`; return {}; }),
    t(async () => { await redis.ping(); return {}; }),
    t(async () => { await fs.access(env.UPLOAD_DIR, fsConstants.W_OK); return {}; }),
  ]);
  const queueStats: Record<string, unknown> = {};
  for (const [name, qq] of Object.entries(queues)) {
    try { queueStats[name] = await qq.getJobCounts('waiting', 'active', 'delayed', 'failed'); } catch { queueStats[name] = { error: 'UNAVAILABLE' }; }
  }
  const since = new Date(Date.now() - 24 * 3600_000);
  const [whFailed, whOk, pushErrors] = await Promise.all([
    prisma.webhookDelivery.count({ where: { createdAt: { gte: since }, succeededAt: null, attempts: { gt: 0 } } }),
    prisma.webhookDelivery.count({ where: { createdAt: { gte: since }, succeededAt: { not: null } } }),
    prisma.notification.count({ where: { createdAt: { gte: since }, pushError: { not: null } } }),
  ]);
  res.json({
    serverTime: new Date(), nodeEnv: env.NODE_ENV, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    db, redis: cache, storage, realtime: realtimeStats(), queues: queueStats,
    providers: { sms: env.SMS_PROVIDER, maps: env.MAPS_PROVIDER, mapsKeyConfigured: !!env.MAPS_API_KEY, push: env.PUSH_PROVIDER, fcmConfigured: !!env.FCM_SERVICE_ACCOUNT_JSON, sentryConfigured: !!env.SENTRY_DSN },
    last24h: { webhookFailures: whFailed, webhookSuccess: whOk, pushErrors },
  });
}));
