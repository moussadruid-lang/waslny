import { Router } from 'express';
import { prisma } from '../lib/db.ts';
import { ah } from '../lib/errors.ts';
import { requirePerm } from '../middleware/auth.ts';

export const reportsRouter = Router();
const range = (q: any) => ({ from: q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400_000), to: q.to ? new Date(q.to) : new Date() });
const num = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

reportsRouter.get('/overview', requirePerm('reports.read'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const [byStatus, money, comm, timings, peakHours, topAreas] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: from, lte: to } }, _count: true }),
    prisma.order.aggregate({ where: { status: 'DELIVERED', deliveredAt: { gte: from, lte: to } }, _sum: { total: true, discount: true }, _avg: { total: true } }),
    prisma.commission.aggregate({ where: { createdAt: { gte: from, lte: to } }, _sum: { commission: true, driverEarning: true } }),
    prisma.$queryRaw<{ avg_accept_min: number; avg_delivery_min: number }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (a.at - o."createdAt"))/60)::float AS avg_accept_min,
             AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt"))/60)::float AS avg_delivery_min
      FROM "Order" o LEFT JOIN "OrderStatusHistory" a ON a."orderId" = o.id AND a."toStatus" = 'DRIVER_ASSIGNED'
      WHERE o."createdAt" BETWEEN ${from} AND ${to}`,
    prisma.$queryRaw<{ hour: number; orders: bigint }[]>`
      SELECT EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'Africa/Cairo'))::int AS hour, COUNT(*) AS orders
      FROM "Order" WHERE "createdAt" BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ geo: string; name: string; orders: bigint; avg_price: number }[]>`
      SELECT s."geoUnitId" AS geo, g."nameAr" AS name, COUNT(*) AS orders, AVG(o.total)::float AS avg_price
      FROM "OrderStop" s JOIN "Order" o ON o.id = s."orderId" LEFT JOIN "GeoUnit" g ON g.id = s."geoUnitId"
      WHERE s.seq = 0 AND o."createdAt" BETWEEN ${from} AND ${to} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`,
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const total = byStatus.reduce((s, b) => s + b._count, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  res.json({
    totalOrders: total, delivered: count('DELIVERED'), cancelled: count('CANCELLED'), failed: count('FAILED_DELIVERY'), returned: count('RETURNED'),
    deliveryRate: pct(count('DELIVERED')), cancelRate: pct(count('CANCELLED')), returnRate: pct(count('RETURNED')),
    revenue: money._sum.total ?? 0, discounts: money._sum.discount ?? 0, avgOrderValue: Math.round(money._avg.total ?? 0),
    commission: comm._sum.commission ?? 0, driverEarnings: comm._sum.driverEarning ?? 0,
    platformNet: (comm._sum.commission ?? 0) - (money._sum.discount ?? 0),
    avgAcceptMinutes: timings[0]?.avg_accept_min ?? null, avgDeliveryMinutes: timings[0]?.avg_delivery_min ?? null,
    peakHours: peakHours.map(num), topAreas: topAreas.map(num),
  });
}));

reportsRouter.get('/drivers', requirePerm('reports.read'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT d.id, u.name, d.rating,
      COUNT(o.id) FILTER (WHERE o.status='DELIVERED') AS delivered,
      COUNT(o.id) FILTER (WHERE o.status='CANCELLED') AS cancelled,
      COUNT(o.id) FILTER (WHERE o.status IN ('FAILED_DELIVERY','RETURNED','RETURNING')) AS failed,
      COALESCE(SUM(c."driverEarning"),0)::int AS earnings, COALESCE(SUM(c.commission),0)::int AS commission,
      AVG(EXTRACT(EPOCH FROM (o."deliveredAt"-o."createdAt"))/60)::float AS avg_delivery_min
    FROM "Driver" d JOIN "User" u ON u.id=d."userId"
    LEFT JOIN "Order" o ON o."driverId"=d.id AND o."createdAt" BETWEEN ${from} AND ${to}
    LEFT JOIN "Commission" c ON c."orderId"=o.id
    GROUP BY d.id, u.name, d.rating ORDER BY delivered DESC LIMIT 200`;
  res.json(rows.map(num));
}));

reportsRouter.get('/areas', requirePerm('reports.read'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT g.id, g."nameAr" AS name, g.level, COUNT(o.id) AS orders, AVG(o.total)::float AS avg_price,
      (SELECT COUNT(*) FROM "Driver" d WHERE g.id = ANY(d."serviceAreaIds")) AS drivers,
      MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM (o."createdAt" AT TIME ZONE 'Africa/Cairo'))) AS peak_hour
    FROM "GeoUnit" g LEFT JOIN "OrderStop" s ON s."geoUnitId"=g.id AND s.seq=0
    LEFT JOIN "Order" o ON o.id=s."orderId" AND o."createdAt" BETWEEN ${from} AND ${to}
    GROUP BY g.id ORDER BY orders DESC`;
  res.json(rows.map(num));
}));
