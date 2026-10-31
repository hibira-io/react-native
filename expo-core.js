// Wiring between expo-notifications and HibiraPush, with the module passed
// in so it can be tested without a phone. ./expo.js passes the real one.

import { HibiraPush } from './push.js';

const PLATFORM = { android: 'fcm', ios: 'apns' };

/** HibiraPush options that use expo-notifications for the token and permission. */
export function expoPushOptions(Notifications) {
  return {
    getToken: async () => {
      const t = await Notifications.getDevicePushTokenAsync();
      const platform = PLATFORM[t?.type];
      if (!platform) throw new Error(`Hibira Push: no native push token on "${t?.type}"; use @hibira-io/push-web in browsers`);
      return { platform, token: String(t.data) };
    },
    permissions: {
      get: async () => (await Notifications.getPermissionsAsync()).status,
      request: async () => (await Notifications.requestPermissionsAsync()).status,
    },
  };
}

/**
 * A HibiraPush that gets the native FCM / APNs token from expo-notifications,
 * asks for permission on start(), and follows token changes.
 * Note: this is the device token (getDevicePushTokenAsync), not an Expo push
 * token; Hibira delivers through FCM and APNs directly.
 */
export function createPushWith(Notifications, storage, config = {}) {
  const push = new HibiraPush({ storage, ...expoPushOptions(Notifications), ...config });
  const sub = Notifications.addPushTokenListener?.((t) => {
    if (t?.data) push.updateToken(String(t.data)).catch(() => {});
  });
  push.dispose = () => sub?.remove?.();
  return push;
}
