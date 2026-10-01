import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

/** Registers an Expo push token with the API (same channel id the server sends to: 'orders'). */
export async function registerPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', { name: 'الطلبات', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], sound: 'default' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/v1/customer/devices', { body: { pushToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  return token;
}

/**
 * Deep links from notifications: server sends e.g. "mashawir://orders/<id>" or "mashawir-driver://offers/<id>".
 * We strip the scheme and hand the path to the router.
 */
export function useNotificationRouting(navigate: (path: string) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const go = (r: Notifications.NotificationResponse | null) => {
      const link = (r?.notification.request.content.data as any)?.deepLink as string | undefined;
      if (link) navigate('/' + link.replace(/^[a-z-]+:\/\//i, ''));
    };
    Notifications.getLastNotificationResponseAsync().then(go).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [enabled, navigate]);
}
