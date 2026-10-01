import { z } from 'zod';
import { prisma } from '../lib/db.ts';

/** Typed defaults; admin overrides persist in the Setting table (all changes audited). */
export const DEFAULTS = {
  dispatch: { radiiKm: [3, 6, 10, 20], waveSize: 5, offerTimeoutSec: 30, maxActiveOrdersPerDriver: 1, maxLocationAgeSec: 120,
    weights: { distance: 1, rating: 0.3, acceptance: 0.2, load: 0.5 }, scheduledLeadMinutes: 30, giveUpAfterWaves: 4 },
  delivery_proof: { requireOtp: true, requirePhoto: false, requireSignature: false, requireRecipientName: false, maxDistanceMeters: 500 },
  platform: { pauseOrders: false, pauseMessageAr: '', timezone: 'Africa/Cairo', supportPhone: '' },
  referral: { referrerReward: 2000, refereeReward: 1000, minCompletedOrders: 1 },
  tracking: { expireHoursAfterDone: 72, driverFreshSec: 180 },
  ops: { searchingAlertMinutes: 10, deliveryLateMinutes: 60 },
};
type Defaults = typeof DEFAULTS;

/** Every settings write is validated: a malformed value can never break dispatch or proof-of-delivery. */
export const SETTING_SCHEMAS: Record<keyof Defaults, z.ZodTypeAny> = {
  dispatch: z.object({ radiiKm: z.array(z.number().positive().max(200)).min(1).max(10), waveSize: z.number().int().min(1).max(50), offerTimeoutSec: z.number().int().min(10).max(300),
    maxActiveOrdersPerDriver: z.number().int().min(1).max(10), maxLocationAgeSec: z.number().int().min(30).max(3600),
    weights: z.object({ distance: z.number().min(0), rating: z.number().min(0), acceptance: z.number().min(0), load: z.number().min(0) }),
    scheduledLeadMinutes: z.number().int().min(5).max(240), giveUpAfterWaves: z.number().int().min(1).max(20) }).strict(),
  delivery_proof: z.object({ requireOtp: z.boolean(), requirePhoto: z.boolean(), requireSignature: z.boolean(), requireRecipientName: z.boolean(), maxDistanceMeters: z.number().int().min(0).max(5000).nullable() }).strict(),
  platform: z.object({ pauseOrders: z.boolean(), pauseMessageAr: z.string().max(200), timezone: z.literal('Africa/Cairo'), supportPhone: z.string().max(20) }).strict(),
  referral: z.object({ referrerReward: z.number().int().min(0).max(100_000), refereeReward: z.number().int().min(0).max(100_000), minCompletedOrders: z.number().int().min(1).max(20) }).strict(),
  tracking: z.object({ expireHoursAfterDone: z.number().int().min(1).max(24 * 30), driverFreshSec: z.number().int().min(30).max(1800) }).strict(),
  ops: z.object({ searchingAlertMinutes: z.number().int().min(1).max(240), deliveryLateMinutes: z.number().int().min(10).max(1440) }).strict(),
};

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
