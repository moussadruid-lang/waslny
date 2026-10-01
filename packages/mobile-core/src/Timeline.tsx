import React from 'react';
import { View } from 'react-native';
import { T } from './ui';
import { theme } from './theme';
import { fmtDate } from './format';
import { STATUS_AR, type OrderStatus } from './status';

export interface HistoryRow { id: string; toStatus: OrderStatus; at: string; reason?: string | null }

/** Order timeline (§16): every transition with time and reason. */
export function Timeline({ rows }: { rows: HistoryRow[] }) {
  return (
    <View>
      {rows.map((h, i) => {
        const last = i === rows.length - 1;
        return (
          <View key={h.id ?? i} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 16 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 5, backgroundColor: last ? theme.primary : theme.border }} />
              {!last && <View style={{ flex: 1, width: 2, backgroundColor: theme.border }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 14 }}>
              <T bold={last}>{STATUS_AR[h.toStatus] ?? h.toStatus}</T>
              <T size={12} muted>{fmtDate(h.at)}{h.reason ? ` — ${h.reason}` : ''}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}
