import { I18nManager } from 'react-native';

/** Arabic-first: force RTL. The native flag is also set via app config (extra.supportsRTL/forcesRTL). */
export function ensureRTL() {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
}
