import '../src/tracking'; // registers the background location task at startup (required by TaskManager)
import React, { useCallback, useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, BrandSplash, OfflineBanner, ToastProvider, ensureRTL, registerPush, theme, useAuth, useNotificationRouting } from '@mashawir/mobile-core';
import { startQueueSync } from '../src/offlineQueue';

ensureRTL();

function Gate() {
  const { status } = useAuth();
  const seg = useSegments();
  const router = useRouter();
  const inLogin = seg[0] === 'login';
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'out' && !inLogin) router.replace('/login');
    else if (status === 'in' && inLogin) router.replace('/');
  }, [status, inLogin, router]);
  useEffect(() => { if (status === 'in') { registerPush().catch(() => {}); startQueueSync(); } }, [status]);
  const nav = useCallback((p: string) => router.push((p.startsWith('/offers') ? '/' : p) as any), [router]);
  useNotificationRouting(nav, status === 'in');
  if (status === 'loading' || (status === 'out' && !inLogin)) return <BrandSplash subtitle="تطبيق المندوب" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Gate />
          <OfflineBanner />
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
