import { Worker } from 'bullmq';
import crypto from 'node:crypto';
import { redis } from './queues.ts';
import { prisma } from '../lib/db.ts';
import { logger } from '../lib/logger.ts';
import { runWave } from '../modules/dispatch.service.ts';
import { startDispatch } from '../modules/orders.service.ts';
import { sendPush } from '../modules/push.ts';
import { processBulkUpload } from '../modules/bulk.ts';

const w = (name: string, fn: (data: any) => Promise<void>, concurrency = 10) =>
  new Worker(name, async (job) => fn(job.data), { connection: redis, concurrency })
    .on('failed', (job, err) => logger.error({ queue: name, jobId: job?.id, err: err.message }, 'job failed'));

w('dispatch', ({ orderId, wave }) => runWave(orderId, wave), 20);
w('scheduled-orders', async ({ orderId }) => {
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (o?.status === 'NEW') await startDispatch(orderId);
});
w('push', ({ notificationId }) => sendPush(notificationId), 20);
w('sms', async ({ phone, text }) => { /* plug provider SDK here (Cequens/Vonage/Twilio) based on SMS_PROVIDER */ logger.info({ to: String(phone).slice(-4), len: text.length }, 'sms sent'); });
w('bulk-orders', ({ uploadId, rows, userId, businessId }) => processBulkUpload(uploadId, rows, userId, businessId), 2);
w('webhooks', async ({ businessId, event, orderId }) => {
  const hooks = await prisma.webhook.findMany({ where: { businessId, active: true, events: { has: event } } });
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, status: true, updatedAt: true, total: true, codAmount: true } });
  for (const h of hooks) {
    const payload = { event, order, at: new Date().toISOString() };
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
    const d = await prisma.webhookDelivery.create({ data: { webhookId: h.id, event, payload: payload as any } });
    const r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mashawir-signature': sig }, body, signal: AbortSignal.timeout(10_000) });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { statusCode: r.status, attempts: { increment: 1 }, succeededAt: r.ok ? new Date() : null } });
    if (!r.ok) throw new Error(`webhook ${h.id} -> ${r.status}`); // BullMQ retries with backoff
  }
});
logger.info('مشاوير workers started');
