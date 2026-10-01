import type { Piasters } from './money.ts';

export interface CommissionRule {
  type: 'PERCENT' | 'FIXED' | 'PERCENT_PLUS_FIXED';
  percent: number; // 0-100
  fixed: Piasters;
  min?: Piasters | null;
  max?: Piasters | null;
}

export function computeCommission(deliveryFee: Piasters, rule: CommissionRule): { commission: Piasters; driverEarning: Piasters } {
  let c = 0;
  if (rule.type !== 'FIXED') c += Math.round((deliveryFee * rule.percent) / 100);
  if (rule.type !== 'PERCENT') c += rule.fixed;
  if (rule.min != null) c = Math.max(c, rule.min);
  if (rule.max != null) c = Math.min(c, rule.max);
  c = Math.max(0, Math.min(c, deliveryFee));
  return { commission: c, driverEarning: deliveryFee - c };
}

export type LedgerEntry = { wallet: 'CUSTOMER' | 'DRIVER' | 'PLATFORM'; type: string; amount: Piasters };

/**
 * Double-entry style settlement of a delivered order.
 * fee = what the customer pays for delivery (after discount). Platform absorbs coupon discounts.
 * COD: driver physically holds the cash, so his wallet is debited the cash and credited his earning.
 *      Negative driver balance = amount he owes the platform.
 * codAmount = goods value collected on behalf of a business (passed through to the merchant).
 */
export function settlementEntries(p: {
  method: 'CASH' | 'WALLET' | 'CARD';
  fee: Piasters; discount: Piasters; codAmount: Piasters; rule: CommissionRule; hasBusiness: boolean;
}): { entries: LedgerEntry[]; commission: Piasters; driverEarning: Piasters } {
  const gross = p.fee + p.discount; // commission computed on gross fee
  const { commission, driverEarning } = computeCommission(gross, p.rule);
  const e: LedgerEntry[] = [];
  if (p.method === 'CASH') {
    e.push({ wallet: 'DRIVER', type: 'COD_CASH_COLLECTED', amount: -(p.fee + p.codAmount) });
  } else {
    e.push({ wallet: 'CUSTOMER', type: 'ORDER_PAYMENT', amount: -p.fee });
    if (p.codAmount) e.push({ wallet: 'DRIVER', type: 'COD_CASH_COLLECTED', amount: -p.codAmount });
  }
  e.push({ wallet: 'DRIVER', type: 'DELIVERY_EARNING', amount: driverEarning });
  e.push({ wallet: 'PLATFORM', type: 'COMMISSION', amount: commission });
  if (p.discount) e.push({ wallet: 'PLATFORM', type: 'COUPON_SUBSIDY', amount: -p.discount });
  if (p.codAmount && p.hasBusiness) e.push({ wallet: 'PLATFORM', type: 'COD_PAYABLE_TO_BUSINESS', amount: 0 });
  return { entries: e, commission, driverEarning };
}
