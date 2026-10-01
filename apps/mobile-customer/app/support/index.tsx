import React, { useCallback } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Badge, Button, Card, Header, Row, Screen, StateView, T, api, fmtDate, theme, useApi } from '@mashawir/mobile-core';

export const CATS: Record<string, string> = { ORDER: 'مشكلة في الطلب', DRIVER: 'مشكلة مع المندوب', PAYMENT: 'مشكلة دفع', ADDRESS: 'مشكلة عنوان', REFUND: 'استرداد', OTHER: 'أخرى' };
export const TICKET_STATUS: Record<string, { ar: string; fg: string; bg: string }> = {
  OPEN: { ar: 'مفتوحة', fg: theme.info, bg: theme.infoSoft }, IN_PROGRESS: { ar: 'جارٍ المتابعة', fg: theme.accent, bg: '#FEF3C7' },
  WAITING_USER: { ar: 'بانتظار ردك', fg: theme.warning, bg: theme.warningSoft }, RESOLVED: { ar: 'تم الحل', fg: theme.success, bg: theme.successSoft }, CLOSED: { ar: 'مغلقة', fg: theme.muted, bg: theme.border },
};

export default function Support() {
  const router = useRouter();
  const q = useApi(() => api<any[]>('/v1/support/tickets'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { q.refresh(); }, []));
  return (
    <Screen padded={false} edges={['top', 'bottom', 'left', 'right']} footer={<Button title="طلب دعم جديد" icon="add" onPress={() => router.push('/support/new')} />}>
      <Header title="الدعم الفني" onBack={() => router.back()} />
      {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <FlatList data={q.data} keyExtractor={(t) => t.id} contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} colors={[theme.primary]} />}
          ListEmptyComponent={<StateView empty emptyIcon="headset-outline" emptyText="مفيش طلبات دعم. لو عندك مشكلة احنا موجودين." />}
          renderItem={({ item: t }) => {
            const st = TICKET_STATUS[t.status] ?? TICKET_STATUS.OPEN;
            return (
              <Card onPress={() => router.push(`/support/${t.id}`)}>
                <Row style={{ justifyContent: 'space-between' }}><T bold>{t.subject}</T><Badge label={st.ar} fg={st.fg} bg={st.bg} /></Row>
                <T size={13} muted>{`${CATS[t.category] ?? t.category} · ${t.code} · ${fmtDate(t.createdAt)}`}</T>
              </Card>
            );
          }} />
      )}
    </Screen>
  );
}
