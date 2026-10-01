import React from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Divider, KV, ListItem, Row, Screen, StateView, T, api, localPhone, theme, useApi, useAuth } from '@mashawir/mobile-core';
import { stopTracking } from '../../src/tracking';
import type { DriverMe } from './index';

export default function DriverAccount() {
  const router = useRouter();
  const { signOut } = useAuth();
  const q = useApi(() => api<DriverMe>('/v1/driver/me'), []);
  const d = q.data;

  const logout = () => Alert.alert('تسجيل الخروج', 'هتبقى غير متاح ومش هتوصلك طلبات.', [{ text: 'إلغاء', style: 'cancel' }, { text: 'خروج', style: 'destructive', onPress: async () => {
    if (d && d.activeOrders > 0) return Alert.alert('معاك طلبات جارية', 'كمّل أو اعتذر عن الطلبات الأول.');
    await api('/v1/driver/online', { body: { online: false } }).catch(() => {});
    await stopTracking(); await signOut();
  } }]);

  return (
    <Screen scroll refreshing={q.refreshing} onRefresh={q.refresh}>
      <T size={22} bold style={{ marginBottom: 12 }}>حسابي</T>
      {q.loading || q.error || !d ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <>
          <Card>
            <Row gap={12}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={28} color={theme.primary} /></View>
              <View style={{ flex: 1 }}>
                <T bold size={17}>{d.user.name ?? '—'}</T>
                <T muted>{localPhone(d.user.phone)}</T>
                <Row gap={4}><Ionicons name="star" size={14} color={theme.accent} /><T size={13} muted>{`${d.rating.toFixed(1)} (${d.ratingCount} تقييم)`}</T></Row>
              </View>
            </Row>
            <Divider />
            <KV k="نسبة القبول" v={`${Math.round(d.acceptanceRate * 100)}%`} />
            <KV k="المركبة" v={d.vehicle ? [d.vehicle.type.nameAr, d.vehicle.model, d.vehicle.plate].filter(Boolean).join(' · ') : '—'} />
            <KV k="حالة الحساب" v={{ PENDING: 'قيد المراجعة', APPROVED: 'مفعّل', REJECTED: 'مرفوض', SUSPENDED: 'موقوف' }[d.status]} />
          </Card>
          <Card>
            <ListItem icon="document-text-outline" title="بياناتي ومستنداتي" subtitle="تحديث المركبة أو المستندات (هتتراجع تاني)" onPress={() => router.push('/onboarding')} />
            <ListItem icon="headset-outline" title="الدعم والتشغيل" onPress={() => router.push('/support')} />
            <Divider />
            <ListItem icon="log-out-outline" danger title="تسجيل الخروج" onPress={logout} />
          </Card>
          <T center muted size={12}>مشاوير مندوب · الإصدار 1.0.0</T>
        </>
      )}
    </Screen>
  );
}
