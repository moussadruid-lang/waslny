export interface LatLng { lat: number; lng: number }

const R = 6371; // km

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance estimate when no routing provider is configured (straight line * detour factor). */
export function estimateRoadKm(a: LatLng, b: LatLng, detourFactor = 1.3): number {
  return haversineKm(a, b) * detourFactor;
}

export function etaMinutes(distanceKm: number, avgSpeedKmh: number): number {
  if (avgSpeedKmh <= 0) return Infinity;
  return Math.ceil((distanceKm / avgSpeedKmh) * 60);
}

/** Detects physically impossible jumps between two GPS fixes (anti-spoofing). */
export function isImpossibleJump(prev: LatLng & { at: number }, next: LatLng & { at: number }, maxKmh = 160): boolean {
  const hours = (next.at - prev.at) / 3_600_000;
  if (hours <= 0) return haversineKm(prev, next) > 0.05;
  return haversineKm(prev, next) / hours > maxKmh;
}
