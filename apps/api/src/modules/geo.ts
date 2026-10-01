import { haversineKm, type LatLng } from '@mashawir/domain';
import { prisma } from '../lib/db.ts';

const ORDER = ['AREA', 'VILLAGE', 'DISTRICT', 'CITY', 'GOVERNORATE'] as const;

/**
 * Resolves a GPS point to the deepest active admin-defined geo unit covering it, plus its ancestors.
 * Works for informal Egyptian addresses: the point is the truth, text description is for the driver.
 */
export async function resolvePoint(p: LatLng) {
  const units = await prisma.geoUnit.findMany({ where: { active: true, centerLat: { not: null }, radiusKm: { not: null } } });
  const covering = units.filter((u) => haversineKm(p, { lat: u.centerLat!, lng: u.centerLng! }) <= u.radiusKm!);
  covering.sort((a, b) => ORDER.indexOf(a.level as any) - ORDER.indexOf(b.level as any) ||
    haversineKm(p, { lat: a.centerLat!, lng: a.centerLng! }) - haversineKm(p, { lat: b.centerLat!, lng: b.centerLng! }));
  const deepest = covering[0];
  if (!deepest) return null;
  const chain = [deepest];
  let cur = deepest;
  while (cur.parentId) { const parent = units.find((u) => u.id === cur.parentId) ?? await prisma.geoUnit.findUnique({ where: { id: cur.parentId } }); if (!parent) break; chain.push(parent); cur = parent; }
  const pick = (lvl: string) => chain.find((c) => c.level === lvl);
  return {
    unit: deepest,
    governorateId: pick('GOVERNORATE')?.id ?? null,
    cityId: pick('CITY')?.id ?? null,
    areaId: (pick('AREA') ?? pick('VILLAGE') ?? pick('DISTRICT'))?.id ?? null,
    chain, extraFee: chain.reduce((s, c) => s + c.extraFee, 0),
    label: chain.map((c) => c.nameAr).join('، '),
  };
}
