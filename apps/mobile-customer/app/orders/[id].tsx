import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Share, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import {
  Badge, Button, CUSTOMER_CANCELLABLE, Card, Chip, Divider, Header, Input, KV, PROGRESS, Row, STATUS_AR, STATUS_SHORT, Screen, Stars, StateView, T, TERMINAL_STATUSES, Timeline,
  TRACKING_URL, api, egp, errMsg, fmtDate, km, mins, progressIndex, regionFor, showsDriver, statusColor, theme, useApi, useAuth, useInterval, useOrderRoom, useSocketEvent, useToast,
  type OrderStatus,
} from '@mashawir/mobile-core';

const CANCEL_REASONS = ['غيّرت رأيي', 'طلبت بالغلط', 'المندوب اتأخر', 'السعر عالي', 'هبعت بطريقة تانية', 'سبب آخر'];
const GOOD = ['سريع', 'محترم', 'حافظ على الشحنة', 'تواصل كويس'];
const BAD = ['اتأخر', 'سلوك غير لائق', 'الشحنة اتأذت', 'مردش على التليفون', 'طلب فلوس زيادة'];
const PAY_AR: Record<string, string> = { CASH: 'كاش عند الاستلام', WALLET: 'المحفظة', CARD: 'بطاقة', MOBILE_WALLET: 'محفظة إلكترونية' };

export default function OrderDetails() {
  const { id, otp } = useLocalSearchParams<{ id: string; otp?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const q = useApi(() => api<any>(`/v1/customer/orders/${id}`), [id]);
  const [live, setLive] = useState<{ lat: number; lng: number; etaMinutes?: number; distanceKm?: number } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  useOrderRoom(id);
  useSocketEvent<{ orderId: string; messageAr: string }>('order:status', (p) => { if (p.orderId === id) { q.refresh(); toast.show(p.messageAr, 'info'); } });
  useSocketEvent<any>('driver:location', (p) => setLive(p));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { q.refresh(); }, [id]));
  const o = q.data;
  const status = o?.status as OrderStatus | undefined;
  const terminal = !status || TERMINAL_STATUSES.includes(status);
  useInterval(() => q.refresh(), terminal ? null : 30000); // fallback when the socket is down

  const pickup = o?.stops.find((s: any) => s.type === 'PICKUP');
  const drops = o?.stops.filter((s: any) => s.type === 'DROPOFF') ?? [];
  const driverPos = live ?? (o?.driver?.lastLat != null ? { lat: o.driver.lastLat, lng: o.driver.lastLng } : null);
  const region = useMemo(() => regionFor([...(o?.stops ?? []).map((s: any) => ({ lat: s.lat, lng: s.lng })), ...(driverPos && status && showsDriver(status) ? [driverPos] : [])]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o?.id, status]);

  if (q.loading || q.error || !o) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="تفاصيل الطلب" onBack={() => router.back()} /><StateView loading={q.loading} error={q.error} onRetry={q.reload} /></Screen>;

  const c = statusColor(o.status);
  const pi = progressIndex(o.status);
  const myRating = o.ratings?.find((r: any) => r.raterId === me?.id);

  async function cancel() {
    if (!reason) return toast.show('اختر سبب الإلغاء', 'info');
    setBusy(true);
    try { const r = await api(`/v1/customer/orders/${id}/cancel`, { body: { reason } }); toast.show(r.messageAr ?? 'تم إلغاء الطلب'); setCancelOpen(false); q.refresh(); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function call() {
    try { const r = await api<{ phone: string }>(`/v1/customer/orders/${id}/contact`); Linking.openURL(`tel:${r.phone}`); }
    catch (e) { toast.show(errMsg(e), 'error'); }
  }
  async function rate() {
    if (!stars) return toast.show('اختر عدد النجوم', 'info');
    setBusy(true);
    try { await api(`/v1/customer/orders/${id}/rate`, { body: { stars, reasons: tags, comment: comment.trim() || undefined } }); toast.show('شكرًا لتقييمك'); q.refresh(); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const share = () => Share.share({ message: `تتبع طلبك في مشاوير (${o.code}): ${TRACKING_URL}/${o.trackingToken}` });

  return (
    <Screen scroll padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <Header title={o.code} onBack={() => router.back()} right={<Pressable onPress={share} hitSlop={10} accessibilityLabel="مشاركة رابط التتبع"><Ionicons name="share-social-outline" size={24} color={theme.text} /></Pressable>} />
      <View style={{ height: 260 }}>
        <MapView style={{ flex: 1 }} provider={PROVIDER_GOOGLE} initialRegion={region} toolbarEnabled={false}>
          {pickup && <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="الاستلام" pinColor="green" />}
          {drops.map((d: any) => <Marker key={d.id} coordinate={{ latitude: d.lat, longitude: d.lng }} title={d.contactName ?? 'التسليم'} pinColor="red" />)}
          {pickup && drops[0] && <Polyline coordinates={[pickup, ...drops].map((s: any) => ({ latitude: s.lat, longitude: s.lng }))} strokeColor={theme.primary} strokeWidth={3} lineDashPattern={[8, 6]} />}
          {driverPos && showsDriver(o.status) && (
            <Marker coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }} title={o.driver?.user?.name ?? 'المندوب'} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={{ backgroundColor: theme.primary, borderRadius: 18, padding: 6, borderWidth: 2, borderColor: '#fff' }}><Ionicons name="bicycle" size={20} color="#fff" /></View>
            </Marker>
          )}
        </MapView>
      </View>

      <View style={{ padding: 16 }}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge label={STATUS_SHORT[o.status as OrderStatus]} fg={c.fg} bg={c.bg} />
            {live?.etaMinutes != null && showsDriver(o.status) ? <T bold color={theme.primary}>{`يوصل خلال ${mins(live.etaMinutes)} · ${km(live.distanceKm)}`}</T> : null}
          </Row>
          <Row gap={8} style={{ marginTop: 10 }}>
            {o.status === 'SEARCHING_DRIVER' && <ActivityIndicator color={theme.primary} />}
            <T size={18} bold style={{ flex: 1 }}>{o.status === 'DRIVER_ASSIGNED' && o.driver?.user?.name ? `تم تعيين المندوب ${o.driver.user.name}` : STATUS_AR[o.status as OrderStatus]}</T>
          </Row>
          {o.scheduledAt && o.status === 'NEW' ? <T muted>{`مجدول: ${fmtDate(o.scheduledAt)}`}</T> : null}
          {pi >= 0 && (
            <Row gap={4} style={{ marginTop: 12 }}>
              {PROGRESS.map((p, i) => <View key={p} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= pi ? theme.primary : theme.border }} />)}
            </Row>
          )}
        </Card>

        {otp && !terminal ? (
          <Card style={{ backgroundColor: '#FEF3C7' }}>
            <T bold>كود التسليم: {otp}</T>
            <T size={13} muted>شارك كود التسليم مع المستلم فقط. اتبعتله برسالة كمان.</T>
          </Card>
        ) : null}

        {o.driver && (
          <Card>
            <Row gap={12}>
              {o.driver.user?.avatarUrl ? <Image source={{ uri: o.driver.user.avatarUrl }} style={{ width: 52, height: 52, borderRadius: 26 }} /> : (
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={26} color={theme.primary} /></View>
              )}
              <View style={{ flex: 1 }}>
                <T bold>{o.driver.user?.name ?? 'المندوب'}</T>
                <Row gap={4}><Ionicons name="star" size={14} color={theme.accent} /><T size={13} muted>{o.driver.rating?.toFixed(1)}</T></Row>
                {o.driver.vehicles?.[0] ? <T size={13} muted>{[o.driver.vehicles[0].model, o.driver.vehicles[0].color, o.driver.vehicles[0].plate].filter(Boolean).join(' · ')}</T> : null}
              </View>
              {!terminal && (
                <Row gap={10}>
                  <Pressable onPress={call} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="اتصال"><Ionicons name="call" size={20} color={theme.primary} /></Pressable>
                  <Pressable onPress={() => router.push(`/chat/${id}`)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="محادثة"><Ionicons name="chatbubble-ellipses" size={20} color={theme.primary} /></Pressable>
                </Row>
              )}
            </Row>
          </Card>
        )}

        {o.status === 'DELIVERED' && !myRating && (
          <Card>
            <T bold center style={{ marginBottom: 8 }}>قيّم تجربتك مع المندوب</T>
            <Stars value={stars} onChange={(n) => { setStars(n); setTags([]); }} />
            {stars > 0 && (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
                  {(stars >= 4 ? GOOD : BAD).map((t) => <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} />)}
                </View>
                <Input value={comment} onChangeText={setComment} placeholder="تعليق (اختياري)" maxLength={500} multiline />
                <Button title="إرسال التقييم" onPress={rate} loading={busy} />
              </>
            )}
          </Card>
        )}
        {myRating && <Card><T center>تقييمك</T><Stars value={myRating.stars} size={22} /></Card>}

        <Card>
          <T bold style={{ marginBottom: 8 }}>العناوين</T>
          {pickup && <StopRow icon="radio-button-on" color={theme.primary} title="الاستلام" s={pickup} />}
          {drops.map((d: any) => <StopRow key={d.id} icon="location" color={theme.danger} title={d.contactName ? `التسليم — ${d.contactName}` : 'التسليم'} s={d} />)}
        </Card>

        <Card>
          <T bold style={{ marginBottom: 6 }}>الحساب</T>
          {(o.priceBreakdown ?? []).map((l: any, i: number) => <KV key={i} k={l.labelAr} v={egp(l.amount)} />)}
          {o.discount > 0 && <KV k="الخصم" v={<T color={theme.success}>−{egp(o.discount)}</T>} />}
          <Divider />
          <KV bold k="الإجمالي" v={egp(o.total)} />
          <KV k="الدفع" v={PAY_AR[o.paymentMethod] ?? o.paymentMethod} />
          <KV k="المسافة" v={km(o.distanceKm)} />
        </Card>

        {o.proofs?.[0] && (
          <Card>
            <T bold style={{ marginBottom: 6 }}>إثبات التسليم</T>
            {o.proofs[0].recipientName ? <KV k="استلمها" v={o.proofs[0].recipientName} /> : null}
            <KV k="الوقت" v={fmtDate(o.proofs[0].capturedAt)} />
            {o.proofs[0].otpVerified ? <KV k="كود التسليم" v="تم التحقق ✓" /> : null}
            {o.proofs[0].photoUrl ? <Image source={{ uri: o.proofs[0].photoUrl }} style={{ width: '100%', height: 180, borderRadius: 10, marginTop: 8 }} resizeMode="cover" /> : null}
          </Card>
        )}

        <Card>
          <T bold style={{ marginBottom: 8 }}>سجل الطلب</T>
          <Timeline rows={o.history} />
        </Card>

        <Button variant="secondary" icon="share-social-outline" title="مشاركة رابط التتبع" onPress={share} style={{ marginBottom: 10 }} />
        <Button variant="ghost" icon="help-buoy-outline" title="مشكلة في الطلب؟" onPress={() => router.push({ pathname: '/support/new', params: { orderId: id } })} style={{ marginBottom: 10 }} />

        {CUSTOMER_CANCELLABLE.includes(o.status) && (
          !cancelOpen ? <Button variant="danger" icon="close-circle-outline" title="إلغاء الطلب" onPress={() => setCancelOpen(true)} /> : (
            <Card>
              <T bold style={{ marginBottom: 8 }}>ليه عايز تلغي؟</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{CANCEL_REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}</View>
              <Row gap={8}>
                <Button style={{ flex: 1 }} variant="ghost" title="رجوع" onPress={() => setCancelOpen(false)} />
                <Button style={{ flex: 1 }} variant="danger" title="تأكيد الإلغاء" loading={busy} onPress={cancel} />
              </Row>
            </Card>
          )
        )}
      </View>
    </Screen>
  );
}

function StopRow({ icon, color, title, s }: { icon: any; color: string; title: string; s: any }) {
  return (
    <Row gap={10} style={{ alignItems: 'flex-start', marginBottom: 10 }}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 3 }} />
      <View style={{ flex: 1 }}>
        <T bold size={14}>{title}</T>
        {s.formatted ? <T size={14}>{s.formatted}</T> : null}
        {s.description ? <T size={13} muted>{s.description}</T> : null}
        {s.landmark ? <T size={13} muted>{`علامة: ${s.landmark}`}</T> : null}
        {s.completedAt ? <T size={12} color={theme.success}>{`تم ${fmtDate(s.completedAt)}`}</T> : null}
      </View>
    </Row>
  );
}
