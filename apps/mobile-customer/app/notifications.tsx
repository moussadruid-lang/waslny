import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header, Row, Screen, StateView, T, api, fmtDate, theme, usePaged } from '@mashawir/mobile-core';

interface N { id: string; type: string; titleAr: string; bodyAr: string; deepLink?: string | null; readAt?: string | null; createdAt: string }

export default function Notifications() {
  const router = useRouter();
  const fetchPage = useCallback((cursor?: string | null) => api<{ items: N[]; nextCursor: string | null }>('/v1/customer/notifications', { query: { cursor, limit: 30 } }), []);
  const p = usePaged(fetchPage, [fetchPage]);
  // Opening the screen marks everything as read (history stays).
  useEffect(() => { if (!p.loading && p.items.some((n) => !n.readAt)) api('/v1/customer/notifications/read', { body: {} }).catch(() => {}); }, [p.loading, p.items]);

  const open = (n: N) => { if (n.deepLink) router.push(('/' + n.deepLink.replace(/^[a-z-]+:\/\//i, '')) as any); };
  const icon = (t: string): any => (t.includes('DELIVERED') ? 'checkmark-circle' : t.includes('CANCEL') || t.includes('FAILED') ? 'alert-circle' : t.includes('ASSIGNED') ? 'person' : 'notifications');

  return (
    <Screen padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <Header title="الإشعارات" onBack={() => router.back()} />
      {p.loading || p.error ? <StateView loading={p.loading} error={p.error} onRetry={p.reload} /> : (
        <FlatList data={p.items} keyExtractor={(n) => n.id} onEndReached={p.more} onEndReachedThreshold={0.4} contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={p.refresh} colors={[theme.primary]} />}
          ListEmptyComponent={<StateView empty emptyIcon="notifications-off-outline" emptyText="مفيش إشعارات لسه" />}
          ListFooterComponent={p.loadingMore ? <ActivityIndicator color={theme.primary} style={{ margin: 16 }} /> : null}
          renderItem={({ item: n }) => (
            <Pressable onPress={() => open(n)} style={{ padding: 16, backgroundColor: n.readAt ? 'transparent' : theme.primarySoft, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Row gap={12} style={{ alignItems: 'flex-start' }}>
                <Ionicons name={icon(n.type)} size={24} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <T bold>{n.titleAr}</T>
                  <T>{n.bodyAr}</T>
                  <T size={12} muted style={{ marginTop: 2 }}>{fmtDate(n.createdAt)}</T>
                </View>
              </Row>
            </Pressable>
          )} />
      )}
    </Screen>
  );
}
