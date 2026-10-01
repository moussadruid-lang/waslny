import type { Piasters } from './money.ts';

/** A pricing rule row loaded from DB. Null scope fields = wildcard. Most specific active rule wins. */
export interface PricingRule {
  id: string;
  active: boolean;
  priority: number; // tie-breaker
  governorateId?: string | null;
  cityId?: string | null;
  areaId?: string | null;
  vehicleTypeCode?: string | null;
  baseFare: Piasters;
  perKm: Piasters;
  includedKm: number; // km covered by base fare
  minimumFare: Piasters;
  perKgOverIncluded: Piasters;
  includedKg: number;
  urgentFee: Piasters;
  scheduledFee: Piasters;
  extraStopFee: Piasters;
  waitingPerMinute: Piasters;
  freeWaitingMinutes: number;
  returnFeePercent: number; // % of delivery fee charged on return
}

export interface PackageSizeFee { code: string; fee: Piasters; multiplierBp: number } // basis points, 10000 = 1x
export interface AreaSurcharge { areaId: string; fee: Piasters }

export interface Coupon {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number; // percent (0-100) or piasters
  maxDiscount?: Piasters | null;
  minOrder?: Piasters | null;
}

export interface QuoteInput {
  distanceKm: number;
  governorateId?: string | null;
  cityId?: string | null;
  areaId?: string | null; // pickup area
  dropoffAreaId?: string | null;
  vehicleTypeCode: string;
  packageSize: PackageSizeFee;
  weightKg: number;
  urgent: boolean;
  scheduled: boolean;
  extraStops: number;
  waitingMinutes?: number;
  areaSurcharges?: AreaSurcharge[];
  coupon?: Coupon | null;
}

export interface QuoteLine { code: string; labelAr: string; amount: Piasters }
export interface Quote {
  ruleId: string;
  distanceKm: number;
  lines: QuoteLine[];
  subtotal: Piasters;
  discount: Piasters;
  total: Piasters;
}

export class NoPricingRuleError extends Error {
  constructor() { super('No active pricing rule matches this order'); }
}

function specificity(r: PricingRule): number {
  return (r.areaId ? 8 : 0) + (r.cityId ? 4 : 0) + (r.governorateId ? 2 : 0) + (r.vehicleTypeCode ? 1 : 0);
}

export function resolveRule(rules: PricingRule[], q: Pick<QuoteInput, 'governorateId' | 'cityId' | 'areaId' | 'vehicleTypeCode'>): PricingRule {
  const matches = rules.filter((r) =>
    r.active &&
    (!r.governorateId || r.governorateId === q.governorateId) &&
    (!r.cityId || r.cityId === q.cityId) &&
    (!r.areaId || r.areaId === q.areaId) &&
    (!r.vehicleTypeCode || r.vehicleTypeCode === q.vehicleTypeCode));
  if (!matches.length) throw new NoPricingRuleError();
  matches.sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority);
  return matches[0];
}

export function computeCouponDiscount(subtotal: Piasters, c: Coupon | null | undefined): Piasters {
  if (!c) return 0;
  if (c.minOrder && subtotal < c.minOrder) return 0;
  let d = c.type === 'PERCENT' ? Math.round((subtotal * c.value) / 100) : c.value;
  if (c.maxDiscount != null) d = Math.min(d, c.maxDiscount);
  return Math.max(0, Math.min(d, subtotal));
}

export function quote(rules: PricingRule[], input: QuoteInput): Quote {
  if (!(input.distanceKm >= 0)) throw new Error('Invalid distance');
  const r = resolveRule(rules, input);
  const lines: QuoteLine[] = [];
  const add = (code: string, labelAr: string, amount: Piasters) => { if (amount) lines.push({ code, labelAr, amount: Math.round(amount) }); };

  const km = Math.round(input.distanceKm * 10) / 10;
  add('BASE', 'سعر البداية', r.baseFare);
  add('DISTANCE', `المسافة (${km} كم)`, Math.max(0, km - r.includedKm) * r.perKm);

  const sizeMult = input.packageSize.multiplierBp / 10000;
  if (sizeMult !== 1) {
    const core = lines.reduce((s, l) => s + l.amount, 0);
    add('SIZE_MULT', 'حجم الشحنة', core * (sizeMult - 1));
  }
  add('SIZE_FEE', 'رسوم حجم الشحنة', input.packageSize.fee);
  add('WEIGHT', 'رسوم الوزن', Math.max(0, Math.ceil(input.weightKg - r.includedKg)) * r.perKgOverIncluded);
  for (const s of input.areaSurcharges ?? []) add('AREA', 'رسوم المنطقة', s.fee);
  if (input.urgent) add('URGENT', 'طلب عاجل', r.urgentFee);
  if (input.scheduled) add('SCHEDULED', 'طلب مجدول', r.scheduledFee);
  add('EXTRA_STOPS', `توقفات إضافية (${input.extraStops})`, input.extraStops * r.extraStopFee);
  add('WAITING', 'رسوم الانتظار', Math.max(0, (input.waitingMinutes ?? 0) - r.freeWaitingMinutes) * r.waitingPerMinute);

  let subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (subtotal < r.minimumFare) {
    add('MIN_FARE_ADJ', 'تسوية الحد الأدنى', r.minimumFare - subtotal);
    subtotal = r.minimumFare;
  }
  const discount = computeCouponDiscount(subtotal, input.coupon);
  return { ruleId: r.id, distanceKm: km, lines, subtotal, discount, total: subtotal - discount };
}

export function returnFee(deliveryFee: Piasters, rule: Pick<PricingRule, 'returnFeePercent'>): Piasters {
  return Math.round((deliveryFee * rule.returnFeePercent) / 100);
}
