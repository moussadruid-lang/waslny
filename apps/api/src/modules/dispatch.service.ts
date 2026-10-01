import { selectWave, isLastWave, type DriverCandidate } from '@mashawir/domain';
import { prisma } from '../lib/db.ts';
import { getSetting } from './settings.ts';
import { notify } from './notify.ts';
import { emit } from './realtime.ts';
import { queues } from '../jobs/queues.ts';
import { logger } from '../lib/logger.ts';

/** Runs one dispatch wave: picks best eligible drivers in the current radius, creates offers, schedules the next wave. */
export async function runWave(orderId: string, wave: number) {
  const s = await getSetting('dispatch');
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { stops: { orderBy: { seq: 'asc' } }, offers: true } });
  if (!order || order.status !== 'SEARCHING_DRIVER') return; // accepted/cancelled meanwhile

  await prisma.dispatchOffer.updateMany({ where: { orderId, status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });

  if (wave >= s.giveUpAfterWaves) {
    emit('ops', 'alert', { kind: 'NO_DRIVER', orderId, code: order.code });
    logger.warn({ orderId }, 'no driver found after all waves');
    return; // stays SEARCHING_DRIVER: visible on live ops for manual assignment
  }

  const pickup = order.stops[0];
  // Only vehicles that are active and can physically carry this package
  const vehicle = await prisma.vehicleType.findFirst({ where: { code: order.vehicleTypeCode, active: true, maxKg: { gte: order.weightKg }, allowedSizes: { has: order.packageSizeCode } } });
  const allowedVehicleCodes = vehicle ? [vehicle.code] : [];

  const box = 0.2; // ~22km prefilter; precise filtering in domain
  const drivers = await prisma.driver.findMany({
    where: { status: 'APPROVED', online: true, activeOrders: { lt: s.maxActiveOrdersPerDriver },
      lastLat: { gte: pickup.lat - box, lte: pickup.lat + box }, lastLng: { gte: pickup.lng - box, lte: pickup.lng + box } },
    include: { vehicles: { where: { isPrimary: true }, include: { vehicleType: true } } },
    take: 500,
  });
  const now = Date.now();
  const candidates: DriverCandidate[] = drivers.filter((d) => d.vehicles[0]).map((d) => ({
    id: d.id, status: d.status, online: d.online, activeOrders: d.activeOrders,
    location: d.lastLat != null && d.lastLng != null ? { lat: d.lastLat, lng: d.lastLng } : null,
    locationAgeSec: d.lastLocationAt ? (now - d.lastLocationAt.getTime()) / 1000 : Infinity,
    vehicleTypeCode: d.vehicles[0].vehicleType.code, vehicleMaxKg: d.vehicles[0].vehicleType.maxKg,
    serviceAreaIds: d.serviceAreaIds, rating: d.rating, acceptanceRate: d.acceptanceRate,
  }));
  const offered = new Set(order.offers.map((o) => o.driverId));
  const picks = selectWave(candidates, { pickup, pickupAreaId: pickup.geoUnitId, weightKg: order.weightKg }, { ...s, allowedVehicleCodes }, wave, offered);

  const expiresAt = new Date(now + s.offerTimeoutSec * 1000);
  for (const p of picks) {
    await prisma.dispatchOffer.create({ data: { orderId, driverId: p.driverId, wave, distanceKm: p.distanceKm, expiresAt } });
    const drv = await prisma.driver.findUniqueOrThrow({ where: { id: p.driverId }, select: { userId: true } });
    emit(`driver:${p.driverId}`, 'offer:new', { orderId, code: order.code, distanceKm: p.distanceKm, total: order.total, expiresAt });
    await notify(drv.userId, { type: 'DRIVER_NEW_OFFER', titleAr: 'طلب جديد', bodyAr: `طلب على بعد ${p.distanceKm} كم — ${order.total / 100} جنيه`, deepLink: `mashawir-driver://offers/${orderId}` });
  }
  await prisma.order.update({ where: { id: orderId }, data: { dispatchWave: wave } });
  emit('ops', 'dispatch:wave', { orderId, wave, offered: picks.length });

  const next = isLastWave({ ...s, allowedVehicleCodes }, wave) && picks.length === 0 ? s.giveUpAfterWaves : wave + 1;
  await queues.dispatch.add('wave', { orderId, wave: next }, { delay: picks.length ? s.offerTimeoutSec * 1000 : 3000, jobId: `wave:${orderId}:${next}:${now}` });
}

export async function rejectOffer(orderId: string, driverId: string) {
  await prisma.dispatchOffer.updateMany({ where: { orderId, driverId, status: 'PENDING' }, data: { status: 'REJECTED', respondedAt: new Date() } });
  // rolling acceptance rate (last 50 offers)
  const last = await prisma.dispatchOffer.findMany({ where: { driverId, status: { in: ['ACCEPTED', 'REJECTED', 'EXPIRED'] } }, orderBy: { createdAt: 'desc' }, take: 50 });
  if (last.length) await prisma.driver.update({ where: { id: driverId }, data: { acceptanceRate: last.filter((o) => o.status === 'ACCEPTED').length / last.length } });
}
