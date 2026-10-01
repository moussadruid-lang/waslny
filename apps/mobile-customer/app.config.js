// مشاوير — customer app. Only PUBLIC config here; no secrets (§57).
// GOOGLE_MAPS_ANDROID_KEY must be restricted in Google Cloud to package eg.mashawir.app + your signing SHA-1.
module.exports = ({ config }) => ({
  ...config,
  name: 'مشاوير',
  slug: 'mashawir',
  scheme: 'mashawir',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  splash: { backgroundColor: '#0E7C66', resizeMode: 'contain' },
  android: {
    package: 'eg.mashawir.app',
    softwareKeyboardLayoutMode: 'pan',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'],
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
  },
  ios: {
    bundleIdentifier: 'eg.mashawir.app',
    supportsTablet: false,
    config: { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-location', { locationWhenInUsePermission: 'مشاوير يحتاج موقعك لتحديد نقطة الاستلام بدقة' }],
    ['expo-image-picker', { cameraPermission: 'مشاوير يحتاج الكاميرا لتصوير الشحنة أو المكان', photosPermission: 'مشاوير يحتاج الوصول للصور لإرفاق صورة الشحنة' }],
    ['expo-notifications', { color: '#0E7C66' }],
  ],
  extra: {
    supportsRTL: true,
    forcesRTL: true,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    trackingUrl: process.env.EXPO_PUBLIC_TRACKING_URL,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
