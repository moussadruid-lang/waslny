import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Vibration, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Badge, Button, Card, Row, STATUS_SHORT, Screen, StateView, T, api, egp, errMsg, km, statusColor, theme, useApi, useAuth, useInterval, useNow, useSocketEvent, useToast,
} from '@mashawir/mobile-core';
import { sendLocationNow, startTracking, stopTracking } from '../../src/tracking';
import { takeDropped, useQueueSize } from '../../src/offlineQueue';

export interface DriverMe {
  id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; rejectionReason?: string | null; online: boolean; activeOrders: number;
  rating: number; ratingCount: number; acceptanceRate: number; profileComplete: boolean; user: { name: string | null; phone: string };
  vehicle: { model?: string; plate?: string; color?: string; type: { code: string; nameAr: string } } | null; documents: { type: string; status: string; note?: string | null }[];
}
interface Offer { id: string; orderId: string; distanceKm: number; expiresAt: string; order: { id: string; code: string; total: number; distanceKm: number; packageSizeCode: string; weightKg: number; urgent: boolean; stops: { type: string; formatted?: string | null; landmark?: string | null }[] } }

export default function DriverHome() {
  const router = useRouter();
  const toast = useToast();
  const { reloadMe } = useAuth();
  const me = useApi(() => api<DriverMe>('/v1/driver/me'), []);
  const d = me.data;
  const approved = d?.status === 'APPROVED';
  const offers = useApi(() => api<Offer[]>('/v1/driver/offers'), [], { enabled: approved });
  const active = useApi(() => api<{ orders: any[]; route: string[] }>('/v1/driver/orders/active'), [], { enabled: approved });
  const [toggling, setToggling] = useState(false);
  const [accepting, setAccepting] = useState<string>();
  const queued = useQueueSize();
  const now = useNow(1000);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { me.refresh(); if (approved) { offers.refresh(); active.refresh(); } takeDropped().then((x) => x.forEach((a) => toast.show(`${a.label}: ${a.message}`, 'error'))); }, [approved]));
  useInterval(() => offers.refresh(), approved && d?.online ? 8000 : null); // socket is primary, polling is the safety net
  useSocketEvent('offer:new', () => { Vibration.vibrate([0, 400, 200, 400]); offers.refresh(); }, approved);

  // Keep GPS alive whenever the driver is online or still has orders (survives app restarts).
  useEffect(() => {
    if (!d) return;
    if (approved && (d.online || d.activeOrders > 0)) startTracking().catch(() => {});
    else stopTracking();
  }, [approved, d?.online, d?.activeOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(v: boolean) {
    setToggling(true);
    try {
      if (v) { await startTracking(); await sendLocationNow(); }
      await api('/v1/driver/online', { body: { online: v } });
      me.setData((x) => (x ? { ...x, online: v } : x));
      toast.show(v ? 'أنت متاح دلوقتي — هتوصلك الطلبات القريبة' : 'أنت غير متاح', v ? 'success' : 'info');
      if (v) offers.refresh();
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setToggling(false); }
  }
  async function accept(o: Offer) {
    setAccepting(o.orderId);
    try { await api(`/v1/driver/offers/${o.orderId}/accept`, { body: {} }); toast.show('تم قبول الطلب'); router.push(`/order/${o.orderId}`); me.refresh(); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setAccepting(undefined); offers.refresh(); active.refresh(); }
  }
  async function reject(o: Offer) {
    offers.setData((l) => l?.filter((x) => x.id !== o.id));
    api(`/v1/driver/offers/${o.orderId}/reject`, { body: {} }).catch(() => {});
  }
  async function becomeDriver() {
    try { await api('/v1/customer/become-driver', { body: {} }); await reloadMe(); me.reload(); } catch (e) { toast.show(errMsg(e), 'error'); }
  }

  if (me.loading) return <Screen><StateView loading /></Screen>;
  if (me.error?.status === 403) return (
    <Screen><Card style={{ marginTop: 40 }}>
      <T bold size={18}>حسابك مش مسجّل كمندوب</T>
      <T muted style={{ marginVertical: 8 }}>فعّل حساب المندوب على نفس الرقم، وبعدها ارفع بياناتك للمراجعة.</T>
      <Button title="فعّل حساب المندوب" onPress={becomeDriver} />
    </Card></Screen>
  );
  if (me.error || !d) return <Screen><StateView error={me.error} onRetry={me.reload} /></Screen>;

  if (!d.profileComplete || d.status === 'REJECTED') return (
    <Screen scroll>
      <T size={22} bold style={{ marginBottom: 12 }}>أهلًا بيك في مشاوير 👋</T>
      {d.status === 'REJECTED' && <Card style={{ backgroundColor: theme.dangerSoft }}><T bold color={theme.danger}>تم رفض الطلب</T><T>{d.rejectionReason || 'راجع بياناتك ومستنداتك وابعتها تاني'}</T></Card>}
      <Card>
        <T bold>كمّل بياناتك عشان تبدأ تستقبل طلبات</T>
        <T muted style={{ marginVertical: 8 }}>الرقم القومي، بيانات المركبة، وصور المستندات. المراجعة عادةً خلال 24 ساعة.</T>
        <Button title="ابدأ التسجيل" icon="document-text-outline" onPress={() => router.push('/onboarding')} />
      </Card>
    </Screen>
  );
  if (d.status === 'PENDING') return (
    <Screen scroll refreshing={me.refreshing} onRefresh={me.refresh}>
      <Card style={{ marginTop: 24, alignItems: 'center' }}>
        <Ionicons name="hourglass-outline" size={44} color={theme.accent} />
        <T bold size={18} center style={{ marginTop: 8 }}>حسابك قيد المراجعة</T>
        <T muted center>هنبلغك أول ما يتم تفعيل حسابك. اسحب لأسفل للتحديث.</T>
      </Card>
      <Card>
        <T bold style={{ marginBottom: 6 }}>المستندات</T>
        {d.documents.map((x, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T>{DOC_AR[x.type] ?? x.type}</T><T muted>{x.status === 'APPROVED' ? 'مقبول ✓' : x.status === 'REJECTED' ? `مرفوض${x.note ? ` — ${x.note}` : ''}` : 'قيد المراجعة'}</T></Row>)}
        <Button small variant="ghost" title="تعديل البيانات" onPress={() => router.push('/onboarding')} style={{ marginTop: 8 }} />
      </Card>
    </Screen>
  );
  if (d.status === 'SUSPENDED') return (
    <Screen><Card style={{ marginTop: 40 }}><T bold size={18} color={theme.danger}>تم إيقاف حسابك مؤقتًا</T><T muted style={{ marginTop: 6 }}>تواصل مع فريق التشغيل لمعرفة السبب.</T><Button small variant="secondary" title="تواصل مع الدعم" onPress={() => router.push('/support')} style={{ marginTop: 10 }} /></Card></Screen>
  );

  const list = (offers.data ?? []).filter((o) => new Date(o.expiresAt).getTime() > now);
  const orders = active.data?.orders ?? [];
  const nextStopId = active.data?.route?.[0];
  const nextOrder = orders.find((o) => o.stops.some((s: any) => s.id === nextStopId));
  const nextStop = nextOrder?.stops.find((s: any) => s.id === nextStopId);

  return (
    <Screen scroll refreshing={me.refreshing || offers.refreshing} onRefresh={() => { me.refresh(); offers.refresh(); active.refresh(); }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <View><T size={22} bold>{d.user.name ? `أهلًا ${d.user.name.split(' ')[0]}` : 'أهلًا'}</T><Row gap={4}><Ionicons name="star" size={14} color={theme.accent} /><T muted size={13}>{`${d.rating.toFixed(1)} · قبول ${Math.round(d.acceptanceRate * 100)}%`}</T></Row></View>
        {queued > 0 && <Badge label={`${queued} في انتظار النت`} fg={theme.warning} bg={theme.warningSoft} />}
      </Row>

      <Card style={{ backgroundColor: d.online ? theme.primary : '#fff' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T bold size={18} color={d.online ? '#fff' : theme.text}>{d.online ? 'متاح لاستقبال الطلبات' : 'غير متاح'}</T>
            <T size={13} color={d.online ? '#D1FAE5' : theme.muted}>{d.online ? 'موقعك بيتحدّث عشان توصلك أقرب الطلبات' : 'شغّل الزرار عشان تبدأ تستقبل طلبات'}</T>
          </View>
          <Switch value={d.online} disabled={toggling} onValueChange={toggle} trackColor={{ true: '#34D399', false: theme.border }} thumbColor="#fff" style={{ transform: [{ scale: 1.2 }] }} />
        </Row>
      </Card>

      {nextOrder && nextStop && (
        <Card onPress={() => router.push(`/order/${nextOrder.id}`)} style={{ borderWidth: 2, borderColor: theme.primary }}>
          <Row style={{ justifyContent: 'space-between' }}><T bold>التوقف التالي</T><Badge label={STATUS_SHORT[nextOrder.status as keyof typeof STATUS_SHORT]} {...statusColor(nextOrder.status)} /></Row>
          <Row gap={8} style={{ marginTop: 6 }}>
            <Ionicons name={nextStop.type === 'PICKUP' ? 'radio-button-on' : 'location'} size={18} color={nextStop.type === 'PICKUP' ? theme.primary : theme.danger} />
            <T style={{ flex: 1 }} numberOfLines={2}>{`${nextStop.type === 'PICKUP' ? 'استلام' : 'تسليم'}: ${nextStop.formatted ?? nextStop.landmark ?? 'على الخريطة'}`}</T>
          </Row>
          {orders.length > 1 && <T size={13} muted style={{ marginTop: 4 }}>{`معاك ${orders.length} طلبات — الترتيب محسّن تلقائيًا`}</T>}
        </Card>
      )}

      <T bold size={17} style={{ marginVertical: 8 }}>الطلبات المتاحة</T>
      {!d.online ? <StateView empty emptyIcon="power-outline" emptyText="شغّل وضع الإتاحة عشان تشوف الطلبات" />
        : offers.error ? <StateView error={offers.error} onRetry={offers.reload} />
        : list.length === 0 ? <StateView empty emptyIcon="radio-outline" emptyText="مفيش طلبات حاليًا، هنبلغك أول ما يظهر طلب قريب" />
        : list.map((o) => {
          const left = Math.max(0, Math.round((new Date(o.expiresAt).getTime() - now) / 1000));
          const pickup = o.order.stops.find((s) => s.type === 'PICKUP');
          const drops = o.order.stops.filter((s) => s.type === 'DROPOFF');
          return (
            <Card key={o.id} style={{ borderWidth: 1, borderColor: left < 10 ? theme.danger : theme.border }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T size={22} bold color={theme.primary}>{egp(o.order.total)}</T>
                <Row gap={6}>{o.order.urgent && <Badge label="عاجل" fg={theme.danger} bg={theme.dangerSoft} />}<Badge label={`${left} ث`} fg={left < 10 ? theme.danger : theme.info} bg={left < 10 ? theme.dangerSoft : theme.infoSoft} /></Row>
              </Row>
              <T size={13} muted>{`يبعد عنك ${km(o.distanceKm)} · مسافة المشوار ${km(o.order.distanceKm)} · ${o.order.weightKg} كجم`}</T>
              <Row gap={8} style={{ marginTop: 8 }}><Ionicons name="radio-button-on" size={16} color={theme.primary} /><T style={{ flex: 1 }} numberOfLines={1}>{pickup?.formatted ?? pickup?.landmark ?? 'نقطة الاستلام'}</T></Row>
              {drops.map((s, i) => <Row key={i} gap={8} style={{ marginTop: 4 }}><Ionicons name="location" size={16} color={theme.danger} /><T style={{ flex: 1 }} numberOfLines={1}>{s.formatted ?? s.landmark ?? 'نقطة التسليم'}</T></Row>)}
              <Row gap={8} style={{ marginTop: 12 }}>
                <Button style={{ flex: 2 }} title="قبول الطلب" icon="checkmark-circle" loading={accepting === o.orderId} disabled={!!accepting} onPress={() => accept(o)} />
                <Button style={{ flex: 1 }} variant="ghost" title="رفض" onPress={() => reject(o)} disabled={!!accepting} />
              </Row>
            </Card>
          );
        })}
    </Screen>
  );
}

export const DOC_AR: Record<string, string> = {
  NATIONAL_ID_FRONT: 'البطاقة (وجه)', NATIONAL_ID_BACK: 'البطاقة (ظهر)', LICENSE: 'رخصة القيادة', VEHICLE_LICENSE: 'رخصة المركبة',
  CRIMINAL_RECORD: 'الفيش الجنائي', PHOTO: 'صورة شخصية',
};
