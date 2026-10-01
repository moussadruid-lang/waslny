import crypto from 'node:crypto';
import { assertTransition, haversineKm, STATUS_MESSAGES_AR, settlementEntries, ACTIVE_DRIVER_STATUSES, type Actor, type OrderStatus } from '@mashawir/domain';
import { prisma, type Tx } from '../lib/db.ts';
import { E } from '../lib/errors.ts';
import { hashSecret } from './auth.ts';
import { buildQuote } from './pricing.ts';
import { post, PLATFORM_ID } from './ledger.ts';
import { notify, sendSms } from './notify.ts';
import { emit } from './realtime.ts';
import { queues } from '../jobs/queues.ts';
import { getSetting } from './settings.ts';
import { newTrackingToken } from './tracking.ts';
import { env } from '../config.ts';

export interface StopInput { lat: number; lng: number; formatted?: string; description?: string; landmark?: string; contactName?: string; contactPhone?: string; instructions?: string; photoUrl?: string }
export interface CreateOrderInput {
  customerId: string; businessId?: string | null; pickup: StopInput; dropoffs: StopInput[];
  vehicleTypeCode: string; packageSizeCode: string; categoryCode: string; weightKg: number; notes?: string; packagePhotoUrl?: string;
  urgent: boolean; scheduledAt?: Date | null; couponCode?: string | null; paymentMethod: 'CASH' | 'WALLET'; codAmount?: number;
  /** Who created it, for the timeline (business staff / API key / customer). */
  actor?: { type: Actor; id?: string };
}

const orderCode = () => `MSH-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

export async function createOrder(i: CreateOrderInput) {
  await assertAcceptingOrders();
  const cat = await prisma.packageCategory.findFirst({ where: { code: i.categoryCode, active: true } });
  if (!cat) throw E.bad('BAD_CATEGORY', 'نوع الشحنة غير متاح');
  // businessId is passed so business-scoped coupons are validated against the right tenant.
  const q = await buildQuote({ pickup: i.pickup, dropoffs: i.dropoffs, vehicleTypeCode: i.vehicleTypeCode, packageSizeCode: i.packageSizeCode,
    weightKg: i.weightKg, urgent: i.urgent, scheduledAt: i.scheduledAt, couponCode: i.couponCode, userId: i.customerId, businessId: i.businessId ?? null });

  const proof = await getSetting('delivery_proof');
  const otp = proof.requireOtp ? crypto.randomInt(1000, 10000).toString() : null;
  const actor = i.actor ?? { type: (i.businessId ? 'BUSINESS' : 'CUSTOMER') as Actor, id: i.customerId };

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({ data: {
      code: orderCode(), trackingToken: newTrackingToken(), customerId: i.customerId, businessId: i.businessId ?? null,
      vehicleTypeCode: i.vehicleTypeCode, packageSizeCode: i.packageSizeCode, categoryCode: i.categoryCode, weightKg: i.weightKg,
      notes: i.notes, packagePhotoUrl: i.packagePhotoUrl, urgent: i.urgent, scheduledAt: i.scheduledAt ?? null,
      distanceKm: q.distanceKm, priceBreakdown: q.lines as any, subtotal: q.subtotal, discount: q.discount, total: q.total,
      codAmount: i.codAmount ?? 0, couponId: q.couponId, pricingRuleId: q.ruleId, paymentMethod: i.paymentMethod,
      deliveryOtpHash: otp ? hashSecret(otp) : null,
      stops: { create: [
        { seq: 0, type: 'PICKUP', ...i.pickup, geoUnitId: q.pickupGeo.unit.id, governorateId: q.pickupGeo.governorateId, cityId: q.pickupGeo.cityId },
        ...i.dropoffs.map((d, n) => ({ seq: n + 1, type: 'DROPOFF' as const, ...d, geoUnitId: q.dropGeos[n].unit.id, governorateId: q.dropGeos[n].governorateId, cityId: q.dropGeos[n].cityId })),
      ] },
      history: { create: { toStatus: 'NEW', actorType: actor.type, actorId: actor.id, lat: i.pickup.lat, lng: i.pickup.lng } },
      chat: { create: {} },
      payments: { create: { method: i.paymentMethod, provider: i.paymentMethod === 'CASH' ? 'cash' : 'wallet', amount: q.total } },
    } });
    if (q.couponId) {
      await tx.coupon.update({ where: { id: q.couponId }, data: { usedCount: { increment: 1 } } });
      await tx.couponRedemption.create({ data: { couponId: q.couponId, userId: i.customerId, orderId: o.id, amount: q.discount } });
    }
    if (i.paymentMethod === 'WALLET') { // hold funds now; settlement posts the final split
      await post(tx, { ownerType: 'CUSTOMER', ownerId: i.customerId, type: 'ORDER_HOLD', amount: -q.total, orderId: o.id, idempotencyKey: `hold:${o.id}`, allowNegative: false });
    }
    return o;
  });

  await notify(i.customerId, { type: 'ORDER_CREATED', titleAr: 'مشاوير', bodyAr: STATUS_MESSAGES_AR.NEW, deepLink: `mashawir://orders/${order.id}` });
  emit('ops', 'order:new', { orderId: order.id, code: order.code });
  const recipientPhone = i.dropoffs[0].contactPhone;
  if (recipientPhone) await sendSms(recipientPhone, `لديك شحنة من مشاوير. تتبعها: ${env.PUBLIC_TRACKING_BASE_URL}/${order.trackingToken}${otp ? ` — كود الاستلام: ${otp}` : ''}`);

  if (!order.scheduledAt) await startDispatch(order.id);
  else {
    const lead = (await getSetting('dispatch')).scheduledLeadMinutes * 60_000;
    await queues.scheduled.add('start', { orderId: order.id }, { delay: Math.max(0, order.scheduledAt.getTime() - Date.now() - lead), jobId: `sched:${order.id}` });
  }
  return { order, quote: q, deliveryOtp: otp };
}

export async function startDispatch(orderId: string, actor: { type: Actor; id?: string } = { type: 'SYSTEM' }) {
  await transition(orderId, 'SEARCHING_DRIVER', actor);
  await queues.dispatch.add('wave', { orderId, wave: 0 }, { jobId: `wave:${orderId}:0:${Date.now()}` });
}

/**
 * The ONLY way to change an order status. Validates the transition against the state machine,
 * uses optimistic locking (version) so concurrent writes can't interleave, and logs the timeline.
 */
export async function transition(orderId: string, to: OrderStatus, actor: { type: Actor; id?: string; lat?: number; lng?: number }, extra: { reason?: string; meta?: any; data?: Record<string, any> } = {}, txIn?: Tx) {
  const run = async (tx: Tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw E.notFound('الطلب');
    assertTransition(o.status as OrderStatus, to, actor.type);
    const res = await tx.order.updateMany({ where: { id: orderId, version: o.version }, data: { status: to, version: { increment: 1 }, ...(extra.data ?? {}) } });
    if (res.count !== 1) throw E.conflict('ORDER_CHANGED', 'تم تحديث الطلب للتو، أعد المحاولة');
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: o.status, toStatus: to, actorType: actor.type, actorId: actor.id, lat: actor.lat, lng: actor.lng, reason: extra.reason, meta: extra.meta } });
    return { before: o, to };
  };
  const r = txIn ? await run(txIn) : await prisma.$transaction(run);
  if (!txIn) await afterTransition(orderId, to);
  return r;
}

export async function afterTransition(orderId: string, to: OrderStatus) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { driver: { include: { user: true } } } });
  const payload = { orderId, code: o.code, status: to, messageAr: STATUS_MESSAGES_AR[to], driverName: o.driver?.user.name, driverId: o.driverId, at: new Date() };
  emit(`order:${orderId}`, 'order:status', payload);
  // Public room gets no ids / names: the page refetches the redacted view.
  emit(`track:${o.trackingToken}`, 'order:status', { code: o.code, status: to, messageAr: STATUS_MESSAGES_AR[to], at: new Date() });
  emit('ops', 'order:status', payload);
  const body = to === 'DRIVER_ASSIGNED' && o.driver?.user.name ? `تم تعيين المندوب ${o.driver.user.name}` : STATUS_MESSAGES_AR[to];
  await notify(o.customerId, { type: `ORDER_${to}`, titleAr: 'مشاوير', bodyAr: body, deepLink: `mashawir://orders/${orderId}` });
  // Worker fans this out to one retriable delivery per subscribed webhook.
  if (o.businessId) await queues.webhooks.add('event', { businessId: o.businessId, event: `order.${to.toLowerCase()}`, orderId });
}

/**
 * Atomic accept: exactly one driver can win. Two guarded updateMany calls inside one transaction:
 * order must still be SEARCHING with no driver; driver must still be under capacity. Loser gets 409.
 * `byOps` = manual assignment from Live Ops (timeline actor OPERATIONS, offer not required).
 */
export async function acceptOffer(orderId: string, driverId: string, byOps?: { userId: string; reason?: string }) {
  const settings = await getSetting('dispatch');
  await prisma.$transaction(async (tx) => {
    const offer = await tx.dispatchOffer.findUnique({ where: { orderId_driverId: { orderId, driverId } } });
    if (!byOps && (!offer || offer.status !== 'PENDING' || offer.expiresAt < new Date())) throw E.conflict('OFFER_EXPIRED', 'انتهى هذا العرض');
    const driver = await tx.driver.findUniqueOrThrow({ where: { id: driverId } });
    if (driver.status !== 'APPROVED' || (!byOps && !driver.online)) throw byOps ? E.bad('DRIVER_NOT_APPROVED', 'المندوب غير معتمد') : E.forbidden();

    const won = await tx.order.updateMany({ where: { id: orderId, status: 'SEARCHING_DRIVER', driverId: null }, data: { status: 'DRIVER_ASSIGNED', driverId, version: { increment: 1 } } });
    if (won.count !== 1) throw E.conflict('ORDER_TAKEN', byOps ? 'تغيرت حالة الطلب، حدّث الصفحة' : 'تم قبول الطلب من مندوب آخر');
    const cap = await tx.driver.updateMany({ where: { id: driverId, activeOrders: { lt: settings.maxActiveOrdersPerDriver } }, data: { activeOrders: { increment: 1 } } });
    if (cap.count !== 1) throw E.conflict('DRIVER_BUSY', byOps ? 'المندوب وصل للحد الأقصى من الطلبات النشطة' : 'لديك طلب نشط بالفعل'); // rolls back the order update too

    if (offer) await tx.dispatchOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    else await tx.dispatchOffer.create({ data: { orderId, driverId, wave: 99, distanceKm: 0, status: 'ACCEPTED', respondedAt: new Date(), expiresAt: new Date() } });
    await tx.dispatchOffer.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: 'SEARCHING_DRIVER', toStatus: 'DRIVER_ASSIGNED', actorType: byOps ? 'OPERATIONS' : 'DRIVER', actorId: byOps?.userId ?? driverId, lat: driver.lastLat, lng: driver.lastLng, reason: byOps?.reason } });
  });
  emit('ops', 'offers:closed', { orderId });
  if (byOps) emit(`driver:${driverId}`, 'order:assigned', { orderId });
  await afterTransition(orderId, 'DRIVER_ASSIGNED');
}

/** Driver releases the order (or ops reassigns): back to the pool. `redispatch=false` keeps it out of auto-dispatch (manual assignment follows). */
export async function releaseDriver(orderId: string, actor: { type: Actor; id?: string }, reason: string, redispatch = true) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (!o.driverId) throw E.bad('NO_DRIVER', 'لا يوجد مندوب على الطلب');
  await prisma.$transaction(async (tx) => {
    await transition(orderId, 'SEARCHING_DRIVER', actor, { reason, data: { driverId: null, dispatchWave: 0 } }, tx);
    await tx.driver.update({ where: { id: o.driverId! }, data: { activeOrders: { decrement: 1 } } });
  });
  emit(`driver:${o.driverId}`, 'order:released', { orderId, reason });
  await afterTransition(orderId, 'SEARCHING_DRIVER');
  if (redispatch) await queues.dispatch.add('wave', { orderId, wave: 0 }, { jobId: `wave:${orderId}:0:${Date.now()}` });
}

/** Proof of delivery + payment settlement + commission + wallet updates, all in ONE transaction. */
export async function completeDelivery(orderId: string, driverId: string, p: { otp?: string; recipientName?: string; photoUrl?: string; signatureUrl?: string; lat: number; lng: number; capturedAt: Date; clientId?: string }) {
  const rules = await getSetting('delivery_proof');
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { stops: true } });
  if (o.driverId !== driverId) throw E.forbidden();
  if (o.status !== 'DRIVER_ARRIVED_DESTINATION') throw E.conflict('INVALID_TRANSITION', 'يجب الوصول لنقطة التسليم أولًا');
  if (p.clientId && await prisma.deliveryProof.findUnique({ where: { clientId: p.clientId } })) return { idempotent: true };

  const otpOk = !!o.deliveryOtpHash && !!p.otp && hashSecret(p.otp) === o.deliveryOtpHash;
  if (rules.requireOtp && !otpOk) throw E.bad('OTP_INVALID', 'كود التسليم غير صحيح');
  if (rules.requirePhoto && !p.photoUrl) throw E.bad('PHOTO_REQUIRED', 'صورة التسليم مطلوبة');
  if (rules.requireSignature && !p.signatureUrl) throw E.bad('SIGNATURE_REQUIRED', 'توقيع المستلم مطلوب');
  if (rules.requireRecipientName && !p.recipientName) throw E.bad('NAME_REQUIRED', 'اسم المستلم مطلوب');
  const drop = o.stops.find((s) => s.type === 'DROPOFF' && !s.completedAt) ?? o.stops.at(-1)!;
  if (rules.maxDistanceMeters && haversineKm(p, drop) * 1000 > rules.maxDistanceMeters) throw E.bad('TOO_FAR', 'أنت بعيد عن نقطة التسليم');

  const commissionRule = await resolveCommissionRule(o);
  await prisma.$transaction(async (tx) => {
    await tx.deliveryProof.create({ data: { orderId, kind: 'DELIVERY', otpVerified: otpOk, recipientName: p.recipientName, photoUrl: p.photoUrl, signatureUrl: p.signatureUrl, lat: p.lat, lng: p.lng, capturedAt: p.capturedAt, clientId: p.clientId } });
    await transition(orderId, 'DELIVERED', { type: 'DRIVER', id: driverId, lat: p.lat, lng: p.lng }, { data: { deliveredAt: new Date() } }, tx);
    await tx.orderStop.update({ where: { id: drop.id }, data: { completedAt: new Date() } });
    await tx.driver.update({ where: { id: driverId }, data: { activeOrders: { decrement: 1 } } });
    await settle(tx, o, driverId, commissionRule);
  });
  await afterTransition(orderId, 'DELIVERED');
  return { ok: true };
}

async function settle(tx: Tx, o: { id: string; total: number; discount: number; codAmount: number; paymentMethod: string; customerId: string; businessId: string | null }, driverId: string, rule: any) {
  const method = o.paymentMethod === 'CASH' ? 'CASH' : 'WALLET';
  const s = settlementEntries({ method, fee: o.total, discount: o.discount, codAmount: o.codAmount, rule, hasBusiness: !!o.businessId });
  for (const e of s.entries) {
    if (e.amount === 0) continue;
    if (e.wallet === 'CUSTOMER') continue; // wallet funds already held at creation (ORDER_HOLD)
    const owner = e.wallet === 'DRIVER' ? { ownerType: 'DRIVER' as const, ownerId: driverId } : { ownerType: 'PLATFORM' as const, ownerId: PLATFORM_ID };
    await post(tx, { ...owner, type: e.type, amount: e.amount, orderId: o.id, idempotencyKey: `settle:${o.id}:${e.wallet}:${e.type}` });
  }
  if (method === 'WALLET') await post(tx, { ownerType: 'PLATFORM', ownerId: PLATFORM_ID, type: 'CUSTOMER_PAYMENT_IN', amount: o.total, orderId: o.id, idempotencyKey: `settle:${o.id}:in` });
  if (o.codAmount && o.businessId) await post(tx, { ownerType: 'BUSINESS', ownerId: o.businessId, type: 'COD_RECEIVABLE', amount: o.codAmount, orderId: o.id, idempotencyKey: `settle:${o.id}:cod` });
  await tx.commission.create({ data: { orderId: o.id, driverId, grossFee: o.total + o.discount, commission: s.commission, driverEarning: s.driverEarning } });
  await tx.payment.updateMany({ where: { orderId: o.id }, data: { status: 'PAID' } });
}

async function resolveCommissionRule(o: { vehicleTypeCode: string; businessId: string | null; stops: { governorateId: string | null }[] }) {
  const rules = await prisma.commissionRule.findMany({ where: { active: true } });
  const gov = o.stops[0]?.governorateId;
  const ok = rules.filter((r) => (!r.businessId || r.businessId === o.businessId) && (!r.vehicleTypeCode || r.vehicleTypeCode === o.vehicleTypeCode) && (!r.governorateId || r.governorateId === gov));
  ok.sort((a, b) => (+!!b.businessId * 4 + +!!b.governorateId * 2 + +!!b.vehicleTypeCode) - (+!!a.businessId * 4 + +!!a.governorateId * 2 + +!!a.vehicleTypeCode));
  if (!ok[0]) throw new Error('No commission rule configured');
  return ok[0];
}

export async function failDelivery(orderId: string, actor: { type: Actor; id: string; lat?: number; lng?: number }, reasonCode: string, photoUrl?: string) {
  const reason = await prisma.failureReason.findUnique({ where: { code: reasonCode } });
  if (!reason) throw E.bad('BAD_REASON', 'سبب غير معروف');
  if (reason.requiresPhoto && !photoUrl && actor.type === 'DRIVER') throw E.bad('PHOTO_REQUIRED', 'الصورة مطلوبة لهذا السبب');
  await prisma.$transaction(async (tx) => {
    await transition(orderId, 'FAILED_DELIVERY', actor, { reason: reasonCode, data: { failReason: reasonCode } }, tx);
    if (photoUrl) await tx.deliveryProof.create({ data: { orderId, kind: 'FAILURE', photoUrl, lat: actor.lat, lng: actor.lng, capturedAt: new Date() } });
  });
  await afterTransition(orderId, 'FAILED_DELIVERY');
  emit('ops', 'alert', { kind: 'FAILED_DELIVERY', orderId, reason: reason.nameAr });
  if (reason.nextAction === 'RETURN') await transition(orderId, 'RETURNING', { type: 'SYSTEM' }, { reason: 'auto-return' });
}

/**
 * Return fee uses the pricing rule version the order was priced with (rules are versioned, never edited in place),
 * so changing today's pricing can never change what an old order is charged.
 */
export async function completeReturn(orderId: string, actor: { type: Actor; id: string; lat?: number; lng?: number }) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const rule = await prisma.pricingRule.findUniqueOrThrow({ where: { id: o.pricingRuleId } });
  const fee = Math.round((o.total * rule.returnFeePercent) / 100);
  await prisma.$transaction(async (tx) => {
    await transition(orderId, 'RETURNED', actor, {}, tx);
    if (o.driverId) await tx.driver.update({ where: { id: o.driverId }, data: { activeOrders: { decrement: 1 } } });
    // Return charge: payer = business (if any) else customer wallet; driver gets paid for the trip.
    if (fee && o.driverId) {
      const payer = o.businessId ? { ownerType: 'BUSINESS' as const, ownerId: o.businessId } : { ownerType: 'CUSTOMER' as const, ownerId: o.customerId };
      await post(tx, { ...payer, type: 'RETURN_FEE', amount: -fee, orderId, idempotencyKey: `ret:${orderId}:payer`, allowNegative: true });
      await post(tx, { ownerType: 'DRIVER', ownerId: o.driverId, type: 'RETURN_EARNING', amount: fee, orderId, idempotencyKey: `ret:${orderId}:drv` });
    }
    if (o.paymentMethod === 'WALLET') await post(tx, { ownerType: 'CUSTOMER', ownerId: o.customerId, type: 'REFUND', amount: o.total, orderId, idempotencyKey: `ret:${orderId}:refund` });
  });
  await afterTransition(orderId, 'RETURNED');
}

export async function cancelOrder(orderId: string, actor: { type: Actor; id: string }, reason: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await prisma.$transaction(async (tx) => {
    await transition(orderId, 'CANCELLED', actor, { reason, data: { cancelReason: reason } }, tx);
    if (o.driverId && ACTIVE_DRIVER_STATUSES.includes(o.status as OrderStatus)) await tx.driver.update({ where: { id: o.driverId }, data: { activeOrders: { decrement: 1 } } });
    await tx.dispatchOffer.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (o.paymentMethod === 'WALLET') await post(tx, { ownerType: 'CUSTOMER', ownerId: o.customerId, type: 'REFUND', amount: o.total, orderId, idempotencyKey: `cancel:${orderId}:refund` });
    if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { usedCount: { decrement: 1 } } });
    await tx.couponRedemption.deleteMany({ where: { orderId } });
    await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'FAILED' } });
  });
  if (o.driverId) emit(`driver:${o.driverId}`, 'order:cancelled', { orderId, reason });
  await afterTransition(orderId, 'CANCELLED');
}

async function assertAcceptingOrders() {
  const p = await getSetting('platform');
  if (p.pauseOrders) throw E.bad('PAUSED', p.pauseMessageAr || 'استقبال الطلبات متوقف مؤقتًا');
}
