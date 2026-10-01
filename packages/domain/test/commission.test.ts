import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommission, settlementEntries } from '../src/commission.ts';
import { egp } from '../src/money.ts';

const tenPct = { type: 'PERCENT' as const, percent: 10, fixed: 0 };

test('150 EGP order -> 15 commission, 135 driver', () => {
  assert.deepEqual(computeCommission(egp(150), tenPct), { commission: egp(15), driverEarning: egp(135) });
});

test('min/max clamp', () => {
  assert.equal(computeCommission(egp(20), { ...tenPct, min: egp(5) }).commission, egp(5));
  assert.equal(computeCommission(egp(1000), { ...tenPct, max: egp(50) }).commission, egp(50));
});

test('COD settlement: driver owes platform exactly the commission', () => {
  const s = settlementEntries({ method: 'CASH', fee: egp(150), discount: 0, codAmount: 0, rule: tenPct, hasBusiness: false });
  const driverNet = s.entries.filter((e) => e.wallet === 'DRIVER').reduce((a, e) => a + e.amount, 0);
  assert.equal(driverNet, -egp(15));
  assert.equal(s.entries.find((e) => e.type === 'COMMISSION')!.amount, egp(15));
});

test('wallet payment: customer debited, driver credited earning', () => {
  const s = settlementEntries({ method: 'WALLET', fee: egp(150), discount: 0, codAmount: 0, rule: tenPct, hasBusiness: false });
  assert.equal(s.entries.find((e) => e.wallet === 'CUSTOMER')!.amount, -egp(150));
  assert.equal(s.entries.find((e) => e.type === 'DELIVERY_EARNING')!.amount, egp(135));
});
