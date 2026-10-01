import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Chip, Row, Screen, T, api, theme, useApi, useAuth, useInterval, type IconName } from '@mashawir/mobile-core';
import { OrderCard, type OrderRow } from '../../components/OrderCard';

const LABEL_AR: Record<string, string> = { HOME: 'البيت', WORK: 'الشغل', FAVORITE: 'مفضّل', CUSTOM: 'عنوان' };

export default function Home() {
  const { me } = useAuth();
  const router = useRouter();
  const current = useApi(() => api<{ items: OrderRow[] }>('/v1/customer/orders', { query: { group: 'current', limit: 3 } }), []);
  const notif = useApi(() => api<{ unread: number }>('/v1/customer/notifications', { query: { limit: 1 } }), []);
  const addrs = useApi(() => api<any[]>('/v1/customer/addresses'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { current.refresh(); notif.refresh(); addrs.refresh(); }, []));
  useInterval(() => current.refresh(), current.data?.items.length ? 20000 : null);

  const active = current.data?.items ?? [];
  const first = me?.name?.split(' ')[0];
  const actions: { icon: IconName; label: string; go: () => void }[] = [
    { icon: 'add-circle-outline', label: 'طلب جديد', go: () => router.push('/new-order') },
    { icon: 'navigate-circle-outline', label: 'الطلب الحالي', go: () => (active[0] ? router.push(`/orders/${active[0].id}`) : router.push('/orders')) },
    { icon: 'receipt-outline', label: 'طلباتي', go: () => router.push('/orders') },
    { icon: 'location-outline', label: 'عناويني', go: () => router.push('/addresses') },
    { icon: 'wallet-outline', label: 'المحفظة', go: () => router.push('/wallet') },
    { icon: 'headset-outline', label: 'الدعم', go: () => router.push('/support') },
  ];

  return (
    <Screen scroll refreshing={current.refreshing} onRefresh={() => { current.refresh(); notif.refresh(); addrs.refresh(); }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <View>
          <T size={22} bold>{first ? `أهلًا ${first} 👋` : 'أهلًا بيك 👋'}</T>
          <T muted>مشاوير — نوصلها لك</T>
        </View>
        <Pressable onPress={() => router.push('/notifications')} hitSlop={10} accessibilityLabel="الإشعارات">
          <Ionicons name="notifications-outline" size={28} color={theme.text} />
          {!!notif.data?.unread && (
            <View style={{ position: 'absolute', top: -4, end: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <T size={11} bold color="#fff">{notif.data.unread > 99 ? '99+' : notif.data.unread}</T>
            </View>
          )}
        </Pressable>
      </Row>

      <Card style={{ backgroundColor: theme.primary }}>
        <T size={20} bold color="#fff">أرسل شحنتك الآن</T>
        <T color="#D1FAE5" style={{ marginBottom: 12 }}>مندوب قريب يستلم ويسلّم في أسرع وقت</T>
        {[{ k: 'من؟', v: 'نقطة الاستلام', i: 'radio-button-on' as IconName }, { k: 'إلى أين؟', v: 'نقطة التسليم', i: 'location' as IconName }].map((f) => (
          <Pressable key={f.k} onPress={() => router.push('/new-order')} style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={f.i} size={18} color={f.i === 'location' ? theme.danger : theme.primary} />
            <View><T size={12} muted>{f.k}</T><T bold>{f.v}</T></View>
          </Pressable>
        ))}
      </Card>

      {!!addrs.data?.length && (
        <View style={{ marginBottom: 8 }}>
          <T bold style={{ marginBottom: 8 }}>ابدأ من عنوان محفوظ</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {addrs.data.slice(0, 6).map((a) => (
              <Chip key={a.id} icon={a.label === 'HOME' ? 'home-outline' : a.label === 'WORK' ? 'briefcase-outline' : 'star-outline'} label={a.title || LABEL_AR[a.label]}
                onPress={() => router.push({ pathname: '/new-order', params: { pickupId: a.id } })} />
            ))}
          </View>
        </View>
      )}

      {active.length > 0 && (
        <View>
          <T bold size={17} style={{ marginBottom: 8 }}>طلباتك الجارية</T>
          {active.map((o) => <OrderCard key={o.id} o={o} onPress={() => router.push(`/orders/${o.id}`)} />)}
        </View>
      )}

      <T bold size={17} style={{ marginBottom: 8, marginTop: 4 }}>اختصارات</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
        {actions.map((a) => (
          <View key={a.label} style={{ width: '33.33%', padding: 6 }}>
            <Card onPress={a.go} style={{ alignItems: 'center', paddingVertical: 18, marginBottom: 0 }}>
              <Ionicons name={a.icon} size={28} color={theme.primary} />
              <T size={13} center style={{ marginTop: 6 }}>{a.label}</T>
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}
