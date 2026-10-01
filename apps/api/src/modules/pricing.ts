import { quote, type LatLng, type Coupon as DCoupon } from '@mashawir/domain';
import { prisma } from '../lib/db.ts';
import { E } from '../lib/errors.ts';
import { resolvePoint } from './geo.ts';
import { route } from './maps.ts';

export interface QuoteRequest {
  pickup: LatLng; dropoffs: LatLng[]; vehicleTypeCode: string; packageSizeCode: string; weightKg: number;
  urgent: boolean; scheduledAt?: Date | null; couponCode?: string | null; userId: string;
}

/** Server-side source of truth for price. Client-sent prices are never trusted. */
export async function buildQuote(r: QuoteRequest) {
  const [rules, size, vehicle] = await Promise.all([
    prisma.pricingRule.findMany({ where: { active: true } }),
    prisma.packageSize.findFirst({ where: { code: r.packageSizeCode, active: true } }),
    prisma.vehicleType.findFirst({ where: { code: r.vehicleTypeCode, active: true } }),
  ]);
  if (!size) throw E.bad('BAD_PACKAGE', 'حجم الشحنة غير متاح');
  if (!vehicle) throw E.bad('BAD_VEHICLE', 'نوع المركبة غير متاح');
  if (r.weightKg > vehicle.maxKg || r.weightKg > size.maxKg || !vehicle.allowedSizes.includes(size.code)) throw E.bad('PACKAGE_TOO_BIG', 'الشحنة لا تناسب نوع المركبة المختار');

  const pickupGeo = await resolvePoint(r.pickup);
  if (!pickupGeo) throw E.bad('AREA_NOT_SERVED', 'منطقة الاستلام خارج نطاق الخدمة حاليًا');
  const dropGeos = await Promise.all(r.dropoffs.map(resolvePoint));
  if (dropGeos.some((g) => !g)) throw E.bad('AREA_NOT_SERVED', 'منطقة التسليم خارج نطاق الخدمة حاليًا');

  let distanceKm = 0; let durationMin = 0; let prev = r.pickup;
  for (const d of r.dropoffs) { const leg = await route(prev, d); distanceKm += leg.distanceKm; durationMin += leg.durationMin; prev = d; }

  let coupon: (DCoupon & { id: string }) | null = null;
  if (r.couponCode) coupon = await validateCoupon(r.couponCode, r.userId, pickupGeo.chain.map((c) => c.id));

  const surcharges = [pickupGeo, ...dropGeos].filter((g) => g!.extraFee).map((g) => ({ areaId: g!.unit.id, fee: g!.extraFee }));
  const q = quote(rules, {
    distanceKm, governorateId: pickupGeo.governorateId, cityId: pickupGeo.cityId, areaId: pickupGeo.areaId,
    vehicleTypeCode: vehicle.code, packageSize: size, weightKg: r.weightKg, urgent: r.urgent, scheduled: !!r.scheduledAt,
    extraStops: Math.max(0, r.dropoffs.length - 1), areaSurcharges: surcharges, coupon,
  });
  return { ...q, durationMin, couponId: coupon?.id ?? null, pickupGeo, dropGeos: dropGeos as NonNullable<typeof dropGeos[number]>[] };
}

async function validateCoupon(code: string, userId: string, geoIds: string[]) {
  const c = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  const now = new Date();
  const invalid = () => E.bad('COUPON_INVALID', 'كود الخصم غير صالح');
  if (!c || !c.active || (c.startsAt && c.startsAt > now) || (c.expiresAt && c.expiresAt < now)) throw invalid();
  if (c.maxUses != null && c.usedCount >= c.maxUses) throw E.bad('COUPON_EXHAUSTED', 'تم استنفاد كود الخصم');
  if (c.userIds.length && !c.userIds.includes(userId)) throw invalid();
  if (c.geoUnitIds.length && !c.geoUnitIds.some((g) => geoIds.includes(g))) throw E.bad('COUPON_AREA', 'كود الخصم غير متاح في هذه المنطقة');
  const used = await prisma.couponRedemption.count({ where: { couponId: c.id, userId } });
  if (used >= c.maxUsesPerUser) throw E.bad('COUPON_USED', 'استخدمت هذا الكود من قبل');
  return { id: c.id, code: c.code, type: c.type as 'PERCENT' | 'FIXED', value: c.value, maxDiscount: c.maxDiscount, minOrder: c.minOrder };
}
