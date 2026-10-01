import { Router } from 'express';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { invalidateAuthCache, requireDriver } from '../middleware/auth.ts';

/** Statuses where both parties may contact each other. Phones are never exposed outside this window. */
const CONTACT_WINDOW = ['DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'FAILED_DELIVERY', 'RETURNING'];
const page = (q: any) => ({ take: Math.min(Number(q.limit) || 20, 50), cursor: q.cursor ? { id: String(q.cursor) } : undefined, skip: q.cursor ? 1 : 0 });

// ---------------- Customer extras ----------------
export const customerExtraRouter = Router();

customerExtraRouter.get('/orders/:id/contact', ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, customerId: req.user!.id, status: { in: CONTACT_WINDOW as any } },
    select: { driver: { select: { user: { select: { name: true, phone: true } } } } } });
  if (!o?.driver) throw E.bad('NO_CONTACT', 'التواصل متاح فقط أثناء تنفيذ الطلب');
  res.json({ name: o.driver.user.name, phone: o.driver.user.phone });
}));

/** An existing customer can apply to become a driver (same phone, same account). */
customerExtraRouter.post('/become-driver', ah(async (req, res) => {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'DRIVER' } });
  await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: req.user!.id, roleId: role.id } }, update: {}, create: { userId: req.user!.id, roleId: role.id } });
    await tx.driver.upsert({ where: { userId: req.user!.id }, update: {}, create: { userId: req.user!.id } });
  });
  invalidateAuthCache(req.user!.id);
  res.json({ ok: true });
}));

customerExtraRouter.get('/referral', ah(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { referralCode: true } });
  const [invited, rewarded, setting] = await Promise.all([
    prisma.referral.count({ where: { referrerId: req.user!.id } }),
    prisma.referral.count({ where: { referrerId: req.user!.id, rewardedAt: { not: null } } }),
    prisma.setting.findUnique({ where: { key: 'referral' } }),
  ]);
  res.json({ code: u.referralCode, invited, rewarded, rules: setting?.value ?? null });
}));

// ---------------- Driver extras ----------------
export const driverExtraRouter = Router();
driverExtraRouter.use(requireDriver);
const did = (req: any) => req.user!.driverId as string;

driverExtraRouter.get('/me', ah(async (req, res) => {
  const d = await prisma.driver.findUniqueOrThrow({ where: { id: did(req) }, include: {
    user: { select: { name: true, phone: true, avatarUrl: true } },
    vehicles: { where: { isPrimary: true }, include: { vehicleType: { select: { code: true, nameAr: true } } } },
    documents: { select: { type: true, status: true, note: true }, orderBy: { createdAt: 'desc' } } } });
  res.json({
    id: d.id, status: d.status, rejectionReason: d.rejectionReason, online: d.online, activeOrders: d.activeOrders,
    rating: d.rating, ratingCount: d.ratingCount, acceptanceRate: d.acceptanceRate,
    nationalIdMasked: d.nationalIdNo ? '••••' + d.nationalIdNo.slice(-4) : null,
    user: d.user, vehicle: d.vehicles[0] ? { model: d.vehicles[0].model, plate: d.vehicles[0].plate, color: d.vehicles[0].color, type: d.vehicles[0].vehicleType } : null,
    documents: d.documents, profileComplete: !!d.nationalIdNo && d.vehicles.length > 0,
  });
}));

driverExtraRouter.get('/reasons', ah(async (_req, res) => {
  const all = await prisma.failureReason.findMany({ orderBy: { code: 'asc' } });
  res.json({ failure: all.filter((r) => r.appliesTo === 'FAILED_DELIVERY'), release: all.filter((r) => r.appliesTo === 'CANCEL_DRIVER') });
}));

driverExtraRouter.get('/orders/history', ah(async (req, res) => {
  const items = await prisma.order.findMany({ where: { driverId: did(req), status: { in: ['DELIVERED', 'CANCELLED', 'RETURNED'] } }, orderBy: { updatedAt: 'desc' }, ...page(req.query),
    select: { id: true, code: true, status: true, total: true, deliveredAt: true, updatedAt: true, distanceKm: true, stops: { select: { type: true, formatted: true }, orderBy: { seq: 'asc' } } } });
  res.json({ items, nextCursor: items.at(-1)?.id ?? null });
}));

/** Phones for the stops of an active order; pickup falls back to the customer's phone. */
driverExtraRouter.get('/orders/:id/contacts', ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, driverId: did(req), status: { in: CONTACT_WINDOW as any } },
    include: { stops: { orderBy: { seq: 'asc' }, select: { id: true, type: true, contactName: true, contactPhone: true } }, customer: { select: { name: true, phone: true } } } });
  if (!o) throw E.bad('NO_CONTACT', 'التواصل متاح فقط أثناء تنفيذ الطلب');
  res.json({ customer: o.customer, stops: o.stops.map((s) => ({ ...s, contactPhone: s.contactPhone ?? (s.type === 'PICKUP' ? o.customer.phone : null) })) });
}));
