import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config.ts';

export const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const q = (name: string, opts: Record<string, unknown> = {}) => new Queue(name, { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, ...opts } });
export const queues = {
  dispatch: q('dispatch'), // offer waves + expansion
  push: q('push'),
  sms: q('sms'),
  webhooks: q('webhooks', { attempts: 6, backoff: { type: 'exponential', delay: 5000 } }), // fan-out + per-hook deliveries
  bulk: q('bulk-orders', { attempts: 1 }),
  scheduled: q('scheduled-orders'),
  broadcast: q('broadcast', { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }), // admin notifications to segments
};
