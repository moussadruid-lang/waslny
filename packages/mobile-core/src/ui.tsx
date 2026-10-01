import React from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type TextStyle, type ViewStyle, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from './theme';
import { useOnline } from './hooks';
import { APP_NAME, APP_TAGLINE } from './config';
import type { ApiError } from './api';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Every screen sits inside the safe area: never under the status bar, notch, camera or nav bar (§6). */
export function Screen({ children, scroll, edges = ['top', 'left', 'right'], refreshing, onRefresh, padded = true, style, keyboard }: {
  children: React.ReactNode; scroll?: boolean; edges?: Edge[]; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; style?: ViewStyle; keyboard?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[padded && { padding: 16 }, { paddingBottom: 24 + (edges.includes('bottom') ? 0 : insets.bottom * 0) }]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[theme.primary]} /> : undefined}>
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, padded && { padding: 16 }]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.bg }, style]}>
      {keyboard ? <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{body}</KeyboardAvoidingView> : body}
    </SafeAreaView>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {onBack ? <Pressable hitSlop={12} onPress={onBack} accessibilityLabel="رجوع" style={s.headerBtn}><Ionicons name="arrow-forward" size={24} color={theme.text} /></Pressable> : <View style={s.headerBtn} />}
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={[s.headerBtn, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function T({ children, style, muted, bold, size = 15, center, numberOfLines, color }: {
  children: React.ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean; bold?: boolean; size?: number; center?: boolean; numberOfLines?: number; color?: string;
}) {
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: size, color: color ?? (muted ? theme.muted : theme.text), fontWeight: bold ? '700' : '400', textAlign: center ? 'center' : 'left', writingDirection: 'rtl', lineHeight: size * 1.45 }, style as any]}>{children}</Text>;
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  const c = <View style={[s.card, style as any]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{c}</Pressable> : c;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, small }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'; loading?: boolean; disabled?: boolean; icon?: IconName; style?: ViewStyle; small?: boolean;
}) {
  const bg = { primary: theme.primary, secondary: theme.primarySoft, danger: theme.danger, ghost: 'transparent', success: theme.success }[variant];
  const fg = variant === 'secondary' || variant === 'ghost' ? theme.primary : '#fff';
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" disabled={off} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.85 : 1 }, variant === 'ghost' && { borderWidth: 1, borderColor: theme.border }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={s.row}>
          {icon && <Ionicons name={icon} size={small ? 16 : 20} color={fg} style={{ marginEnd: 8 }} />}
          <Text style={{ color: fg, fontSize: small ? 14 : 16, fontWeight: '700' }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Input({ label, error, hint, style, ...p }: TextInputProps & { label?: string; error?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label && <T size={13} muted style={{ marginBottom: 6 }}>{label}</T>}
      <TextInput placeholderTextColor="#9CA3AF" {...p}
        style={[s.input, p.multiline && { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 }, error ? { borderColor: theme.danger } : null, style]} />
      {error ? <T size={12} color={theme.danger} style={{ marginTop: 4 }}>{error}</T> : hint ? <T size={12} muted style={{ marginTop: 4 }}>{hint}</T> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && { backgroundColor: theme.primary, borderColor: theme.primary }]}>
      {icon && <Ionicons name={icon} size={15} color={selected ? '#fff' : theme.text} style={{ marginEnd: 6 }} />}
      <Text style={{ color: selected ? '#fff' : theme.text, fontSize: 14, fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text></View>;
}

export function Row({ children, style, gap = 8 }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[s.row, { gap }, style]}>{children}</View>;
}
export const Divider = () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 12 }} />;
export const Spacer = ({ h = 12 }: { h?: number }) => <View style={{ height: h }} />;

export function ListItem({ icon, title, subtitle, onPress, right, danger }: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.listItem, pressed && { backgroundColor: '#F9FAFB' }]}>
      {icon && <View style={[s.iconWrap, danger && { backgroundColor: theme.dangerSoft }]}><Ionicons name={icon} size={20} color={danger ? theme.danger : theme.primary} /></View>}
      <View style={{ flex: 1 }}>
        <T bold color={danger ? theme.danger : undefined}>{title}</T>
        {subtitle ? <T size={13} muted numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-back" size={18} color={theme.muted} /> : null)}
    </Pressable>
  );
}

/** Loading / Empty / Error / Offline / Timeout + Retry in one place (§61). */
export function StateView({ loading, error, empty, emptyText = 'لا توجد بيانات بعد', emptyIcon = 'file-tray-outline', onRetry, errorText }: {
  loading?: boolean; error?: ApiError | null; empty?: boolean; emptyText?: string; emptyIcon?: IconName; onRetry?: () => void; errorText?: string;
}) {
  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={theme.primary} /></View>;
  if (error) {
    const icon: IconName = error.code === 'OFFLINE' ? 'cloud-offline-outline' : error.code === 'TIMEOUT' ? 'time-outline' : 'alert-circle-outline';
    return (
      <View style={s.center}>
        <Ionicons name={icon} size={48} color={theme.muted} />
        <T center muted style={{ marginVertical: 12 }}>{errorText ?? error.message}</T>
        {onRetry && <Button title="إعادة المحاولة" icon="refresh" variant="secondary" onPress={onRetry} small />}
      </View>
    );
  }
  if (empty) return <View style={s.center}><Ionicons name={emptyIcon} size={48} color={theme.border} /><T center muted style={{ marginTop: 12 }}>{emptyText}</T></View>;
  return null;
}

export function OfflineBanner() {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[s.offline, { paddingTop: insets.top + 4 }]}>
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 13, marginStart: 6 }}>لا يوجد اتصال بالإنترنت</Text>
    </View>
  );
}

/** JS splash with the brand (native splash shows the brand color first). */
export function BrandSplash({ subtitle }: { subtitle?: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
      <View style={s.logo}><Ionicons name="bicycle" size={44} color={theme.primary} /></View>
      <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 16 }}>{APP_NAME}</Text>
      <Text style={{ color: '#D1FAE5', fontSize: 18, marginTop: 4 }}>{subtitle ?? APP_TAGLINE}</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: 32 }} />
    </SafeAreaView>
  );
}

export function Stars({ value, onChange, size = 32 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <Row gap={6} style={{ justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(n)} hitSlop={6}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={theme.accent} />
        </Pressable>
      ))}
    </Row>
  );
}

export function KV({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) {
  return <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T muted={!bold} bold={bold}>{k}</T>{typeof v === 'string' ? <T bold={bold}>{v}</T> : v}</Row>;
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.bg },
  headerBtn: { width: 44, height: 36, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: theme.text },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 16, marginBottom: 12, ...theme.shadow },
  btn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnSmall: { height: 40, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 16, color: theme.text, backgroundColor: '#fff', textAlign: 'right', writingDirection: 'rtl' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: '#fff', marginEnd: 8, marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 240 },
  offline: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, backgroundColor: '#374151', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 6 },
  logo: { width: 88, height: 88, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
