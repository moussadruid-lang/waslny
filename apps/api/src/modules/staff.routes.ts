import { Router } from 'express';
import { prisma } from '../lib/db.ts';
import { ah, E } from '../lib/errors.ts';

export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT'];

/** Who am I on the dashboard: staff roles + effective permissions, and the businesses I can act for. */
export const staffRouter = Router();
staffRouter.get('/me', ah(async (req, res) => {
  const u = req.user!;
  const user = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, name: true, phone: true, email: true,
    businessUsers: { select: { role: true, business: { select: { id: true, nameAr: true, status: true } } } } } });
  if (!user) throw E.unauthorized();
  const isSuper = u.roles.includes('SUPER_ADMIN');
  const isStaff = u.roles.some((r) => STAFF_ROLES.includes(r));
  res.json({
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email },
    roles: u.roles, isStaff, isSuper,
    perms: isSuper ? ['*'] : [...u.perms].sort(),
    businesses: user.businessUsers.map((b) => ({ id: b.business.id, nameAr: b.business.nameAr, status: b.business.status, role: b.role })),
  });
}));
