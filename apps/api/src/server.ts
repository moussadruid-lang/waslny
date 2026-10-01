import http from 'node:http';
import IORedis from 'ioredis';
import { env } from './config.ts';
import { createApp } from './app.ts';
import { initRealtime } from './modules/realtime.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/db.ts';

const server = http.createServer(createApp());
initRealtime(server, new IORedis(env.REDIS_URL), new IORedis(env.REDIS_URL));
server.listen(env.PORT, () => logger.info(`مشاوير API on :${env.PORT} (${env.NODE_ENV})`));

const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
