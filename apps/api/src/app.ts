import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config.ts';
import { logger } from './lib/logger.ts';
import { errorHandler } from './lib/errors.ts';
import { prisma } from './lib/db.ts';
import { authenticate, requireDriver } from './middleware/auth.ts';
import { authRouter } from './modules/auth.ts';
import { customerRouter, chatRouter, supportRouter } from './modules/customer.routes.ts';
import { driverRouter } from './modules/driver.routes.ts';
import { adminRouter } from './modules/admin.routes.ts';
import { reportsRouter } from './modules/reports.routes.ts';
import { businessRouter, businessApiRouter } from './modules/business.routes.ts';
import { publicRouter } from './modules/public.routes.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info') }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true }));

  app.get('/health', async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true, app: 'مشاوير' }); });
  app.use('/v1/auth', authRouter);
  app.use('/v1/public', publicRouter);
  app.use('/v1/business-api', businessApiRouter);
  app.use('/v1', authenticate);
  app.use('/v1/customer', customerRouter);
  app.use('/v1/chat', chatRouter);
  app.use('/v1/support', supportRouter);
  app.use('/v1/driver', requireDriver, driverRouter);
  app.use('/v1/business', businessRouter);
  app.use('/v1/admin', adminRouter);
  app.use('/v1/reports', reportsRouter);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'الصفحة غير موجودة' } }));
  app.use(errorHandler);
  return app;
}
