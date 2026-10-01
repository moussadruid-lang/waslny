import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, api, tokens } from '@mashawir/mobile-core';

/**
 * GPS pipeline for drivers:
 *  - Background task (Android foreground service) keeps sending while the app is minimized.
 *  - Points are buffered on disk when offline and uploaded in one batch (API accepts up to 200).
 *  - The server flags impossible jumps (fraud) and fans out to the order/tracking rooms.
 */
export const LOCATION_TASK = 'mashawir-driver-location';
const BUF = 'msh.driver.locbuf';

interface Pt { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number; at: string }
const toPt = (l: Location.LocationObject): Pt => ({
  lat: l.coords.latitude, lng: l.coords.longitude, at: new Date(l.timestamp).toISOString(),
  ...(l.coords.heading != null && l.coords.heading >= 0 ? { heading: l.coords.heading } : {}),
  ...(l.coords.speed != null && l.coords.speed >= 0 ? { speed: l.coords.speed } : {}),
  ...(l.coords.accuracy != null ? { accuracy: l.coords.accuracy } : {}),
});

let sending = false;
export async function pushPoints(points: Pt[]) {
  let prev: Pt[] = [];
  try { prev = JSON.parse((await AsyncStorage.getItem(BUF)) ?? '[]'); } catch { prev = []; }
  const all = [...prev, ...points].slice(-200);
  if (sending) { await AsyncStorage.setItem(BUF, JSON.stringify(all)); return; }
  sending = true;
  try {
    if (!tokens.access) await tokens.load(); // headless JS after the app was killed
    await api('/v1/driver/location', { body: all });
    await AsyncStorage.removeItem(BUF);
  } catch (e) {
    // Keep the buffer only for network problems; drop data the server rejected so we don't loop forever.
    if (e instanceof ApiError && e.isNetwork) await AsyncStorage.setItem(BUF, JSON.stringify(all));
    else await AsyncStorage.removeItem(BUF);
  } finally { sending = false; }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locs = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (locs?.length) await pushPoints(locs.map(toPt));
});

let fgSub: Location.LocationSubscription | null = null;

export async function startTracking(): Promise<'background' | 'foreground'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new ApiError('PERMISSION', 'لازم تسمح بالوصول للموقع عشان تستقبل طلبات');
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
  if (bg.status === 'granted') {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
    if (!started) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25, deferredUpdatesInterval: 10_000,
        pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, activityType: Location.ActivityType.AutomotiveNavigation,
        foregroundService: { notificationTitle: 'مشاوير — أنت متاح', notificationBody: 'بنشارك موقعك عشان توصلك الطلبات القريبة', notificationColor: '#0E7C66', killServiceOnDestroy: false },
      });
    }
    return 'background';
  }
  // Fallback: foreground-only tracking while the app is open.
  fgSub?.remove();
  fgSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25 }, (l) => { pushPoints([toPt(l)]); });
  return 'foreground';
}

export async function stopTracking() {
  fgSub?.remove(); fgSub = null;
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
}

/** Fresh fix right now (dispatch only offers to drivers with recent GPS). */
export async function sendLocationNow() {
  const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  await pushPoints([toPt(l)]);
  return { lat: l.coords.latitude, lng: l.coords.longitude };
}

/** Position for a status/proof action. Falls back to the last known fix when GPS is slow. */
export async function actionPosition(): Promise<{ lat: number; lng: number }> {
  try {
    const l = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    if (l) return { lat: l.coords.latitude, lng: l.coords.longitude };
  } catch { /* fall through */ }
  const last = await Location.getLastKnownPositionAsync();
  if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
  throw new ApiError('NO_GPS', 'تعذر تحديد موقعك، شغّل الـ GPS وحاول تاني');
}
