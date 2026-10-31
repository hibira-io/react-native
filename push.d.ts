export const DEFAULT_ENDPOINT: 'https://ws.hibira.io';
export const PLATFORMS: ReadonlyArray<'fcm' | 'apns'>;

export type PushPlatform = 'fcm' | 'apns';
export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | string;

export const RegistrationState: Readonly<{
  PERMISSION_PROMPT_REQUIRED: 'PERMISSION_PROMPT_REQUIRED';
  PERMISSION_GRANTED_NOT_REGISTERED: 'PERMISSION_GRANTED_NOT_REGISTERED';
  PERMISSION_GRANTED_REGISTERED: 'PERMISSION_GRANTED_REGISTERED';
  PERMISSION_DENIED: 'PERMISSION_DENIED';
}>;
export type RegistrationStateValue = (typeof RegistrationState)[keyof typeof RegistrationState];

export class PushError extends Error {
  /** HTTP status; 0 when the request never got an answer from the server. */
  status: number;
  error: string;
  description?: string;
}

/** AsyncStorage, or anything with the same three methods. */
export interface PushStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export interface PushTokenProvider {
  fetchToken(userId: string): Promise<{ token: string }>;
}

/** GET url?user_id=... on your backend, which answers {"token": "..."}. */
export class TokenProvider implements PushTokenProvider {
  constructor(options: {
    url: string;
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    queryParams?: Record<string, string>;
    fetch?: typeof fetch;
  });
  fetchToken(userId: string): Promise<{ token: string }>;
}

export interface HibiraPushConfig {
  /** Push instance ID from the Hibira portal. */
  instanceId: string;
  /** The device's native token: FCM on Android, APNs (hex) on iOS. */
  getToken: () => Promise<{ platform: PushPlatform; token: string }>;
  /** Keeps the device id between launches. */
  storage?: PushStorage | null;
  /** Default https://ws.hibira.io. */
  endpoint?: string;
  /** iOS bundle id, the APNs topic; default the one set on the instance. */
  bundleIdentifier?: string;
  permissions?: { get(): Promise<PermissionStatus>; request(): Promise<PermissionStatus> };
  metadata?: Record<string, string>;
  fetch?: typeof fetch;
}

export class HibiraPush {
  constructor(config: HibiraPushConfig);
  readonly instanceId: string;
  /** Asks for permission (when set up), registers once and refreshes the token; resolves to the device ID. */
  start(): Promise<string>;
  /** Sends a new native token. */
  updateToken(token: string): Promise<void>;
  getDeviceId(): Promise<string | null>;
  getUserId(): Promise<string | null>;
  getRegistrationState(): Promise<RegistrationStateValue>;
  onChange(fn: (deviceId: string | null) => void): () => void;
  addDeviceInterest(interest: string): Promise<void>;
  removeDeviceInterest(interest: string): Promise<void>;
  getDeviceInterests(): Promise<string[]>;
  setDeviceInterests(interests: string[]): Promise<void>;
  clearDeviceInterests(): Promise<void>;
  /** Links the device to a user; the user cannot change until stop(). */
  setUserId(userId: string, tokenProvider: PushTokenProvider): Promise<void>;
  /** Deletes the device (sign out). */
  stop(): Promise<void>;
  clearAllState(): Promise<string>;
  /** Set by createExpoPush: stops following token changes. */
  dispose?: () => void;
}

export interface UseHibiraPushOptions {
  /** Keep the device's interests equal to these. */
  interests?: string[];
  /** Link this user (needs tokenProvider). */
  userId?: string | null;
  tokenProvider?: PushTokenProvider;
  /** Default true; false waits (e.g. until after onboarding). */
  enabled?: boolean;
}

export function useHibiraPush(
  push: HibiraPush | null | undefined,
  options?: UseHibiraPushOptions,
): { deviceId: string | null; error: Error | null; ready: boolean };
