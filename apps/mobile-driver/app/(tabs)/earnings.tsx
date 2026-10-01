import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Chip, Row, Screen, StateView, T, WALLET_TX_AR, api, egp, fmtDate, theme, useApi } from '@mashawir/mobile-core';

interface Earnings { balance: number; owesPlatform: number; cashCollected: number; earnings: number; commission: number; deliveries: number; settlements: number; transactions: { id: string; type: string; amount: number; createdAt: string }[] }
const PERIODS = [{ k: 1, l: 'اليوم' }, { k: 7, l: '7 أيام' }, { k: 30, l: '30 يوم' }];

/** Driver finance (§36): cash collected, owed to platform, commission, net earnings, settlements. */
export default function EarningsScreen() {
  const [days, setDays] = useState(7);
  const from = useMemo(() => { const d = new Date(); if (days === 1) d.setHours(0, 0, 0, 0); else d.setDate(d.getDate() - days); return d.toISOString(); }, [days]);
  const q = useApi(() => api<Earnings>('/v1/driver/earnings', { query: { from } }), [from]);
  const e = q.data;
  const Stat = ({ icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) => (
    <View style={{ width: '50%', padding: 6 }}>
      <Card style={{ marginBottom: 0 }}>
        <Ionicons name={icon} size={22} color={color ?? theme.primary} />
        <T size={13} muted style={{ marginTop: 4 }}>{label}</T>
        <T bold size={17} color={color}>{value}</T>
      </Card>
    </View>
  );
  return (
    <Screen scroll refreshing={q.refreshing} onRefresh={q.refresh}>
      <T size={22} bold style={{ marginBottom: 10 }}>الأرباح</T>
      <Row>{PERIODS.map((p) => <Chip key={p.k} label={p.l} selected={days === p.k} onPress={() => setDays(p.k)} />)}</Row>
      {q.loading || q.error || !e ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <>
          <Card style={{ backgroundColor: theme.primary }}>
            <T color="#D1FAE5">صافي أرباحك في الفترة</T>
            <T size={30} bold color="#fff">{egp(e.earnings)}</T>
            <T color="#D1FAE5">{`${e.deliveries} توصيلة`}</T>
          </Card>
          {e.owesPlatform > 0 && (
            <Card style={{ backgroundColor: theme.warningSoft }}>
              <T bold color={theme.warning}>{`مستحق لمشاوير: ${egp(e.owesPlatform)}`}</T>
              <T size={13}>ده الفرق بين الكاش اللي حصّلته وأرباحك. سوّيه مع التشغيل عشان حسابك يفضل مفعّل.</T>
            </Card>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 12 }}>
            <Stat icon="cash-outline" label="نقدية محصّلة" value={egp(e.cashCollected)} />
            <Stat icon="pie-chart-outline" label="عمولة مشاوير" value={egp(e.commission)} />
            <Stat icon="swap-horizontal-outline" label="التسويات" value={egp(e.settlements)} />
            <Stat icon="wallet-outline" label="رصيد المحفظة" value={egp(e.balance)} color={e.balance < 0 ? theme.danger : theme.success} />
          </View>
          <T bold style={{ marginBottom: 8 }}>الحركات</T>
          {e.transactions.length === 0 ? <StateView empty emptyIcon="receipt-outline" emptyText="مفيش حركات في الفترة دي" /> : e.transactions.map((t) => (
            <Card key={t.id} style={{ paddingVertical: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View><T bold>{WALLET_TX_AR[t.type] ?? t.type}</T><T size={12} muted>{fmtDate(t.createdAt)}</T></View>
                <T bold color={t.amount >= 0 ? theme.success : theme.danger}>{`${t.amount >= 0 ? '+' : '−'}${egp(Math.abs(t.amount))}`}</T>
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
