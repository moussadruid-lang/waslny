import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Card, Row, STATUS_SHORT, T, egp, fmtDate, statusColor, theme } from '@mashawir/mobile-core';

export interface OrderRow {
  id: string; code: string; status: string; total: number; createdAt: string; scheduledAt?: string | null;
  stops: { type: string; formatted?: string | null; contactName?: string | null }[];
}

export function OrderCard({ o, onPress }: { o: OrderRow; onPress: () => void }) {
  const c = statusColor(o.status);
  const from = o.stops.find((s) => s.type === 'PICKUP');
  const to = o.stops.filter((s) => s.type === 'DROPOFF');
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <T bold>{o.code}</T>
        <Badge label={(STATUS_SHORT as any)[o.status] ?? o.status} fg={c.fg} bg={c.bg} />
      </Row>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <Ionicons name="ellipse" size={10} color={theme.primary} />
          <View style={{ width: 2, height: 18, backgroundColor: theme.border, marginVertical: 2 }} />
          <Ionicons name="location" size={12} color={theme.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <T numberOfLines={1}>{from?.formatted || 'نقطة الاستلام'}</T>
          <T numberOfLines={1} style={{ marginTop: 6 }}>{to.map((d) => d.contactName ? `${d.contactName} — ${d.formatted ?? ''}` : d.formatted).filter(Boolean).join(' ← ') || 'نقطة التسليم'}</T>
        </View>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <T size={13} muted>{o.scheduledAt ? `مجدول: ${fmtDate(o.scheduledAt)}` : fmtDate(o.createdAt)}</T>
        <T bold color={theme.primary}>{egp(o.total)}</T>
      </Row>
    </Card>
  );
}
