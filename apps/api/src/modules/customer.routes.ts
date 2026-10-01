import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { buildQuote } from './pricing.ts';
import { createOrder, cancelOrder } from './orders.service.ts';
import { EgPhone } from './auth.ts';
import { emit } from './realtime.ts';

export const customerRouter = Router();
const LatLng = z.object({ lat: z.number().min(21).max(32), lng: z.number().min(24).max(37) }); // Egypt bbox
const Stop = LatLng.extend({ formatted: z.string().max(300).optional(), description: z.string().max(500).optional(), landmark: z.string().max(200).optional(),
  contactName: z.string().max(80).optional(), contactPhone: EgPhone.optional(), instructions: z.string().max(500).optional(), photoUrl: z.string().url().optional() });
const OrderBody = z.object({
  pickup: Stop, dropoffs: z.array(Stop).min(1).max(5), vehicleTypeCode: z.string(), packageSizeCode: z.string(), categoryCode: z.string(),
  weightKg: z.number().positive().max(2000), notes: z.string().max(500).optional(), packagePhotoUrl: z.string().url().optional(), urgent: z.boolean().default(false),
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 15 * 60_000, 'الموعد يجب أن يكون بعد 15 دقيقة على الأقل').optional(),
  couponCode: z.string().max(40).optional(), paymentMethod: z.enum(['CASH', 'WALLET']).default('CASH'),
});
const page = (q: any) => ({ take: Math.min(Number(q.limit) || 20, 50), cursor: q.cursor ? { id: String(q.cursor) } : undefined, skip: q.cursor ? 1 : 0 });

customerRouter.get('/catalog', ah(async (_req, res) => {
  const [vehicles, sizes, categories] = await Promise.all([
    prisma.vehicleType.findMany({ where: { active: true }, select: { code: true, nameAr: true, maxKg: true, allowedSizes: true } }),
    prisma.packageSize.findMany({ where: { active: true }, select: { code: true, nameAr: true, maxKg: true } }),
    prisma.packageCategory.findMany({ where: { active: true } })]);
  res.json({ vehicles, sizes, categories });
}));

customerRouter.post('/quote', ah(async (req, res) => {
  const b = OrderBody.parse(req.body);
  const q = await buildQuote({ ...b, userId: req.user!.id });
  res.json({ distanceKm: q.distanceKm, etaMinutes: q.durationMin, lines: q.lines, subtotal: q.subtotal, discount: q.discount, total: q.total, currency: 'EGP' });
}));

customerRouter.post('/orders', ah(async (req, res) => {
  const b = OrderBody.parse(req.body);
  const businessId = typeof req.body.businessId === 'string' && req.user!.businessIds.includes(req.body.businessId) ? req.body.businessId : null;
  const r = await createOrder({ ...b, customerId: req.user!.id, businessId });
  res.status(201).json({ id: r.order.id, code: r.order.code, status: r.order.status, total: r.order.total, trackingToken: r.order.trackingToken,
    deliveryOtp: r.deliveryOtp, deliveryOtpNoteAr: r.deliveryOtp ? 'شارك كود التسليم مع المستلم فقط' : undefined, messageAr: 'تم إنشاء طلبك بنجاح' });
}));

const GROUPS: Record<string, string[]> = {
  current: ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'FAILED_DELIVERY', 'RETURNING'],
  completed: ['DELIVERED'], cancelled: ['CANCELLED'], failed: ['FAILED_DELIVERY'], returned: ['RETURNING', 'RETURNED'],
};
customerRouter.get('/orders', ah(async (req, res) => {
  const g = GROUPS[String(req.query.group)] as any;
  const q = String(req.query.q ?? '').trim();
  const rows = await prisma.order.findMany({
    where: { customerId: req.user!.id, ...(g ? { status: { in: g } } : {}), ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { stops: { some: { contactName: { contains: q, mode: 'insensitive' } } } }] } : {}) },
    orderBy: { createdAt: 'desc' }, ...page(req.query),
    select: { id: true, code: true, status: true, total: true, createdAt: true, scheduledAt: true, stops: { select: { type: true, formatted: true, contactName: true }, orderBy: { seq: 'asc' } } },
  });
  res.json({ items: rows, nextCursor: rows.length ? rows.at(-1)!.id : null });
}));

customerRouter.get('/orders/:id', ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, customerId: req.user!.id },
    include: { stops: { orderBy: { seq: 'asc' } }, history: { orderBy: { at: 'asc' } }, proofs: { where: { kind: 'DELIVERY' } }, ratings: true,
      driver: { select: { id: true, rating: true, lastLat: true, lastLng: true, user: { select: { name: true, avatarUrl: true } }, vehicles: { where: { isPrimary: true }, select: { plate: true, model: true, color: true } } } } } });
  if (!o) throw E.notFound('الطلب');
  const { deliveryOtpHash, ...safe } = o;
  res.json({ ...safe, history: o.history.map((h) => ({ ...h, id: h.id.toString() })) });
}));

customerRouter.post('/orders/:id/cancel', ah(async (req, res) => {
  const { reason } = z.object({ reason: z.string().max(100) }).parse(req.body);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, customerId: req.user!.id } });
  if (!o) throw E.notFound('الطلب');
  await cancelOrder(o.id, { type: 'CUSTOMER', id: req.user!.id }, reason);
  res.json({ ok: true, messageAr: 'تم إلغاء الطلب' });
}));

customerRouter.post('/orders/:id/rate', ah(async (req, res) => {
  const b = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(500).optional(), reasons: z.array(z.string()).max(10).default([]) }).parse(req.body);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, customerId: req.user!.id, status: 'DELIVERED' } });
  if (!o?.driverId) throw E.bad('NOT_RATEABLE', 'لا يمكن تقييم هذا الطلب');
  await prisma.$transaction(async (tx) => {
    await tx.rating.create({ data: { orderId: o.id, raterId: req.user!.id, rateeType: 'DRIVER', rateeId: o.driverId!, ...b } });
    const agg = await tx.rating.aggregate({ where: { rateeType: 'DRIVER', rateeId: o.driverId! }, _avg: { stars: true }, _count: true });
    await tx.driver.update({ where: { id: o.driverId! }, data: { rating: agg._avg.stars ?? 5, ratingCount: agg._count } });
  });
  res.json({ ok: true, messageAr: 'شكرًا لتقييمك' });
}));

// Addresses
const AddressBody = LatLng.extend({ label: z.enum(['HOME', 'WORK', 'FAVORITE', 'CUSTOM']), title: z.string().max(60).optional(), formatted: z.string().max(300).optional(),
  description: z.string().max(500).optional(), landmark: z.string().max(200).optional(), contactPhone: EgPhone.optional(), photoUrl: z.string().url().optional() });
customerRouter.get('/addresses', ah(async (req, res) => res.json(await prisma.address.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } }))));
customerRouter.post('/addresses', ah(async (req, res) => res.status(201).json(await prisma.address.create({ data: { ...AddressBody.parse(req.body), userId: req.user!.id } }))));
customerRouter.put('/addresses/:id', ah(async (req, res) => {
  const r = await prisma.address.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: AddressBody.partial().parse(req.body) });
  if (!r.count) throw E.notFound('العنوان'); res.json({ ok: true });
}));
customerRouter.delete('/addresses/:id', ah(async (req, res) => { await prisma.address.deleteMany({ where: { id: req.params.id, userId: req.user!.id } }); res.json({ ok: true }); }));

// Wallet
customerRouter.get('/wallet', ah(async (req, res) => {
  const w = await prisma.wallet.findUnique({ where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: req.user!.id } } });
  const tx = w ? await prisma.walletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, ...page(req.query) }) : [];
  res.json({ balance: w?.balance ?? 0, currency: 'EGP', transactions: tx, nextCursor: tx.at(-1)?.id ?? null });
}));

// Notifications
customerRouter.get('/notifications', ah(async (req, res) => {
  const items = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, ...page(req.query) });
  res.json({ items, unread: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }), nextCursor: items.at(-1)?.id ?? null });
}));
customerRouter.post('/notifications/read', ah(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body);
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
customerRouter.post('/devices', ah(async (req, res) => {
  const { pushToken, platform } = z.object({ pushToken: z.string().min(10), platform: z.enum(['android', 'ios', 'web']) }).parse(req.body);
  await prisma.device.upsert({ where: { pushToken }, update: { userId: req.user!.id, platform }, create: { pushToken, platform, userId: req.user!.id } });
  res.json({ ok: true });
}));

// Profile
customerRouter.get('/me', ah(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, phone: true, email: true, avatarUrl: true, referralCode: true, notificationPrefs: true, driver: { select: { id: true, status: true } } } });
  res.json({ ...u, roles: req.user!.roles });
}));
customerRouter.patch('/me', ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(80).optional(), email: z.string().email().optional(), avatarUrl: z.string().url().optional(), notificationPrefs: z.record(z.boolean()).optional() }).parse(req.body);
  res.json(await prisma.user.update({ where: { id: req.user!.id }, data: b, select: { id: true, name: true, email: true, avatarUrl: true } }));
}));
customerRouter.delete('/me', ah(async (req, res) => {
  const active = await prisma.order.count({ where: { customerId: req.user!.id, status: { in: GROUPS.current as any } } });
  if (active) throw E.bad('HAS_ACTIVE_ORDERS', 'لا يمكن حذف الحساب أثناء وجود طلبات جارية');
  await prisma.user.update({ where: { id: req.user!.id }, data: { status: 'DELETED', deletedAt: new Date(), phone: `deleted:${req.user!.id}`, name: null, email: null } });
  await prisma.session.updateMany({ where: { userId: req.user!.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

// In-order chat (customer & driver share the same endpoints via participant check)
export const chatRouter = Router();
async function chatFor(orderId: string, u: { id: string; driverId?: string }) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, include: { chat: true } });
  if (!o || !(o.customerId === u.id || (u.driverId && o.driverId === u.driverId))) throw E.notFound('المحادثة');
  return o;
}
chatRouter.get('/:orderId/messages', ah(async (req, res) => {
  const o = await chatFor(req.params.orderId, req.user!);
  res.json(await prisma.chatMessage.findMany({ where: { chatId: o.chat!.id }, orderBy: { createdAt: 'asc' }, take: 200 }));
}));
chatRouter.post('/:orderId/messages', ah(async (req, res) => {
  const o = await chatFor(req.params.orderId, req.user!);
  const b = z.object({ kind: z.enum(['TEXT', 'LOCATION', 'INSTRUCTION']), body: z.string().max(1000).optional(), lat: z.number().optional(), lng: z.number().optional() }).parse(req.body);
  const m = await prisma.chatMessage.create({ data: { chatId: o.chat!.id, senderId: req.user!.id, ...b } });
  emit(`order:${o.id}`, 'chat:message', m);
  res.status(201).json(m);
}));

// Support tickets
export const supportRouter = Router();
supportRouter.post('/tickets', ah(async (req, res) => {
  const b = z.object({ orderId: z.string().optional(), category: z.enum(['ORDER', 'DRIVER', 'PAYMENT', 'ADDRESS', 'REFUND', 'OTHER']), subject: z.string().min(3).max(150), body: z.string().min(3).max(3000), attachments: z.array(z.string().url()).max(5).default([]) }).parse(req.body);
  const t = await prisma.supportTicket.create({ data: { code: `TCK-${Date.now().toString(36).toUpperCase()}`, userId: req.user!.id, orderId: b.orderId, category: b.category, subject: b.subject,
    priority: b.category === 'PAYMENT' || b.category === 'REFUND' ? 'HIGH' : 'MEDIUM', messages: { create: { senderId: req.user!.id, body: b.body, attachments: b.attachments } } } });
  emit('ops', 'ticket:new', { id: t.id, code: t.code, category: t.category });
  res.status(201).json({ id: t.id, code: t.code, messageAr: 'تم استلام طلب الدعم، سنتواصل معك قريبًا' });
}));
supportRouter.get('/tickets', ah(async (req, res) => res.json(await prisma.supportTicket.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }))));
supportRouter.get('/tickets/:id', ah(async (req, res) => {
  const t = await prisma.supportTicket.findFirst({ where: { id: req.params.id, userId: req.user!.id }, include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } } });
  if (!t) throw E.notFound('التذكرة'); res.json(t);
}));
supportRouter.post('/tickets/:id/messages', ah(async (req, res) => {
  const { body } = z.object({ body: z.string().min(1).max(3000) }).parse(req.body);
  const t = await prisma.supportTicket.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!t) throw E.notFound('التذكرة');
  res.status(201).json(await prisma.ticketMessage.create({ data: { ticketId: t.id, senderId: req.user!.id, body } }));
}));
