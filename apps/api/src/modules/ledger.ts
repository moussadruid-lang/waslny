import type { Tx } from '../lib/db.ts';
import { E } from '../lib/errors.ts';

export const PLATFORM_ID = 'platform';
type OwnerType = 'CUSTOMER' | 'DRIVER' | 'BUSINESS' | 'PLATFORM';

export async function getOrCreateWallet(tx: Tx, ownerType: OwnerType, ownerId: string) {
  return tx.wallet.upsert({ where: { ownerType_ownerId: { ownerType, ownerId } }, update: {}, create: { ownerType, ownerId } });
}

/**
 * Posts a signed transaction and updates the cached balance atomically (row-level increment).
 * idempotencyKey prevents double-posting on retries (e.g. offline sync, webhook replays).
 */
export async function post(tx: Tx, p: { ownerType: OwnerType; ownerId: string; type: string; amount: number; orderId?: string; settlementId?: string; createdById?: string; note?: string; idempotencyKey?: string; allowNegative?: boolean }) {
  if (!Number.isInteger(p.amount)) throw new Error('amount must be integer piasters');
  if (p.idempotencyKey) {
    const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (existing) return existing;
  }
  const w = await getOrCreateWallet(tx, p.ownerType, p.ownerId);
  const updated = await tx.wallet.update({ where: { id: w.id }, data: { balance: { increment: p.amount } } });
  const negativeOk = p.allowNegative ?? (p.ownerType === 'DRIVER' || p.ownerType === 'PLATFORM');
  if (!negativeOk && updated.balance < 0) throw E.bad('INSUFFICIENT_BALANCE', 'رصيد المحفظة غير كافٍ');
  return tx.walletTransaction.create({
    data: { walletId: w.id, type: p.type, amount: p.amount, balanceAfter: updated.balance, orderId: p.orderId, settlementId: p.settlementId,
      createdById: p.createdById, note: p.note, idempotencyKey: p.idempotencyKey },
  });
}
