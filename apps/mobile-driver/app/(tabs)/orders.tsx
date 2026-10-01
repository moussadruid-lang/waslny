import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Badge, Card, Chip, Row, STATUS_SHORT, Screen, StateView, T, api, egp, fmtDate, km, statusColor, theme, useApi, usePaged } from '@mashawir/mobile-core';

export default function DriverOrders() {
  const router = useRouter();
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const active = useApi(() => api<{ orders: any[]; route: string[] }>('/v1/driver/orders/active'), []);
  const fetchPage = useCallback((cursor?: string | null) => api<{ items: any[]; nextCursor: string | null }>('/v1/driver/orders/history', { query: { cursor, limit: 20 } }), []);
  const hist = usePaged(fetchPage, [fetchPage]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { active.refresh(); }, []));

  const row = (o: any, onPress?: () => void) => {
    const c = statusColor(o.status);
    const from = o.stops.find((s: any) => s.type === 'PICKUP'); const to = o.stops.filter((s: any) => s.type === 'DROPOFF');
    return (
      <Card onPress={onPress}>
        <Row style={{ justifyContent: 'space-between' }}><T bold>{o.code}</T><Badge label={(STATUS_SHORT as any)[o.status]} fg={c.fg} bg={c.bg} /></Row>
        <T size={14} numberOfLines={1} style={{ marginTop: 6 }}>{`من: ${from?.formatted ?? '—'}`}</T>
        <T size={14} numberOfLines={1}>{`إلى: ${to.map((s: any) => s.formatted ?? '—').join(' ← ')}`}</T>
        <Row style={{ justifyContent: 'space-between', marginTop: 6 }}><T size={13} muted>{`${km(o.distanceKm)} · ${fmtDate(o.deliveredAt ?? o.updatedAt ?? o.createdAt)}`}</T><T bold color={theme.primary}>{egp(o.total)}</T></Row>
      </Card>
    );
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <T size={22} bold style={{ marginBottom: 10 }}>طلباتي</T>
        <Row><Chip label="الجارية" selected={tab === 'active'} onPress={() => setTab('active')} /><Chip label="السابقة" selected={tab === 'history'} onPress={() => setTab('history')} /></Row>
      </View>
      {tab === 'active' ? (
        active.loading || active.error ? <StateView loading={active.loading} error={active.error} onRetry={active.reload} /> : (
          <FlatList data={active.data!.orders} keyExtractor={(o) => o.id} contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={active.refreshing} onRefresh={active.refresh} colors={[theme.primary]} />}
            ListEmptyComponent={<StateView empty emptyIcon="cube-outline" emptyText="مفيش طلبات جارية" />}
            renderItem={({ item }) => row(item, () => router.push(`/order/${item.id}`))} />
        )
      ) : (
        hist.loading || hist.error ? <StateView loading={hist.loading} error={hist.error} onRetry={hist.reload} errorText="تعذر تحميل الطلبات، حاول مرة أخرى" /> : (
          <FlatList data={hist.items} keyExtractor={(o) => o.id} contentContainerStyle={{ padding: 16, flexGrow: 1 }} onEndReached={hist.more} onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={hist.refreshing} onRefresh={hist.refresh} colors={[theme.primary]} />}
            ListEmptyComponent={<StateView empty emptyIcon="time-outline" emptyText="لسه مفيش طلبات سابقة" />}
            ListFooterComponent={hist.loadingMore ? <ActivityIndicator color={theme.primary} style={{ margin: 16 }} /> : null}
            renderItem={({ item }) => row(item)} />
        )
      )}
    </Screen>
  );
}
