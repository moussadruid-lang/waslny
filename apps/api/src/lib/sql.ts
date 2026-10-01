import { Prisma } from '@prisma/client';

export interface OrderFilters { from: Date; to: Date; geoUnitId?: string; businessId?: string; driverId?: string; statuses?: string[] }

export function parseRange(q: any, days = 30) {
  const to = q.to ? new Date(String(q.to)) : new Date();
  const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - days * 86400_000);
  if (Number.isNaN(+from) || Number.isNaN(+to) || from > to) throw Object.assign(new Error('bad range'), { status: 400 });
  return { from, to };
}

export function orderFilters(q: any, days = 30): OrderFilters {
  return { ...parseRange(q, days), geoUnitId: q.geoUnitId ? String(q.geoUnitId) : undefined, businessId: q.businessId ? String(q.businessId) : undefined,
    driverId: q.driverId ? String(q.driverId) : undefined, statuses: q.status ? String(q.status).split(',').filter(Boolean) : undefined };
}

/** SQL fragment (alias `o` = "Order") shared by dashboard + reports so every number is computed the same way, in the DB. */
export function orderWhereSql(f: OrderFilters, dateCol: 'createdAt' | 'deliveredAt' = 'createdAt') {
  const parts: Prisma.Sql[] = [Prisma.sql`o.${Prisma.raw(`"${dateCol}"`)} BETWEEN ${f.from} AND ${f.to}`];
  if (f.businessId) parts.push(Prisma.sql`o."businessId" = ${f.businessId}`);
  if (f.driverId) parts.push(Prisma.sql`o."driverId" = ${f.driverId}`);
  if (f.statuses?.length) parts.push(Prisma.sql`o.status::text = ANY(${f.statuses})`);
  if (f.geoUnitId) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrderStop" s WHERE s."orderId" = o.id AND (s."geoUnitId" = ${f.geoUnitId} OR s."cityId" = ${f.geoUnitId} OR s."governorateId" = ${f.geoUnitId}))`);
  return Prisma.join(parts, ' AND ');
}

export function orderWherePrisma(f: OrderFilters): Prisma.OrderWhereInput {
  return {
    createdAt: { gte: f.from, lte: f.to },
    ...(f.businessId ? { businessId: f.businessId } : {}), ...(f.driverId ? { driverId: f.driverId } : {}),
    ...(f.statuses?.length ? { status: { in: f.statuses as any } } : {}),
    ...(f.geoUnitId ? { stops: { some: { OR: [{ geoUnitId: f.geoUnitId }, { cityId: f.geoUnitId }, { governorateId: f.geoUnitId }] } } } : {}),
  };
}

/** BigInt → Number for JSON. */
export const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

export function paging(q: any, max = 100) {
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), max);
  const page = Math.max(Number(q.page) || 1, 1);
  return { take: limit, skip: (page - 1) * limit, page, limit };
}
