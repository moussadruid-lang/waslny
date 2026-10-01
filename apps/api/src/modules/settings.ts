import { prisma } from '../lib/db.ts';

/** Typed defaults; admin overrides persist in the Setting table (all changes audited). */
export const DEFAULTS = {
  dispatch: { radiiKm: [3, 6, 10, 20], waveSize: 5, offerTimeoutSec: 30, maxActiveOrdersPerDriver: 1, maxLocationAgeSec: 120,
    weights: { distance: 1, rating: 0.3, acceptance: 0.2, load: 0.5 }, scheduledLeadMinutes: 30, giveUpAfterWaves: 4 },
  delivery_proof: { requireOtp: true, requirePhoto: false, requireSignature: false, requireRecipientName: false, maxDistanceMeters: 500 },
  platform: { pauseOrders: false, pauseMessageAr: '', timezone: 'Africa/Cairo', supportPhone: '' },
  referral: { referrerReward: 2000, refereeReward: 1000, minCompletedOrders: 1 },
};
type Defaults = typeof DEFAULTS;

const cache = new Map<string, { at: number; v: any }>();
export async function getSetting<K extends keyof Defaults>(key: K): Promise<Defaults[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  const row = await prisma.setting.findUnique({ where: { key } });
  const v = { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as Defaults[K];
  cache.set(key, { at: Date.now(), v });
  return v;
}
export const clearSettingsCache = () => cache.clear();
