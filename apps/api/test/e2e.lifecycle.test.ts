/**
 * The critical scenario (§74): customer in Damro sends a parcel to Sidi Salem, end-to-end against a real DB.
 * Customer → quote → order → dispatch → atomic accept → tracking → pickup → delivery OTP → payment → commission → wallet → rating → admin → reports
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { execSync } from 'node:child_process';

let app: any; let prisma: any; let runWave: any;
const DAMRO = { lat: 31.205, lng: 30.842 }; const SIDI_SALEM = { lat: 31.2692, lng: 30.7869 };

async function login(phone: string, extra: Record<string, unknown> = {}) {
  const r1 = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await request(app).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode, name: 'اختبار', ...extra }).expect(200);
  return `Bearer ${r2.body.accessToken}`;
}

beforeAll(async () => {
  execSync('npx prisma db push --force-reset --skip-generate && npx tsx prisma/seed.ts', { stdio: 'inherit' });
  const { createApp } = await import('../src/app.ts');
  app = createApp();
  ({ prisma } = await import('../src/lib/db.ts'));
  ({ runWave } = await import('../src/modules/dispatch.service.ts'));
});

describe('مشاوير full order lifecycle', () => {
  let customer: string; let driverA: string; let driverB: string; let admin: string; let orderId: string; let otp: string;

  it('sets up real accounts (customer, 2 approved drivers, admin)', async () => {
    customer = await login('01000000001');
    driverA = await login('01100000002', { asDriver: true });
    driverB = await login('01200000003', { asDriver: true });
    admin = await login('01500000004');
    const superRole = await prisma.role.findUnique({ where: { code: 'SUPER_ADMIN' } });
    const adminUser = await prisma.user.findUnique({ where: { phone: '+201500000004' } });
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: superRole.id } });
    for (const [tok, d] of [[driverA, 0.004], [driverB, 0.006]] as const) {
      await request(app).put('/v1/driver/profile').set('Authorization', tok).send({ nationalIdNo: '29001011234567', vehicleTypeCode: 'MOTORCYCLE', model: 'Bajaj Boxer', plate: 'أ ب ج 123',
        documents: [{ type: 'NATIONAL_ID_FRONT', fileUrl: 'https://files.example/id1' }, { type: 'NATIONAL_ID_BACK', fileUrl: 'https://files.example/id2' }, { type: 'LICENSE', fileUrl: 'https://files.example/l' }] }).expect(200);
      const me = await request(app).get('/v1/customer/me').set('Authorization', tok).expect(200);
      await request(app).post(`/v1/admin/drivers/${me.body.driver.id}/status`).set('Authorization', admin).send({ status: 'APPROVED' }).expect(200);
      await request(app).post('/v1/driver/online').set('Authorization', tok).send({ online: true }).expect(200);
      await request(app).post('/v1/driver/location').set('Authorization', tok).send({ lat: DAMRO.lat + d, lng: DAMRO.lng }).expect(200);
    }
  });

  const body = { pickup: { ...DAMRO, description: 'البيت الثالث بعد المسجد' }, dropoffs: [{ ...SIDI_SALEM, contactName: 'محمود', contactPhone: '01011111111', landmark: 'بجوار الصيدلية' }],
    vehicleTypeCode: 'MOTORCYCLE', packageSizeCode: 'SMALL', categoryCode: 'PERSONAL', weightKg: 2, urgent: false, paymentMethod: 'CASH' };

  it('quotes server-side in EGP with breakdown (client price ignored)', async () => {
    const q = await request(app).post('/v1/customer/quote').set('Authorization', customer).send({ ...body, total: 1 }).expect(200);
    expect(q.body.currency).toBe('EGP');
    expect(q.body.distanceKm).toBeGreaterThan(5);
    expect(q.body.total).toBeGreaterThan(3000);
    expect(q.body.lines.map((l: any) => l.code)).toContain('DISTANCE');
  });

  it('creates the order and starts searching', async () => {
    const r = await request(app).post('/v1/customer/orders').set('Authorization', customer).send(body).expect(201);
    orderId = r.body.id; otp = r.body.deliveryOtp;
    expect(otp).toMatch(/^\d{4}$/);
    expect(r.body.status).toBe('NEW');
    const o = await prisma.order.findUnique({ where: { id: orderId } });
    expect(o.status).toBe('SEARCHING_DRIVER');
    await runWave(orderId, 0);
    expect(await prisma.dispatchOffer.count({ where: { orderId } })).toBe(2);
  });

  it('only ONE of two concurrent accepts wins (lock)', async () => {
    const [a, b] = await Promise.all([
      request(app).post(`/v1/driver/offers/${orderId}/accept`).set('Authorization', driverA),
      request(app).post(`/v1/driver/offers/${orderId}/accept`).set('Authorization', driverB)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const o = await prisma.order.findUnique({ where: { id: orderId } });
    expect(o.status).toBe('DRIVER_ASSIGNED');
    if (a.status !== 200) [driverA, driverB] = [driverB, driverA]; // driverA = winner from here on
  });

  it('rejects illegal jumps and runs the pickup/delivery flow', async () => {
    await request(app).post(`/v1/driver/orders/${orderId}/deliver`).set('Authorization', driverA).send({ otp, ...SIDI_SALEM }).expect(409);
    for (const to of ['DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY'])
      await request(app).post(`/v1/driver/orders/${orderId}/status`).set('Authorization', driverA).send({ to, ...DAMRO }).expect(200);
    await request(app).post('/v1/driver/location').set('Authorization', driverA).send({ ...SIDI_SALEM, at: new Date(Date.now() + 20 * 60_000) }).expect(200);
    await request(app).post(`/v1/driver/orders/${orderId}/status`).set('Authorization', driverA).send({ to: 'DRIVER_ARRIVED_DESTINATION', ...SIDI_SALEM }).expect(200);
    const pub = await request(app).get(`/v1/public/track/${(await prisma.order.findUnique({ where: { id: orderId } })).trackingToken}`).expect(200);
    expect(JSON.stringify(pub.body)).not.toContain('1011111111'); // no phones on public link
  });

  it('requires correct OTP, then settles cash + commission + driver wallet', async () => {
    await request(app).post(`/v1/driver/orders/${orderId}/deliver`).set('Authorization', driverA).send({ otp: otp === '9999' ? '1111' : '9999', ...SIDI_SALEM }).expect(400);
    await request(app).post(`/v1/driver/orders/${orderId}/deliver`).set('Authorization', driverA).send({ otp, recipientName: 'محمود', ...SIDI_SALEM }).expect(200);
    const done = await prisma.order.findUnique({ where: { id: orderId }, include: { history: true } });
    expect(done.status).toBe('DELIVERED');
    expect(done.history.length).toBeGreaterThanOrEqual(9);
    const c = await prisma.commission.findUnique({ where: { orderId } });
    expect(c.commission).toBe(Math.round(done.total * 0.1));
    const e = await request(app).get('/v1/driver/earnings').set('Authorization', driverA).expect(200);
    expect(e.body.owesPlatform).toBe(c.commission);
    expect(e.body.cashCollected).toBe(done.total);
  });

  it('customer rates; admin & reports see it', async () => {
    await request(app).post(`/v1/customer/orders/${orderId}/rate`).set('Authorization', customer).send({ stars: 5, reasons: ['سريع'] }).expect(200);
    const list = await request(app).get('/v1/admin/orders?status=DELIVERED').set('Authorization', admin).expect(200);
    expect(list.body.items.map((x: any) => x.id)).toContain(orderId);
    const rep = await request(app).get('/v1/reports/overview').set('Authorization', admin).expect(200);
    expect(rep.body.delivered).toBe(1);
    expect(rep.body.commission).toBeGreaterThan(0);
  });

  it('enforces RBAC: customer cannot hit admin', async () => {
    await request(app).get('/v1/admin/orders').set('Authorization', customer).expect(403);
  });
});
