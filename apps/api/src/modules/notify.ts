import { prisma } from '../lib/db.ts';
import { env } from '../config.ts';
import { logger } from '../lib/logger.ts';
import { queues } from '../jobs/queues.ts';

/** SMS provider is pluggable via env; console provider is blocked in production (see config.ts). */
export async function sendSms(phone: string, text: string) {
  if (env.SMS_PROVIDER === 'console') { logger.info({ to: phone.slice(-4) }, `[SMS] ${text}`); return; }
  await queues.sms.add('sms', { phone, text }, { attempts: 5, backoff: { type: 'exponential', delay: 2000 } });
}

/** Persists an in-app notification and enqueues the push (non-blocking). */
export async function notify(userId: string, n: { type: string; titleAr: string; bodyAr: string; deepLink?: string; data?: any }) {
  const row = await prisma.notification.create({ data: { userId, ...n } });
  await queues.push.add('push', { notificationId: row.id }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  return row;
}
