import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import {
  Badge, Button, Card, Chip, Header, KV, Row, STATUS_AR, Screen, StateView, T, api, egp, errMsg, km, openNavigation, pickImage, regionFor, statusColor, theme,
  useApi, useOrderRoom, useSocketEvent, useToast, type OrderStatus,
} from '@mashawir/mobile-core';
import { actionPosition } from '../../src/tracking';
import { newClientId, persistFile, runOrQueue } from '../../src/offlineQueue';

const NEXT: Partial<Record<OrderStatus, { to: string; label: string; icon: any }>> = {
  DRIVER_ASSIGNED: { to: 'DRIVER_GOING_TO_PICKUP', label: 'ابدأ التحرك للاستلام', icon: 'navigate' },
  DRIVER_GOING_TO_PICKUP: { to: 'DRIVER_ARRIVED_PICKUP', label: 'وصلت لنقطة الاستلام', icon: 'flag' },
  DRIVER_ARRIVED_PICKUP: { to: 'PACKAGE_PICKED_UP', label: 'تم استلام الشحنة', icon: 'cube' },
  PACKAGE_PICKED_UP: { to: 'IN_DELIVERY', label: 'ابدأ التوصيل', icon: 'bicycle' },
  IN_DELIVERY: { to: 'DRIVER_ARRIVED_DESTINATION', label: 'وصلت لنقطة التسليم', icon: 'flag' },
  FAILED_DELIVERY: { to: 'IN_DELIVERY', label: 'إعادة محاولة التسليم', icon: 'refresh' },
};
const RELEASE_FALLBACK = ['عطل في المركبة', 'المسافة بعيدة', 'ظرف طارئ', 'أخرى'];

export default function DriverOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useApi(() => api<{ orders: any[] }>('/v1/driver/orders/active'), [id]);
  const cfg = useApi(() => api<{ release: { code: string; nameAr: string }[] }>('/v1/driver/config'), []);
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<OrderStatus>();
  const [pickupPhoto, setPickupPhoto] = useState<string>();
  const [releaseOpen, setReleaseOpen] = useState(false);

  useOrderRoom(id);
  useSocketEvent<{ orderId: string; status: string; messageAr: string }>('order:status', (p) => {
    if (p.orderId !== id) return;
    if (p.status === 'CANCELLED') Alert.alert('تم إلغاء الطلب', 'العميل أو التشغيل ألغى الطلب. لا تكمل المشوار.');
    setOptimistic(undefined); q.refresh();
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { setOptimistic(undefined); q.refresh(); }, [id]));

  const o = q.data?.orders.find((x) => x.id === id);
  const status: OrderStatus | undefined = optimistic ?? o?.status;
  const region = useMemo(() => regionFor((o?.stops ?? []).map((s: any) => ({ lat: s.lat, lng: s.lng }))), [o?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.loading || q.error) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="الطلب" onBack={() => router.back()} /><StateView loading={q.loading} error={q.error} onRetry={q.reload} /></Screen>;
  if (!o) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="الطلب" onBack={() => router.back()} /><StateView empty emptyIcon="checkmark-done-outline" emptyText="الطلب ده اتقفل (اتسلّم أو اتلغى أو اترجع)" /></Screen>;

  const pickup = o.stops.find((s: any) => s.type === 'PICKUP');
  const drops = o.stops.filter((s: any) => s.type === 'DROPOFF');
  const next = status ? NEXT[status] : undefined;
  const toPickup = status === 'DRIVER_ASSIGNED' || status === 'DRIVER_GOING_TO_PICKUP' || status === 'DRIVER_ARRIVED_PICKUP';
  const target = toPickup ? pickup : drops.find((d: any) => !d.completedAt) ?? drops[0];
  const c = statusColor(status ?? o.status);

  async function step(to: string, label: string) {
    setBusy(true);
    try {
      const pos = await actionPosition();
      const files = to === 'PACKAGE_PICKED_UP' && pickupPhoto ? [{ field: 'photoUrl' as const, uri: pickupPhoto, mime: 'image/jpeg' as const, purpose: 'PICKUP_PROOF' as const }] : [];
      const r = await runOrQueue({ path: `/v1/driver/orders/${id}/status`, body: { to, lat: pos.lat, lng: pos.lng, clientId: newClientId() }, files, label });
      setOptimistic(to as OrderStatus);
      toast.show(r.queued ? 'اتسجّل وهيتبعت أول ما النت يرجع' : STATUS_AR[to as OrderStatus], r.queued ? 'info' : 'success');
      if (!r.queued) q.refresh();
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function startReturn(label: string, complete: boolean) {
    setBusy(true);
    try {
      const pos = await actionPosition();
      const r = await runOrQueue({ path: `/v1/driver/orders/${id}/return`, body: { lat: pos.lat, lng: pos.lng }, label });
      setOptimistic(complete ? 'RETURNED' : 'RETURNING');
      toast.show(r.queued ? 'اتسجّل وهيتبعت أول ما النت يرجع' : complete ? 'تم إرجاع الشحنة' : 'جارٍ إرجاع الشحنة', 'info');
      if (complete && !r.queued) router.back(); else q.refresh();
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function release(reason: string) {
    setBusy(true);
    try { await api(`/v1/driver/orders/${id}/release`, { body: { reason } }); toast.show('تم الاعتذار عن الطلب، هيتحوّل لمندوب تاني', 'info'); router.back(); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function call(stopId?: string) {
    try {
      const r = await api<{ customer: { phone: string }; stops: { id: string; contactPhone: string | null }[] }>(`/v1/driver/orders/${id}/contacts`);
      const phone = r.stops.find((s) => s.id === stopId)?.contactPhone ?? r.customer.phone;
      Linking.openURL(`tel:${phone}`);
    } catch (e) { toast.show(errMsg(e), 'error'); }
  }
  async function takePickupPhoto() {
    try { const img = await pickImage('camera'); if (img) setPickupPhoto(await persistFile(img.uri, 'jpg')); } catch (e) { toast.show(errMsg(e), 'error'); }
  }

  const releaseReasons = cfg.data?.release?.length ? cfg.data.release.map((r) => r.nameAr) : RELEASE_FALLBACK;
  const collect = o.paymentMethod === 'CASH' ? o.total + (o.codAmount ?? 0) : o.codAmount ?? 0;

  return (
    <Screen scroll padded={false} edges={['top', 'bottom', 'left', 'right']}
      footer={
        <View style={{ gap: 8 }}>
          {status === 'DRIVER_ARRIVED_DESTINATION' ? <Button title="تسليم الطلب" icon="checkmark-done" variant="success" onPress={() => router.push(`/deliver/${id}`)} />
            : status === 'RETURNING' ? <Button title="تم إرجاع الشحنة للراسل" icon="return-down-back" loading={busy} onPress={() => startReturn('إنهاء الإرجاع', true)} />
            : next ? <Button title={next.label} icon={next.icon} loading={busy} onPress={() => step(next.to, next.label)} /> : null}
          {target && <Button variant="secondary" icon="navigate-outline" title={toPickup ? 'ملاحة لنقطة الاستلام' : 'ملاحة لنقطة التسليم'} onPress={() => openNavigation({ lat: target.lat, lng: target.lng })} />}
        </View>
      }>
      <Header title={o.code} onBack={() => router.back()} right={<Pressable onPress={() => router.push(`/chat/${id}`)} hitSlop={10} accessibilityLabel="محادثة"><Ionicons name="chatbubble-ellipses-outline" size={24} color={theme.text} /></Pressable>} />
      <View style={{ height: 220 }}>
        <MapView style={{ flex: 1 }} provider={PROVIDER_GOOGLE} initialRegion={region} showsUserLocation toolbarEnabled={false}>
          {pickup && <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="الاستلام" pinColor="green" />}
          {drops.map((d: any) => <Marker key={d.id} coordinate={{ latitude: d.lat, longitude: d.lng }} title={d.contactName ?? 'التسليم'} pinColor="red" />)}
        </MapView>
      </View>
      <View style={{ padding: 16 }}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}><Badge label={STATUS_AR[status ?? (o.status as OrderStatus)]} fg={c.fg} bg={c.bg} />{o.urgent && <Badge label="عاجل" fg={theme.danger} bg={theme.dangerSoft} />}</Row>
          <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <View><T size={13} muted>{collect ? 'تحصيل نقدي' : 'مدفوع مسبقًا'}</T><T bold size={20} color={theme.primary}>{collect ? egp(collect) : '—'}</T></View>
            <View style={{ alignItems: 'flex-end' }}><T size={13} muted>المسافة</T><T bold>{km(o.distanceKm)}</T></View>
          </Row>
        </Card>

        {[pickup, ...drops].filter(Boolean).map((s: any) => (
          <Card key={s.id} style={s.completedAt ? { opacity: 0.6 } : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={8}><Ionicons name={s.type === 'PICKUP' ? 'radio-button-on' : 'location'} size={18} color={s.type === 'PICKUP' ? theme.primary : theme.danger} /><T bold>{s.type === 'PICKUP' ? 'الاستلام' : `التسليم${s.contactName ? ` — ${s.contactName}` : ''}`}</T></Row>
              <Row gap={14}>
                <Ionicons name="call-outline" size={22} color={theme.primary} onPress={() => call(s.id)} accessibilityLabel="اتصال" />
                <Ionicons name="navigate-outline" size={22} color={theme.primary} onPress={() => openNavigation({ lat: s.lat, lng: s.lng })} accessibilityLabel="ملاحة" />
              </Row>
            </Row>
            {s.formatted ? <T style={{ marginTop: 6 }}>{s.formatted}</T> : null}
            {s.description ? <T size={14} muted>{s.description}</T> : null}
            {s.landmark ? <T size={14} muted>{`علامة: ${s.landmark}`}</T> : null}
            {s.instructions ? <T size={14} color={theme.info}>{`📌 ${s.instructions}`}</T> : null}
            {s.photoUrl ? <Image source={{ uri: s.photoUrl }} style={{ width: '100%', height: 140, borderRadius: 10, marginTop: 8 }} /> : null}
          </Card>
        ))}

        <Card>
          <T bold style={{ marginBottom: 6 }}>الشحنة</T>
          <KV k="النوع / الحجم" v={`${o.categoryCode} · ${o.packageSizeCode}`} />
          <KV k="الوزن" v={`${o.weightKg} كجم`} />
          {o.notes ? <T size={14} muted style={{ marginTop: 4 }}>{o.notes}</T> : null}
          {o.packagePhotoUrl ? <Image source={{ uri: o.packagePhotoUrl }} style={{ width: '100%', height: 140, borderRadius: 10, marginTop: 8 }} /> : null}
          {status === 'DRIVER_ARRIVED_PICKUP' && (
            <Row style={{ marginTop: 10 }}>
              <Button small variant="ghost" icon="camera-outline" title={pickupPhoto ? 'إعادة تصوير الشحنة' : 'صوّر الشحنة عند الاستلام'} onPress={takePickupPhoto} />
              {pickupPhoto ? <Image source={{ uri: pickupPhoto }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
            </Row>
          )}
        </Card>

        {(status === 'IN_DELIVERY' || status === 'DRIVER_ARRIVED_DESTINATION') && <Button variant="danger" icon="alert-circle-outline" title="تعذر التسليم" onPress={() => router.push(`/fail/${id}`)} style={{ marginBottom: 10 }} />}
        {status === 'FAILED_DELIVERY' && <Button variant="ghost" icon="return-down-back" title="بدء إرجاع الشحنة" loading={busy} onPress={() => startReturn('بدء الإرجاع', false)} style={{ marginBottom: 10 }} />}
        {(status === 'DRIVER_ASSIGNED' || status === 'DRIVER_GOING_TO_PICKUP') && (
          !releaseOpen ? <Button variant="ghost" icon="hand-left-outline" title="الاعتذار عن الطلب" onPress={() => setReleaseOpen(true)} /> : (
            <Card>
              <T bold style={{ marginBottom: 8 }}>سبب الاعتذار</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{releaseReasons.map((r) => <Chip key={r} label={r} onPress={() => release(r)} disabled={busy} />)}</View>
              <T size={12} muted>الاعتذار المتكرر بيأثر على نسبة قبولك</T>
              <Button small variant="ghost" title="رجوع" onPress={() => setReleaseOpen(false)} style={{ marginTop: 8 }} />
            </Card>
          )
        )}
      </View>
    </Screen>
  );
}
