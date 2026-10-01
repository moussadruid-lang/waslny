import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, resolveRule, computeCouponDiscount, NoPricingRuleError } from '../src/pricing.ts';
import { egp } from '../src/money.ts';
import { baseRule } from './fixtures.ts';

const medium = { code: 'MEDIUM', fee: egp(5), multiplierBp: 10000 };

test('most specific rule wins', () => {
  const rules = [baseRule(), baseRule({ id: 'kfs', governorateId: 'KFS' }), baseRule({ id: 'kfs-car', governorateId: 'KFS', vehicleTypeCode: 'CAR' })];
  assert.equal(resolveRule(rules, { governorateId: 'KFS', vehicleTypeCode: 'CAR' }).id, 'kfs-car');
  assert.equal(resolveRule(rules, { governorateId: 'KFS', vehicleTypeCode: 'MOTORCYCLE' }).id, 'kfs');
  assert.equal(resolveRule(rules, { governorateId: 'CAI', vehicleTypeCode: 'CAR' }).id, 'global');
});

test('inactive rules ignored, no match throws', () => {
  assert.throws(() => resolveRule([baseRule({ active: false })], { vehicleTypeCode: 'CAR' }), NoPricingRuleError);
});

test('full quote breakdown', () => {
  const q = quote([baseRule()], { distanceKm: 10, vehicleTypeCode: 'MOTORCYCLE', packageSize: medium, weightKg: 7, urgent: true, scheduled: false, extraStops: 1 });
  // 25 base + 8km*5=40 + 5 size + 2kg*2=4 + 20 urgent + 10 stop = 104
  assert.equal(q.subtotal, egp(104));
  assert.equal(q.total, egp(104));
});

test('minimum fare applied', () => {
  const q = quote([baseRule({ minimumFare: egp(40) })], { distanceKm: 1, vehicleTypeCode: 'MOTORCYCLE', packageSize: { code: 'DOC', fee: 0, multiplierBp: 10000 }, weightKg: 0.2, urgent: false, scheduled: false, extraStops: 0 });
  assert.equal(q.total, egp(40));
  assert.ok(q.lines.some((l) => l.code === 'MIN_FARE_ADJ'));
});

test('coupons: percent with cap, min order, fixed never exceeds subtotal', () => {
  assert.equal(computeCouponDiscount(egp(150), { code: 'A', type: 'PERCENT', value: 20, maxDiscount: egp(25) }), egp(25));
  assert.equal(computeCouponDiscount(egp(50), { code: 'B', type: 'PERCENT', value: 20, minOrder: egp(100) }), 0);
  assert.equal(computeCouponDiscount(egp(10), { code: 'C', type: 'FIXED', value: egp(50) }), egp(10));
});
