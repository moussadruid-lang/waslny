// Requires a disposable Postgres + Redis (see docker-compose.yml / docs/ci.yml). Never point at production.
if (!process.env.DATABASE_URL?.includes('test')) throw new Error('Refusing to run tests: DATABASE_URL must point to a *test* database');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.OTP_PEPPER ??= 'test-pepper-123456';
process.env.SMS_PROVIDER = 'console';
process.env.PUSH_PROVIDER = 'none';
