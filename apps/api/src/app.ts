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
import { uploadsRouter } from './modules/uploads.ts';
import { customerExtraRouter, driverExtraRouter } from './modules/mobile.extra.routes.ts';
import { staffRouter } from './modules/staff.routes.ts';

export function createApp() {
  const app = express(); app.set('trust proxy', 1); app.use(helmet()); app.use(cors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }));
  app.use('/v1/uploads', express.json({ limit: '8mb' })); app.use(['/v1/business/bulk', '/v1/business-api/bulk'], express.json({ limit: '6mb' })); app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'), redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'] })); app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true }));
  app.get('/health', async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true, app: 'مشاوير' }); }); app.use('/files', helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }), express.static(env.UPLOAD_DIR, { index: false, dotfiles: 'deny', maxAge: '7d' }));
  app.use('/v1/auth', authRouter); app.use('/v1/public', publicRouter); app.use('/v1/business-api', businessApiRouter); app.use('/v1', authenticate); app.use('/v1/staff', staffRouter); app.use('/v1/uploads', rateLimit({ windowMs: 60_000, limit: 30 }), uploadsRouter); app.use('/v1/customer', customerExtraRouter); app.use('/v1/customer', customerRouter); app.use('/v1/chat', chatRouter); app.use('/v1/support', supportRouter); app.use('/v1/driver', driverExtraRouter); app.use('/v1/driver', requireDriver, driverRouter); app.use('/v1/business', businessRouter); app.use('/v1/admin', adminRouter); app.use('/v1/reports', reportsRouter);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'الصفحة غير موجودة' } })); app.use(errorHandler); return app;
}
