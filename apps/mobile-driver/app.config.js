// مشاوير مندوب — driver app. Public config only (§57).
module.exports = ({ config }) => ({
  ...config,
  name: 'مشاوير مندوب',
  slug: 'mashawir-driver',
  scheme: 'mashawir-driver',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  splash: { backgroundColor: '#0E7C66', resizeMode: 'contain' },
  android: {
    package: 'eg.mashawir.driver',
    softwareKeyboardLayoutMode: 'pan',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS', 'VIBRATE'],
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
  },
  ios: {
    bundleIdentifier: 'eg.mashawir.driver',
    supportsTablet: false,
    infoPlist: { UIBackgroundModes: ['location', 'fetch'] },
    config: { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-location', {
      locationAlwaysAndWhenInUsePermission: 'مشاوير يحتاج موقعك حتى والتطبيق في الخلفية عشان توصلك الطلبات القريبة ويتابع العميل الشحنة',
      locationWhenInUsePermission: 'مشاوير يحتاج موقعك لاستقبال الطلبات',
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
    }],
    ['expo-image-picker', { cameraPermission: 'الكاميرا مطلوبة لتصوير إثبات الاستلام والتسليم والمستندات' }],
    ['expo-notifications', { color: '#0E7C66' }],
  ],
  extra: {
    supportsRTL: true,
    forcesRTL: true,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
