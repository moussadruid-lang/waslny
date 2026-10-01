import { estimateRoadKm, type LatLng } from '@mashawir/domain';
import { env } from '../config.ts';
import { logger } from '../lib/logger.ts';

/** Maps provider abstraction: swap providers via MAPS_PROVIDER env without rebuilding apps. */
export interface RouteResult { distanceKm: number; durationMin: number; polyline?: string }

export async function route(a: LatLng, b: LatLng): Promise<RouteResult> {
  try {
    if (env.MAPS_PROVIDER === 'osrm' && env.OSRM_URL) {
      const r = await fetch(`${env.OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified`);
      const j: any = await r.json();
      if (j.code === 'Ok') return { distanceKm: j.routes[0].distance / 1000, durationMin: Math.ceil(j.routes[0].duration / 60), polyline: j.routes[0].geometry };
    }
    if (env.MAPS_PROVIDER === 'google' && env.MAPS_API_KEY) {
      const r = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${a.lat},${a.lng}&destinations=${b.lat},${b.lng}&key=${env.MAPS_API_KEY}&region=eg`);
      const el: any = (await r.json()).rows?.[0]?.elements?.[0];
      if (el?.status === 'OK') return { distanceKm: el.distance.value / 1000, durationMin: Math.ceil(el.duration.value / 60) };
    }
  } catch (err) { logger.warn({ err }, 'maps provider failed, falling back'); }
  const km = estimateRoadKm(a, b);
  return { distanceKm: km, durationMin: Math.ceil((km / 30) * 60) };
}
