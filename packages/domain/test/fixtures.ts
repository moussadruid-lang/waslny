import type { PricingRule } from '../src/pricing.ts';
import { egp } from '../src/money.ts';
export const DAMRO = { lat: 31.205, lng: 30.842 };      // approx, verify in admin
export const SIDI_SALEM = { lat: 31.2692, lng: 30.7869 }; // approx
export const baseRule = (o: Partial<PricingRule> = {}): PricingRule => ({
  id: 'global', active: true, priority: 0, baseFare: egp(25), perKm: egp(5), includedKm: 2,
  minimumFare: egp(30), perKgOverIncluded: egp(2), includedKg: 5, urgentFee: egp(20), scheduledFee: egp(5),
  extraStopFee: egp(10), waitingPerMinute: egp(1), freeWaitingMinutes: 10, returnFeePercent: 50, ...o,
});
