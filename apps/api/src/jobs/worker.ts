import { Worker } from 'bullmq';
import { redis } from './queues.ts';
import { prisma } from '../lib/db.ts';
import { logger } from '../lib/logger.ts';
import { runWave } from '../modules/dispatch.service.ts';
import { startDispatch } from '../modules/orders.service.ts';
import { sendPush } from '../modules/push.ts';
import { processBulkUpload } from '../modules/bulk.ts';
import { deliverWebhook, fanOutWebhook } from '../modules/webhooks.ts';
import { runBroadcast } from '../modules/broadcast.ts';

const w = (name: string, fn: (data: any, jobName: string) => Promise<unknown>, concurrency = 10) =>
  new Worker(name, async (job) => fn(job.data, job.name), { connection: redis, concurrency })
    .on('failed', (job, err) => logger.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed'));

w('dispatch', ({ orderId, wave }) => runWave(orderId, wave), 20);
w('scheduled-orders', async ({ orderId }) => {
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (o?.status === 'NEW') await startDispatch(orderId);
});
w('push', ({ notificationId }) => sendPush(notificationId), 20);
w('sms', async ({ phone, text }) => { /* plug provider SDK here (Cequens/Vonage/Twilio) based on SMS_PROVIDER */ logger.info({ to: String(phone).slice(-4), len: text.length }, 'sms sent'); });
w('bulk-orders', ({ uploadId, rows, userId, businessId }) => processBulkUpload(uploadId, rows, userId, businessId), 2);
w('webhooks', (data, name) => (name === 'deliver' ? deliverWebhook(data.deliveryId) : fanOutWebhook(data.businessId, data.event, data.orderId)), 10);
w('broadcast', (data) => runBroadcast(data), 1);
logger.info('مشاوير workers started');
