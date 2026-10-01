import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import { ApiError } from './api';

export interface LatLng { lat: number; lng: number }
/** Same bbox the API validates against. */
export const inEgypt = (p: LatLng) => p.lat >= 21 && p.lat <= 32 && p.lng >= 24 && p.lng <= 37;
export const EGYPT_CENTER = { lat: 30.0444, lng: 31.2357 };

export async function currentPosition(): Promise<LatLng> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new ApiError('PERMISSION', 'اسمح بالوصول للموقع لتحديد مكانك');
  const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
  const p = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

/** Uses the device geocoder (free, no key in the app). Returns a short Arabic-friendly label. */
export async function reverseLabel(p: LatLng): Promise<string | undefined> {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    if (!r) return undefined;
    return [r.street || r.name, r.district || r.subregion, r.city || r.region].filter(Boolean).join('، ');
  } catch { return undefined; }
}

export async function searchPlace(q: string): Promise<LatLng[]> {
  try {
    const r = await Location.geocodeAsync(`${q}, Egypt`);
    return r.map((x) => ({ lat: x.latitude, lng: x.longitude })).filter(inEgypt).slice(0, 5);
  } catch { return []; }
}

/** Hand off turn-by-turn navigation to Google Maps / Waze / Apple Maps (§67). */
export function openNavigation(p: LatLng, label?: string) {
  const url = Platform.select({
    android: `google.navigation:q=${p.lat},${p.lng}`,
    ios: `http://maps.apple.com/?daddr=${p.lat},${p.lng}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
  })!;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}${label ? `&destination_place_id=${encodeURIComponent(label)}` : ''}`));
}

export function regionFor(points: LatLng[], pad = 1.6) {
  if (!points.length) return { latitude: EGYPT_CENTER.lat, longitude: EGYPT_CENTER.lng, latitudeDelta: 8, longitudeDelta: 8 };
  const lats = points.map((p) => p.lat); const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2, latitudeDelta: Math.max(0.01, (maxLat - minLat) * pad), longitudeDelta: Math.max(0.01, (maxLng - minLng) * pad) };
}
