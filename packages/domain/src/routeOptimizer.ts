import { haversineKm, type LatLng } from './geo.ts';

export interface Stop { id: string; orderId: string; type: 'PICKUP' | 'DROPOFF'; location: LatLng }

/**
 * Orders stops for a driver carrying multiple orders.
 * Constraint: an order's DROPOFF can't come before its PICKUP (unless already picked up).
 * Greedy nearest-feasible + 2-opt-style improvement that respects precedence.
 */
export function optimizeStops(start: LatLng, stops: Stop[], alreadyPicked: Set<string> = new Set()): Stop[] {
  const remaining = [...stops];
  const picked = new Set(alreadyPicked);
  const route: Stop[] = [];
  let cur = start;
  while (remaining.length) {
    const feasible = remaining.filter((s) => s.type === 'PICKUP' || picked.has(s.orderId));
    feasible.sort((a, b) => haversineKm(cur, a.location) - haversineKm(cur, b.location));
    const next = feasible[0];
    route.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    if (next.type === 'PICKUP') picked.add(next.orderId);
    cur = next.location;
  }
  return improve(start, route, alreadyPicked);
}

export function routeLength(start: LatLng, route: Stop[]): number {
  let d = 0; let cur = start;
  for (const s of route) { d += haversineKm(cur, s.location); cur = s.location; }
  return d;
}

function valid(route: Stop[], alreadyPicked: Set<string>): boolean {
  const picked = new Set(alreadyPicked);
  for (const s of route) {
    if (s.type === 'PICKUP') picked.add(s.orderId);
    else if (!picked.has(s.orderId)) return false;
  }
  return true;
}

function improve(start: LatLng, route: Stop[], alreadyPicked: Set<string>): Stop[] {
  let best = route; let bestLen = routeLength(start, route); let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (!valid(cand, alreadyPicked)) continue;
        const len = routeLength(start, cand);
        if (len + 1e-9 < bestLen) { best = cand; bestLen = len; improved = true; }
      }
    }
  }
  return best;
}
