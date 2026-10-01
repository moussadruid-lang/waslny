import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip, Input, Screen, StateView, T, api, theme, usePaged } from '@mashawir/mobile-core';
import { OrderCard, type OrderRow } from '../../components/OrderCard';

const GROUPS = [
  { k: 'current', l: 'الحالية' }, { k: 'completed', l: 'المكتملة' }, { k: 'cancelled', l: 'الملغاة' },
  { k: 'failed', l: 'الفاشلة' }, { k: 'returned', l: 'المرتجعة' }, { k: 'all', l: 'الكل' },
];

export default function MyOrders() {
  const router = useRouter();
  const [group, setGroup] = useState('current');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 400); return () => clearTimeout(t); }, [text]);

  const fetchPage = useCallback((cursor?: string | null) =>
    api<{ items: OrderRow[]; nextCursor: string | null }>('/v1/customer/orders', { query: { group: group === 'all' ? undefined : group, q, cursor, limit: 20 } }), [group, q]);
  const p = usePaged(fetchPage, [fetchPage]);

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <T size={22} bold style={{ marginBottom: 10 }}>طلباتي</T>
        <Input value={text} onChangeText={setText} placeholder="ابحث برقم الطلب أو اسم المستلم" returnKeyType="search" />
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {GROUPS.map((g) => <Chip key={g.k} label={g.l} selected={group === g.k} onPress={() => setGroup(g.k)} />)}
        </ScrollView>
      </View>
      {p.loading || p.error ? (
        <StateView loading={p.loading} error={p.error} onRetry={p.reload} errorText="تعذر تحميل الطلبات، حاول مرة أخرى" />
      ) : (
        <FlatList
          data={p.items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, flexGrow: 1 }}
          renderItem={({ item }) => <OrderCard o={item} onPress={() => router.push(`/orders/${item.id}`)} />}
          onEndReached={p.more}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={p.refresh} colors={[theme.primary]} />}
          ListEmptyComponent={<StateView empty emptyIcon="receipt-outline" emptyText={q ? 'لا توجد نتائج للبحث' : 'لا توجد طلبات هنا بعد'} />}
          ListFooterComponent={p.loadingMore ? <ActivityIndicator color={theme.primary} style={{ margin: 16 }} /> : null}
        />
      )}
    </Screen>
  );
}
