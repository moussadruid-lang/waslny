import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.ts';
import { env, isProd } from '../config.ts';
import { ah, E } from '../lib/errors.ts';
import { authenticate } from '../middleware/auth.ts';
import { sendSms } from './notify.ts';

export const authRouter = Router();
const otpLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true });

// Egyptian mobile: 010/011/012/015 + 8 digits. Normalized to +20XXXXXXXXXX.
export const EgPhone = z.string().transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+20|0020|20)/, '0'))
  .refine((s) => /^01[0125]\d{8}$/.test(s), 'رقم موبايل مصري غير صحيح').transform((s) => '+2' + s);

const hash = (v: string) => crypto.createHmac('sha256', env.OTP_PEPPER).update(v).digest('hex');
const newReferral = () => 'MSH' + crypto.randomBytes(3).toString('hex').toUpperCase();

authRouter.post('/otp/request', otpLimiter, ah(async (req, res) => {
  const { phone } = z.object({ phone: EgPhone }).parse(req.body);
  const code = crypto.randomInt(100000, 1000000).toString();
  await prisma.otpCode.create({ data: { phone, codeHash: hash(phone + code), purpose: 'LOGIN', expiresAt: new Date(Date.now() + 5 * 60_000) } });
  await sendSms(phone, `كود الدخول إلى مشاوير: ${code}. لا تشاركه مع أحد.`);
  res.json({ ok: true, expiresInSec: 300, ...(isProd ? {} : { devCode: env.SMS_PROVIDER === 'console' ? code : undefined }) });
}));

authRouter.post('/otp/verify', otpLimiter, ah(async (req, res) => {
  const body = z.object({ phone: EgPhone, code: z.string().length(6), name: z.string().min(2).max(80).optional(), referralCode: z.string().optional(), asDriver: z.boolean().optional() }).parse(req.body);
  const otp = await prisma.otpCode.findFirst({ where: { phone: body.phone, purpose: 'LOGIN', usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!otp || otp.attempts >= 5) throw E.bad('OTP_INVALID', 'الكود غير صحيح أو منتهي');
  const ok = crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hash(body.phone + body.code)));
  if (!ok) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw E.bad('OTP_INVALID', 'الكود غير صحيح أو منتهي');
  }
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

  let user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user) {
    const referrer = body.referralCode ? await prisma.user.findUnique({ where: { referralCode: body.referralCode } }) : null;
    const roleCodes = ['CUSTOMER', ...(body.asDriver ? ['DRIVER'] : [])];
    const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
    user = await prisma.user.create({ data: {
      phone: body.phone, name: body.name, referralCode: newReferral(), referredById: referrer?.id,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      ...(body.asDriver ? { driver: { create: {} } } : {}),
    } });
    if (referrer) await prisma.referral.create({ data: { referrerId: referrer.id, refereeId: user.id } });
  }
  if (user.status !== 'ACTIVE') throw E.forbidden();
  res.json(await issueTokens(user.id, req.headers['user-agent'], req.ip));
}));

authRouter.post('/refresh', ah(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
  const s = await prisma.session.findUnique({ where: { refreshTokenHash: hash(refreshToken) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) throw E.unauthorized();
  await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } }); // rotation
  res.json(await issueTokens(s.userId, req.headers['user-agent'], req.ip));
}));

authRouter.post('/logout', authenticate, ah(async (req, res) => {
  await prisma.session.updateMany({ where: { userId: req.user!.id, revokedAt: null }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

async function issueTokens(userId: string, ua?: string, ip?: string) {
  const accessToken = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL as any });
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await prisma.session.create({ data: { userId, refreshTokenHash: hash(refreshToken), userAgent: ua, ip, expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86400_000) } });
  return { accessToken, refreshToken };
}
export const hashSecret = hash;
