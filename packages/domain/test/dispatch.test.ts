import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWave, type DriverCandidate, type DispatchSettings } from '../src/dispatch.ts';
import { optimizeStops, routeLength } from '../src/routeOptimizer.ts';
import { DAMRO, SIDI_SALEM } from './fixtures.ts';

const s: DispatchSettings = { radiiKm: [3, 8, 20], waveSize: 2, maxActiveOrdersPerDriver: 1, maxLocationAgeSec: 120,
  allowedVehicleCodes: ['MOTORCYCLE', 'CAR'], weights: { distance: 1, rating: 0.3, acceptance: 0.2, load: 0.5 } };
const d = (id: string, lat: number, lng: number, o: Partial<DriverCandidate> = {}): DriverCandidate => ({ id, status: 'APPROVED', online: true,
  activeOrders: 0, location: { lat, lng }, locationAgeSec: 10, vehicleTypeCode: 'MOTORCYCLE', vehicleMaxKg: 20, serviceAreaIds: [], rating: 4.8, acceptanceRate: 0.9, ...o });

test('only approved, online, free, fresh drivers are offered; nearest first', () => {
  const drivers = [d('near', DAMRO.lat + 0.005, DAMRO.lng), d('far', DAMRO.lat + 0.02, DAMRO.lng), d('offline', DAMRO.lat, DAMRO.lng, { online: false }),
    d('busy', DAMRO.lat, DAMRO.lng, { activeOrders: 1 }), d('pending', DAMRO.lat, DAMRO.lng, { status: 'PENDING' }), d('stale', DAMRO.lat, DAMRO.lng, { locationAgeSec: 999 })];
  const w0 = selectWave(drivers, { pickup: DAMRO, weightKg: 2 }, s, 0, new Set());
  assert.deepEqual(w0.map((x) => x.driverId), ['near', 'far']);
});

test('wave expands radius and skips already-offered drivers', () => {
  const drivers = [d('a', DAMRO.lat + 0.005, DAMRO.lng), d('b', DAMRO.lat + 0.06, DAMRO.lng)]; // b ~6.7km
  assert.deepEqual(selectWave(drivers, { pickup: DAMRO, weightKg: 1 }, s, 0, new Set()).map((x) => x.driverId), ['a']);
  assert.deepEqual(selectWave(drivers, { pickup: DAMRO, weightKg: 1 }, s, 1, new Set(['a'])).map((x) => x.driverId), ['b']);
});

test('multi-stop: dropoff never before its pickup, route improves', () => {
  const stops = [
    { id: 'p1', orderId: '1', type: 'PICKUP' as const, location: DAMRO },
    { id: 'd1', orderId: '1', type: 'DROPOFF' as const, location: SIDI_SALEM },
    { id: 'p2', orderId: '2', type: 'PICKUP' as const, location: { lat: 31.24, lng: 30.81 } },
    { id: 'd2', orderId: '2', type: 'DROPOFF' as const, location: { lat: 31.11, lng: 30.94 } },
  ];
  const r = optimizeStops(DAMRO, stops);
  const idx = (id: string) => r.findIndex((x) => x.id === id);
  assert.ok(idx('p1') < idx('d1') && idx('p2') < idx('d2'));
  assert.ok(routeLength(DAMRO, r) <= routeLength(DAMRO, stops) + 1e-9);
});
