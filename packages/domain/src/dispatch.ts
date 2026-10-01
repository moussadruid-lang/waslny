import { haversineKm, type LatLng } from './geo.ts';

export interface DriverCandidate {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  online: boolean;
  activeOrders: number;
  location: LatLng | null;
  locationAgeSec: number;
  vehicleTypeCode: string;
  vehicleMaxKg: number;
  serviceAreaIds: string[]; // empty = serves everywhere
  rating: number; // 0-5
  acceptanceRate: number; // 0-1
}

export interface DispatchSettings {
  radiiKm: number[]; // expanding waves, e.g. [3, 6, 10, 20]
  waveSize: number;
  maxActiveOrdersPerDriver: number; // 1 = single order; >1 enables batching
  maxLocationAgeSec: number;
  allowedVehicleCodes: string[]; // vehicles able to carry this package
  weights: { distance: number; rating: number; acceptance: number; load: number };
}

export interface DispatchOrder { pickup: LatLng; pickupAreaId?: string | null; weightKg: number }

export function eligible(d: DriverCandidate, o: DispatchOrder, s: DispatchSettings): boolean {
  return d.status === 'APPROVED' && d.online && d.location !== null &&
    d.locationAgeSec <= s.maxLocationAgeSec &&
    d.activeOrders < s.maxActiveOrdersPerDriver &&
    s.allowedVehicleCodes.includes(d.vehicleTypeCode) &&
    d.vehicleMaxKg >= o.weightKg &&
    (d.serviceAreaIds.length === 0 || !o.pickupAreaId || d.serviceAreaIds.includes(o.pickupAreaId));
}

/** Lower score = better. */
export function score(d: DriverCandidate, o: DispatchOrder, s: DispatchSettings, radiusKm: number): number {
  const dist = haversineKm(d.location!, o.pickup) / radiusKm; // 0..1
  return s.weights.distance * dist +
    s.weights.rating * (1 - d.rating / 5) +
    s.weights.acceptance * (1 - d.acceptanceRate) +
    s.weights.load * (d.activeOrders / Math.max(1, s.maxActiveOrdersPerDriver));
}

/** Returns the drivers to offer the order to in wave `waveIndex` (excluding already-offered drivers). */
export function selectWave(drivers: DriverCandidate[], o: DispatchOrder, s: DispatchSettings, waveIndex: number, alreadyOffered: Set<string>) {
  const radius = s.radiiKm[Math.min(waveIndex, s.radiiKm.length - 1)];
  return drivers
    .filter((d) => !alreadyOffered.has(d.id) && eligible(d, o, s))
    .map((d) => ({ d, km: haversineKm(d.location!, o.pickup) }))
    .filter((x) => x.km <= radius)
    .sort((a, b) => score(a.d, o, s, radius) - score(b.d, o, s, radius))
    .slice(0, s.waveSize)
    .map((x) => ({ driverId: x.d.id, distanceKm: Math.round(x.km * 100) / 100 }));
}

export const isLastWave = (s: DispatchSettings, waveIndex: number) => waveIndex >= s.radiiKm.length - 1;
