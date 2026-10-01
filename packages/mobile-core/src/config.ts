import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

/** Public, non-secret runtime config. Secrets never live in the apps (§57). */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'http://10.0.2.2:4000').replace(/\/$/, '');
export const TRACKING_URL: string = (process.env.EXPO_PUBLIC_TRACKING_URL || extra.trackingUrl || 'http://localhost:3000/track').replace(/\/$/, '');
export const APP_NAME = 'مشاوير';
export const APP_TAGLINE = 'نوصلها لك';
