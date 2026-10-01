import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from './theme';

type Kind = 'success' | 'error' | 'info';
const Ctx = createContext<{ show: (msg: string, kind?: Kind) => void }>({ show: () => {} });

/** Clear feedback after every action (§78). Rendered inside the safe area, never under the status bar. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ text: string; kind: Kind } | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((text: string, kind: Kind = 'success') => {
    setMsg({ text, kind });
    Animated.timing(op, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMsg(null)), 2800);
  }, [op]);
  const bg = msg?.kind === 'error' ? theme.danger : msg?.kind === 'info' ? theme.info : theme.success;
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg && (
        <Animated.View pointerEvents="none" style={[s.wrap, { top: insets.top + 8, opacity: op }]}>
          <View style={[s.toast, { backgroundColor: bg }]}><Text style={s.text}>{msg.text}</Text></View>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000 },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, maxWidth: 520, ...theme.shadow },
  text: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
