// Hibira Push for Expo: expo-notifications for the native token, and
// AsyncStorage to remember the device between launches.

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPushWith } from './expo-core.js';

export { expoPushOptions } from './expo-core.js';
export * from './push.js';

/**
 * @param {object} config HibiraPush options: instanceId (required), endpoint,
 *   bundleIdentifier, metadata; storage defaults to AsyncStorage
 */
export function createExpoPush(config) {
  return createPushWith(Notifications, config?.storage !== undefined ? config.storage : AsyncStorage, config);
}
