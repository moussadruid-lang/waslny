import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config.ts';

export const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const q = (name: string) => new Queue(name, { connection: redis, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
export const queues = {
  dispatch: q('dispatch'), // offer waves + expansion
  push: q('push'),
  sms: q('sms'),
  webhooks: q('webhooks'),
  bulk: q('bulk-orders'),
  scheduled: q('scheduled-orders'),
};
