import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config.ts';
import { prisma } from '../lib/db.ts';
import { E } from '../lib/errors.ts';

export interface AuthUser { id: string; roles: string[]; perms: Set<string>; driverId?: string; businessIds: string[] }
declare global { namespace Express { interface Request { user?: AuthUser } } }

// Short cache of role->permissions to avoid a DB hit per request.
const cache = new Map<string, { at: number; u: AuthUser }>();

export async function loadAuthUser(userId: string): Promise<AuthUser> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.u;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, driver: true, businessUsers: true },
  });
  if (!u || u.status !== 'ACTIVE') throw E.unauthorized();
  const auth: AuthUser = {
    id: u.id,
    roles: u.roles.map((r) => r.role.code),
    perms: new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code))),
    driverId: u.driver?.id,
    businessIds: u.businessUsers.map((b) => b.businessId),
  };
  cache.set(userId, { at: Date.now(), u: auth });
  return auth;
}
export const invalidateAuthCache = (userId: string) => cache.delete(userId);

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw E.unauthorized();
    const payload = jwt.verify(h.slice(7), env.JWT_SECRET) as { sub: string };
    req.user = await loadAuthUser(payload.sub);
    next();
  } catch (e) { next(e instanceof Error && 'status' in e ? e : E.unauthorized()); }
}

export const can = (u: AuthUser | undefined, perm: string) => !!u && (u.roles.includes('SUPER_ADMIN') || u.perms.has(perm));

export const requirePerm = (...perms: string[]) => (req: Request, _res: Response, next: NextFunction) =>
  perms.every((p) => can(req.user, p)) ? next() : next(E.forbidden());

export const requireDriver = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.driverId ? next() : next(E.forbidden());
