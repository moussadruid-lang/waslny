import crypto from 'node:crypto';
import net from 'node:net';
import { prisma } from '../lib/db.ts';
import { E } from '../lib/errors.ts';
import { queues } from '../jobs/queues.ts';

export const WEBHOOK_EVENTS = ['*', 'test.ping', 'order.new', 'order.searching_driver', 'order.driver_assigned', 'order.driver_going_to_pickup', 'order.driver_arrived_pickup',
  'order.package_picked_up', 'order.in_delivery', 'order.driver_arrived_destination', 'order.delivered', 'order.cancelled', 'order.failed_delivery', 'order.returning', 'order.returned'];

/** Blocks obvious SSRF targets (https only, no localhost / private / link-local literals). */
export function assertSafeWebhookUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw E.bad('BAD_URL', 'رابط غير صالح'); }
  if (u.protocol !== 'https:') throw E.bad('HTTPS_REQUIRED', 'يجب أن يبدأ الرابط بـ https://');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || (net.isIPv4(h) && privateV4.test(h)) || (net.isIPv6(h) && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))))
    throw E.bad('UNSAFE_URL', 'لا يمكن استخدام عنوان داخلي');
  return u.toString();
}

/** Fan-out: one delivery row + one retriable job per matching webhook (a failing hook never re-sends to healthy ones). */
export async function fanOutWebhook(businessId: string, event: string, orderId?: string, onlyWebhookId?: string) {
  const hooks = await prisma.webhook.findMany({ where: { businessId, active: true, ...(onlyWebhookId ? { id: onlyWebhookId } : { events: { hasSome: [event, '*'] } }) } });
  if (!hooks.length) return 0;
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, status: true, total: true, codAmount: true, trackingToken: true, updatedAt: true } }) : null;
  for (const h of hooks) {
    const d = await prisma.webhookDelivery.create({ data: { webhookId: h.id, event, payload: {} } });
    const payload = { id: d.id, event, at: new Date().toISOString(), data: order ? { orderId: order.id, code: order.code, status: order.status, total: order.total, codAmount: order.codAmount, trackingToken: order.trackingToken, updatedAt: order.updatedAt } : { ping: true } };
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { payload: payload as any } });
    await queues.webhooks.add('deliver', { deliveryId: d.id }, { jobId: `wh:${d.id}` });
  }
  return hooks.length;
}

/** Single delivery attempt. Throws on non-2xx so BullMQ retries with exponential backoff. */
export async function deliverWebhook(deliveryId: string) {
  const d = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!d || d.succeededAt || !d.webhook.active) return;
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', d.webhook.secret).update(`${ts}.${body}`).digest('hex');
  let status: number | null = null; let error: string | null = null;
  try {
    assertSafeWebhookUrl(d.webhook.url);
    const r = await fetch(d.webhook.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-mashawir-signature': sig, 'x-mashawir-timestamp': ts, 'x-mashawir-event': d.event, 'x-mashawir-delivery': d.id }, body, signal: AbortSignal.timeout(10_000) });
    status = r.status; if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e: any) { error = String(e?.message ?? e).slice(0, 200); }
  await prisma.webhookDelivery.update({ where: { id: d.id }, data: { statusCode: status, error, attempts: { increment: 1 }, succeededAt: error ? null : new Date() } });
  if (error) throw new Error(`webhook delivery ${d.id} failed: ${error}`);
}
