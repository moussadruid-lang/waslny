import crypto from 'node:crypto';
import { etaMinutes, haversineKm, STATUS_MESSAGES_AR, type OrderStatus } from '@mashawir/domain';
import { prisma } from '../lib/db.ts';
import { AppError, E } from '../lib/errors.ts';
import { getSetting } from './settings.ts';

export const PUBLIC_DRIVER_STATUSES = ['DRIVER_GOING_TO_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION'];
const TERMINAL = ['DELIVERED', 'CANCELLED', 'RETURNED'];
const PROGRESS = ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DELIVERED'];
const FLOW = ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'DELIVERED'];

export const newTrackingToken = () => crypto.randomBytes(16).toString('base64url'); // 128-bit, URL-safe, unguessable
export const isTokenShape = (t: string) => /^[A-Za-z0-9_-]{16,64}$/.test(t);
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d; // ~110 m: enough for a map, not a house

export async function trackingExpired(o: { status: string; deliveredAt: Date | null; updatedAt: Date }) {
  if (!TERMINAL.includes(o.status)) return false;
  const { expireHoursAfterDone } = await getSetting('tracking');
  return (o.deliveredAt ?? o.updatedAt).getTime() + expireHoursAfterDone * 3600_000 < Date.now();
}

/**
 * The ONLY public view of an order. No phones, names (driver first name only), addresses, payment or DB ids.
 * Driver position is shown only while en route AND fresh; otherwise `stale` + last seen time.
 */
export async function publicTrackingView(where: { trackingToken: string } | { id: string }) {
  const o = await prisma.order.findUnique({ where: where as any, include: {
    stops: { orderBy: { seq: 'asc' }, select: { type: true, lat: true, lng: true, geoUnitId: true, completedAt: true } },
    history: { orderBy: { at: 'asc' }, select: { toStatus: true, at: true } },
    driver: { select: { lastLat: true, lastLng: true, lastLocationAt: true, user: { select: { name: true } }, vehicles: { where: { isPrimary: true }, select: { vehicleType: { select: { nameAr: true } } } } } } } });
  if (!o) throw E.notFound('الطلب');
  if (await trackingExpired(o)) throw new AppError(410, 'TRACKING_EXPIRED', 'انتهت صلاحية رابط التتبع');
  const { driverFreshSec } = await getSetting('tracking');
  const units = await prisma.geoUnit.findMany({ where: { id: { in: o.stops.map((s) => s.geoUnitId).filter(Boolean) as string[] } }, select: { id: true, nameAr: true } });
  const areaName = (id: string | null) => units.find((u) => u.id === id)?.nameAr ?? null;
  const pickup = o.stops.find((s) => s.type === 'PICKUP');
  const drops = o.stops.filter((s) => s.type === 'DROPOFF');
  const picked = FLOW.indexOf(o.status) >= FLOW.indexOf('PACKAGE_PICKED_UP') && o.status !== 'CANCELLED';

  const showDriver = PUBLIC_DRIVER_STATUSES.includes(o.status) && !!o.driver;
  const at = o.driver?.lastLocationAt ?? null;
  const fresh = !!at && Date.now() - at.getTime() <= driverFreshSec * 1000;
  let eta: number | null = null;
  if (showDriver && fresh && o.driver?.lastLat != null) {
    const target = picked ? drops.find((d) => !d.completedAt) ?? drops[0] : pickup;
    if (target) eta = etaMinutes(haversineKm({ lat: o.driver.lastLat, lng: o.driver.lastLng! }, target) * 1.3, 30);
  }
  const seen = new Set<string>();
  const timeline = o.history.filter((h) => !seen.has(h.toStatus) && seen.add(h.toStatus)).map((h) => ({ status: h.toStatus, statusAr: STATUS_MESSAGES_AR[h.toStatus as OrderStatus], at: h.at }));
  return {
    brand: 'مشاوير', code: o.code, status: o.status, statusAr: STATUS_MESSAGES_AR[o.status as OrderStatus], terminal: TERMINAL.includes(o.status),
    progress: { step: Math.max(0, PROGRESS.findLastIndex((p) => FLOW.indexOf(p) <= FLOW.indexOf(o.status))), steps: PROGRESS.length, pickedUp: picked, delivered: o.status === 'DELIVERED' },
    timeline,
    pickup: pickup ? { lat: round(pickup.lat), lng: round(pickup.lng), area: areaName(pickup.geoUnitId) } : null,
    destinations: drops.map((d) => ({ lat: round(d.lat), lng: round(d.lng), area: areaName(d.geoUnitId), done: !!d.completedAt })),
    driver: showDriver ? { firstName: o.driver!.user.name?.split(' ')[0] ?? null, vehicle: o.driver!.vehicles[0]?.vehicleType.nameAr ?? null,
      location: fresh && o.driver!.lastLat != null ? { lat: o.driver!.lastLat, lng: o.driver!.lastLng! } : null, lastSeenAt: at, stale: !fresh } : null,
    etaMinutes: eta,
    updatedAt: new Date(Math.max(o.updatedAt.getTime(), showDriver && at ? at.getTime() : 0)),
    serverTime: new Date(),
  };
}
