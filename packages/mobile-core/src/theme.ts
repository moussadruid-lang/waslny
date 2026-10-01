import { Platform } from 'react-native';

export const theme = {
  primary: '#0E7C66',
  primaryDark: '#0A5E4D',
  primarySoft: '#E6F4F1',
  accent: '#F59E0B',
  bg: '#F5F6F8',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#EA580C',
  warningSoft: '#FFEDD5',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
  radius: 14,
  space: (n: number) => n * 4,
  font: Platform.select({ android: 'sans-serif', default: undefined }),
  shadow: Platform.select({
    android: { elevation: 2 },
    default: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  }) as object,
};
