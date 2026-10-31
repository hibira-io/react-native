import type { HibiraPush, HibiraPushConfig } from './push.js';

export * from './push.js';

/** getToken and permissions for HibiraPush from an expo-notifications module. */
export function expoPushOptions(notifications: any): Pick<HibiraPushConfig, 'getToken' | 'permissions'>;

/** A HibiraPush using expo-notifications and AsyncStorage; follows token changes. */
export function createExpoPush(config: Omit<HibiraPushConfig, 'getToken' | 'permissions' | 'storage'> & {
  storage?: HibiraPushConfig['storage'];
}): HibiraPush;
