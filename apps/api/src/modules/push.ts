import { prisma } from '../lib/db.ts';
import { env } from '../config.ts';

/** Expo push (works for both Android/iOS builds of the Expo apps). FCM can be added behind PUSH_PROVIDER. */
export async function sendPush(notificationId: string) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId }, include: { user: { include: { devices: true } } } });
  if (!n || env.PUSH_PROVIDER === 'none') return;
  const prefs = (n.user.notificationPrefs ?? {}) as Record<string, boolean>;
  if (prefs[n.type] === false) return;
  const tokens = n.user.devices.map((d) => d.pushToken);
  if (!tokens.length) return;
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title: n.titleAr, body: n.bodyAr, data: { deepLink: n.deepLink, ...((n.data as object) ?? {}) }, sound: 'default', channelId: 'orders' }))),
  });
  await prisma.notification.update({ where: { id: n.id }, data: r.ok ? { pushedAt: new Date() } : { pushError: `HTTP ${r.status}` } });
  if (!r.ok) throw new Error(`push failed ${r.status}`);
}
