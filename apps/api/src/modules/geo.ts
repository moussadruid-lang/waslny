import { haversineKm, type LatLng } from '@mashawir/domain';
import type { GeoUnit } from '@prisma/client';
import { prisma } from '../lib/db.ts';

const ORDER = ['AREA', 'VILLAGE', 'DISTRICT', 'CITY', 'GOVERNORATE'] as const;

/** Ray casting on a GeoJSON Polygon ([lng, lat] rings; holes supported). */
export function inPolygon(p: LatLng, poly: any): boolean {
  const rings: number[][][] = poly?.type === 'Polygon' ? poly.coordinates : poly?.type === 'MultiPolygon' ? poly.coordinates.flat() : [];
  if (!rings.length) return false;
  const inside = (ring: number[][]) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return inside(rings[0]) && !rings.slice(1).some(inside);
}

export function isValidPolygon(poly: any) {
  if (poly?.type !== 'Polygon' || !Array.isArray(poly.coordinates) || !poly.coordinates.length) return false;
  return poly.coordinates.every((ring: any) => Array.isArray(ring) && ring.length >= 4 && ring.every((pt: any) => Array.isArray(pt) && pt.length === 2 && pt[0] >= 24 && pt[0] <= 37 && pt[1] >= 21 && pt[1] <= 32));
}

export const loadActiveUnits = () => prisma.geoUnit.findMany({ where: { active: true } });

const covers = (u: GeoUnit, p: LatLng) => (u.polygon ? inPolygon(p, u.polygon)
  : u.centerLat != null && u.centerLng != null && u.radiusKm != null && haversineKm(p, { lat: u.centerLat, lng: u.centerLng }) <= u.radiusKm);

/**
 * Resolves a GPS point to the deepest active admin-defined geo unit covering it (polygon if set, otherwise
 * center+radius), plus its ancestors. Works for informal Egyptian addresses: the point is the truth.
 * Pass `units` to reuse one query across many points (bulk uploads).
 */
export async function resolvePoint(p: LatLng, units?: GeoUnit[]) {
  const all = units ?? await loadActiveUnits();
  const covering = all.filter((u) => covers(u, p));
  const dist = (u: GeoUnit) => (u.centerLat != null ? haversineKm(p, { lat: u.centerLat, lng: u.centerLng! }) : 0);
  covering.sort((a, b) => ORDER.indexOf(a.level as any) - ORDER.indexOf(b.level as any) || dist(a) - dist(b));
  const deepest = covering[0];
  if (!deepest) return null;
  const chain = [deepest];
  let cur = deepest;
  while (cur.parentId) {
    const parent = all.find((u) => u.id === cur.parentId) ?? await prisma.geoUnit.findUnique({ where: { id: cur.parentId } });
    if (!parent) break;
    // A deactivated ancestor switches the whole subtree off.
    if (!parent.active) return null;
    chain.push(parent); cur = parent;
  }
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

/** Arabic-insensitive name matching for spreadsheets (أ/إ/آ→ا, ة→ه, ى→ي, no tashkeel, no leading ال). */
export function normAr(s: string) {
  return s.trim().toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '').replace(/\s+/g, ' ');
}
