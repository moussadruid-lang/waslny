import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';
import { isTokenShape, publicTrackingView } from './tracking.ts';

/** Public, unauthenticated endpoints. Strictly rate limited; never return PII or internal ids. */
export const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true }));

publicRouter.get('/track/:token', ah(async (req, res) => {
  if (!isTokenShape(req.params.token)) throw E.notFound('الطلب');
  res.set('Cache-Control', 'no-store');
  res.json(await publicTrackingView({ trackingToken: req.params.token }));
}));

/** Active service areas (names + levels only) — used by the merchant order form. */
publicRouter.get('/geo', ah(async (req, res) => {
  const parentId = req.query.parentId ? String(req.query.parentId) : null;
  res.json(await prisma.geoUnit.findMany({ where: { active: true, parentId }, select: { id: true, nameAr: true, level: true }, orderBy: { nameAr: 'asc' }, take: 500 }));
}));
