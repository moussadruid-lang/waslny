import type { Tx } from './db.ts';
export function audit(tx: Tx, p: { actorId?: string; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown; ip?: string }) {
  return tx.auditLog.create({ data: { ...p, before: p.before as any, after: p.after as any } });
}
