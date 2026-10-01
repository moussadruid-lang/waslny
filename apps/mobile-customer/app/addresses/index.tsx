import React, { useCallback } from 'react';
import { Alert, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Header, Row, Screen, StateView, T, api, errMsg, theme, useApi, useToast } from '@mashawir/mobile-core';

export const LABELS: Record<string, { ar: string; icon: any }> = {
  HOME: { ar: 'البيت', icon: 'home-outline' }, WORK: { ar: 'الشغل', icon: 'briefcase-outline' },
  FAVORITE: { ar: 'مفضّل', icon: 'star-outline' }, CUSTOM: { ar: 'عنوان مخصص', icon: 'bookmark-outline' },
};

export default function Addresses() {
  const router = useRouter();
  const toast = useToast();
  const q = useApi(() => api<any[]>('/v1/customer/addresses'), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { q.refresh(); }, []));

  const remove = (id: string) => Alert.alert('حذف العنوان', 'متأكد؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: async () => {
    try { await api(`/v1/customer/addresses/${id}`, { method: 'DELETE' }); q.setData((d) => d?.filter((a) => a.id !== id)); toast.show('تم حذف العنوان'); } catch (e) { toast.show(errMsg(e), 'error'); }
  } }]);

  return (
    <Screen padded={false} edges={['top', 'bottom', 'left', 'right']} footer={<Button title="إضافة عنوان" icon="add" onPress={() => router.push('/addresses/edit')} />}>
      <Header title="عناويني" onBack={() => router.back()} />
      {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <FlatList data={q.data} keyExtractor={(a) => a.id} contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} colors={[theme.primary]} />}
          ListEmptyComponent={<StateView empty emptyIcon="location-outline" emptyText="احفظ عناوينك عشان تطلب أسرع" />}
          renderItem={({ item: a }) => (
            <Card onPress={() => router.push({ pathname: '/addresses/edit', params: { id: a.id } })}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Row gap={10} style={{ flex: 1, alignItems: 'flex-start' }}>
                  <Ionicons name={LABELS[a.label]?.icon ?? 'location-outline'} size={22} color={theme.primary} />
                  <Row gap={0} style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <T bold>{a.title || LABELS[a.label]?.ar}</T>
                    {a.formatted ? <T size={14}>{a.formatted}</T> : null}
                    {a.description ? <T size={13} muted>{a.description}</T> : null}
                    {a.landmark ? <T size={13} muted>{`علامة: ${a.landmark}`}</T> : null}
                  </Row>
                </Row>
                <Row gap={14}>
                  <Ionicons name="paper-plane-outline" size={20} color={theme.primary} onPress={() => router.push({ pathname: '/new-order', params: { pickupId: a.id } })} accessibilityLabel="اطلب من هنا" />
                  <Ionicons name="trash-outline" size={20} color={theme.danger} onPress={() => remove(a.id)} accessibilityLabel="حذف" />
                </Row>
              </Row>
            </Card>
          )} />
      )}
    </Screen>
  );
}
