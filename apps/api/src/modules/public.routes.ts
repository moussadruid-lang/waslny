import { Router } from 'express';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { STATUS_MESSAGES_AR } from '@mashawir/domain';

/** Public tracking: no auth, no phones, no full addresses. Driver position only while en route. */
export const publicRouter = Router();
publicRouter.get('/track/:token', ah(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { trackingToken: req.params.token }, include: {
    stops: { orderBy: { seq: 'asc' }, select: { type: true, lat: true, lng: true, geoUnitId: true } },
    history: { orderBy: { at: 'asc' }, select: { toStatus: true, at: true } },
    driver: { select: { lastLat: true, lastLng: true, user: { select: { name: true } } } } } });
  if (!o) throw E.notFound('الطلب');
  const showDriver = ['DRIVER_GOING_TO_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION'].includes(o.status);
  const round = (n: number) => Math.round(n * 1000) / 1000; // ~100m precision for stops
  res.json({
    brand: 'مشاوير', code: o.code, status: o.status, statusAr: STATUS_MESSAGES_AR[o.status],
    timeline: o.history.map((h) => ({ status: h.toStatus, statusAr: STATUS_MESSAGES_AR[h.toStatus], at: h.at })),
    destination: o.stops.filter((s) => s.type === 'DROPOFF').map((s) => ({ lat: round(s.lat), lng: round(s.lng) })),
    driver: showDriver && o.driver ? { firstName: o.driver.user.name?.split(' ')[0], lat: o.driver.lastLat, lng: o.driver.lastLng } : null,
  });
}));
