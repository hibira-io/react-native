import type { HibiraPush, HibiraPushConfig, PushStorage } from './push.js';
export function expoPushOptions(notifications: any): Pick<HibiraPushConfig, 'getToken' | 'permissions'>;
export function createPushWith(notifications: any, storage: PushStorage | null, config: Partial<HibiraPushConfig>): HibiraPush;
