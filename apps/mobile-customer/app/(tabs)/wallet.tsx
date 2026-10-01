import React from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Row, Screen, StateView, T, WALLET_TX_AR, api, egp, fmtDate, theme, useApi } from '@mashawir/mobile-core';

interface Tx { id: string; type: string; amount: number; balanceAfter: number; createdAt: string; note?: string | null; orderId?: string | null }

export default function Wallet() {
  const q = useApi(() => api<{ balance: number; transactions: Tx[] }>('/v1/customer/wallet', { query: { limit: 50 } }), []);
  return (
    <Screen padded={false}>
      {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <FlatList
          data={q.data!.transactions}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} colors={[theme.primary]} />}
          ListHeaderComponent={
            <>
              <T size={22} bold style={{ marginBottom: 12 }}>المحفظة</T>
              <Card style={{ backgroundColor: theme.primary }}>
                <T color="#D1FAE5">الرصيد الحالي</T>
                <T size={32} bold color="#fff">{egp(q.data!.balance)}</T>
                <T size={13} color="#D1FAE5" style={{ marginTop: 6 }}>تقدر تدفع بالمحفظة عند تأكيد الطلب. الاستردادات ومكافآت الدعوة بتنزل هنا تلقائيًا.</T>
              </Card>
              <T bold style={{ marginVertical: 8 }}>المعاملات</T>
            </>
          }
          ListEmptyComponent={<StateView empty emptyIcon="wallet-outline" emptyText="لا توجد معاملات بعد" />}
          renderItem={({ item: t }) => (
            <Card style={{ paddingVertical: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={10}>
                  <Ionicons name={t.amount >= 0 ? 'arrow-down-circle' : 'arrow-up-circle'} size={26} color={t.amount >= 0 ? theme.success : theme.danger} />
                  <View><T bold>{WALLET_TX_AR[t.type] ?? t.type}</T><T size={12} muted>{fmtDate(t.createdAt)}</T></View>
                </Row>
                <View style={{ alignItems: 'flex-end' }}>
                  <T bold color={t.amount >= 0 ? theme.success : theme.danger}>{t.amount >= 0 ? '+' : '−'}{egp(Math.abs(t.amount))}</T>
                  <T size={12} muted>الرصيد: {egp(t.balanceAfter)}</T>
                </View>
              </Row>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
