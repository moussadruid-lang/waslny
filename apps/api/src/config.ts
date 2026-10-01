import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  OTP_PEPPER: z.string().min(16),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_TRACKING_BASE_URL: z.string().default('http://localhost:3000/track'),
  SMS_PROVIDER: z.enum(['console', 'twilio', 'vonage', 'cequens']).default('console'),
  MAPS_PROVIDER: z.enum(['haversine', 'google', 'osrm', 'mapbox']).default('haversine'),
  MAPS_API_KEY: z.string().optional(),
  OSRM_URL: z.string().optional(),
  PUSH_PROVIDER: z.enum(['none', 'fcm', 'expo']).default('expo'),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
  console.error('❌ SMS_PROVIDER=console is not allowed in production');
  process.exit(1);
}
export const isProd = env.NODE_ENV === 'production';
