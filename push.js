// Hibira Push for React Native: registers the device's FCM (Android) or APNs
// (iOS) token with Hibira's Beams-compatible device API, and manages its
// interests and user. It speaks the same API as hibira-push-android and
// hibira-push-ios, over fetch, so any way of getting the native token works:
// expo-notifications (see ./expo.js), @react-native-firebase/messaging, or
// your own native module.
//
// The device id is kept in `storage` (AsyncStorage or anything with the same
// getItem/setItem/removeItem), so an app registers once, not on every launch.

import { useEffect, useRef, useState } from 'react';
import { SDK_VERSION } from './version.js';

export const DEFAULT_ENDPOINT = 'https://ws.hibira.io';
export const PLATFORMS = ['fcm', 'apns'];

const INTEREST_RE = /^[A-Za-z0-9_\-=@,.;]+$/;
const MAX_INTEREST_LENGTH = 164;
const MAX_INTERESTS = 5000;

export const RegistrationState = Object.freeze({
  PERMISSION_PROMPT_REQUIRED: 'PERMISSION_PROMPT_REQUIRED',
  PERMISSION_GRANTED_NOT_REGISTERED: 'PERMISSION_GRANTED_NOT_REGISTERED',
  PERMISSION_GRANTED_REGISTERED: 'PERMISSION_GRANTED_REGISTERED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
});

export class PushError extends Error {
  constructor(status, error, description) {
    super(`Hibira Push ${status}: ${error}${description ? `, ${description}` : ''}`);
    this.name = 'PushError';
    this.status = status;
    this.error = error;
    this.description = description;
  }
}

/** Fetches a Beams token for a user from your backend: GET url?user_id=... → {"token": "..."} */
export class TokenProvider {
  constructor({ url, headers, queryParams, fetch: f } = {}) {
    if (!url) throw new Error('TokenProvider: url is required');
    this.url = url;
    this.headers = headers;
    this.queryParams = queryParams;
    this._fetch = f;
  }

  async fetchToken(userId) {
    const headers = typeof this.headers === 'function' ? await this.headers() : this.headers;
    const query = new URLSearchParams({ user_id: userId, ...this.queryParams }).toString();
    const sep = this.url.includes('?') ? '&' : '?';
    const res = await (this._fetch ?? globalThis.fetch)(`${this.url}${sep}${query}`, { headers });
    if (!res.ok) throw new PushError(res.status, 'TokenProviderFailed', `${this.url} answered ${res.status}`);
    const body = await res.json();
    if (!body || typeof body.token !== 'string') throw new Error('TokenProvider: response has no "token"');
    return body;
  }
}

export class HibiraPush {
  /**
   * @param {object} config
   * @param {string} config.instanceId Push instance ID from the Hibira portal
   * @param {() => Promise<{platform: 'fcm'|'apns', token: string}>} config.getToken
   * @param {object} [config.storage] AsyncStorage-like store; without it the
   *   device is registered again on every launch
   * @param {string} [config.endpoint] default https://ws.hibira.io
   * @param {string} [config.bundleIdentifier] iOS bundle id (APNs topic);
   *   default the one set on the instance
   * @param {object} [config.permissions] { get(), request() } returning
   *   'granted' | 'denied' | 'undetermined'
   * @param {object} [config.metadata] extra device metadata (strings)
   */
  constructor({ instanceId, getToken, storage = null, endpoint = DEFAULT_ENDPOINT, bundleIdentifier, permissions, metadata, fetch: f } = {}) {
    if (typeof instanceId !== 'string' || !instanceId) throw new Error('HibiraPush: instanceId is required');
    if (typeof getToken !== 'function') throw new Error('HibiraPush: getToken is required');
    if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) {
      throw new Error('HibiraPush: endpoint must be an http(s) URL, for example https://ws.hibira.io');
    }
    this.instanceId = instanceId;
    this._getToken = getToken;
    this._storage = storage;
    this._endpoint = endpoint.replace(/\/+$/, '');
    this._bundleId = bundleIdentifier;
    this._permissions = permissions;
    this._metadata = metadata;
    this._fetch = f;
    this._state = null; // { deviceId, platform, token, userId, previous: [] }
    this._loaded = null;
    this._queue = Promise.resolve();
    this._listeners = new Set();
  }

  get _key() {
    return `hibira-push:${this.instanceId}`;
  }

  /** Device ID once registered, else null. */
  async getDeviceId() {
    await this._load();
    return this._state?.deviceId ?? null;
  }

  async getUserId() {
    await this._load();
    return this._state?.userId ?? null;
  }

  async getRegistrationState() {
    await this._load();
    const p = this._permissions ? await this._permissions.get() : 'granted';
    if (p === 'denied') return RegistrationState.PERMISSION_DENIED;
    if (p !== 'granted') return RegistrationState.PERMISSION_PROMPT_REQUIRED;
    return this._state?.deviceId ? RegistrationState.PERMISSION_GRANTED_REGISTERED : RegistrationState.PERMISSION_GRANTED_NOT_REGISTERED;
  }

  /** Calls fn(deviceId | null) when the registration changes. Returns an unsubscribe function. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Asks for permission when a `permissions` helper is set, gets the native
   * token and registers the device (once; later calls only refresh the token).
   * Resolves to the device ID.
   */
  start() {
    return this._serial(async () => {
      await this._load();
      if (this._permissions) {
        let p = await this._permissions.get();
        if (p !== 'granted' && p !== 'denied') p = await this._permissions.request();
        if (p !== 'granted') throw new PushError(0, 'PermissionDenied', 'notification permission was not granted');
      }
      const { platform, token } = await this._token();
      const s = this._state;
      if (s?.deviceId && s.platform === platform) {
        if (s.token !== token) await this._setToken(token);
        return s.deviceId;
      }
      return this._register(platform, token);
    });
  }

  /** Sends a new native token (expo-notifications' addPushTokenListener, FCM onTokenRefresh). */
  updateToken(token) {
    return this._serial(async () => {
      await this._load();
      if (!this._state?.deviceId || this._state.token === token) return;
      await this._setToken(token);
    });
  }

  addDeviceInterest(interest) {
    validateInterest(interest);
    return this._deviceCall('POST', `/interests/${encodeURIComponent(interest)}`);
  }

  removeDeviceInterest(interest) {
    validateInterest(interest);
    return this._deviceCall('DELETE', `/interests/${encodeURIComponent(interest)}`);
  }

  async getDeviceInterests() {
    const body = await this._deviceCall('GET', '/interests');
    return body?.interests ?? [];
  }

  setDeviceInterests(interests) {
    if (!Array.isArray(interests)) throw new TypeError('setDeviceInterests: interests must be an array');
    if (interests.length > MAX_INTERESTS) throw new RangeError(`setDeviceInterests: at most ${MAX_INTERESTS} interests`);
    interests.forEach(validateInterest);
    return this._deviceCall('PUT', '/interests', { interests: [...new Set(interests)] });
  }

  clearDeviceInterests() {
    return this.setDeviceInterests([]);
  }

  /**
   * Links the device to a user of your app, so the server can publish to
   * them by user ID. `tokenProvider.fetchToken(userId)` returns { token }
   * from your backend (generateToken() of a Beams server SDK).
   */
  setUserId(userId, tokenProvider) {
    if (typeof userId !== 'string' || !userId) throw new Error('setUserId: userId must be a non-empty string');
    if (!tokenProvider || typeof tokenProvider.fetchToken !== 'function') throw new Error('setUserId: tokenProvider is required');
    return this._serial(async () => {
      await this._load();
      this._requireStarted('setUserId');
      if (this._state.userId === userId) return;
      if (this._state.userId) throw new Error('setUserId: the user cannot change; call stop() (sign out) first');
      const { token } = await tokenProvider.fetchToken(userId);
      await this._deviceRequest('PUT', '/user', undefined, { Authorization: `Bearer ${token}` });
      await this._save({ ...this._state, userId });
    });
  }

  /** Deletes the device from Hibira Push (call it on sign out). */
  stop() {
    return this._serial(async () => {
      await this._load();
      const s = this._state;
      if (!s?.deviceId) return;
      try {
        await this._request('DELETE', this._devicePath(s), undefined);
      } catch (e) {
        if (!isGone(e)) throw e;
      }
      await this._save({ previous: [s.deviceId, ...(s.previous ?? [])].slice(0, 10) });
    });
  }

  /** stop() then start(): a new device with no interests and no user. */
  async clearAllState() {
    await this.stop();
    return this.start();
  }

  // --- internals

  _serial(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _load() {
    if (!this._loaded) {
      this._loaded = (async () => {
        if (!this._storage) return;
        try {
          const raw = await this._storage.getItem(this._key);
          if (raw) this._state = JSON.parse(raw);
        } catch {
          this._state = null;
        }
      })();
    }
    return this._loaded;
  }

  async _save(state) {
    const before = this._state?.deviceId ?? null;
    this._state = state;
    if (this._storage) await this._storage.setItem(this._key, JSON.stringify(state));
    const after = state?.deviceId ?? null;
    if (before !== after) for (const fn of this._listeners) fn(after);
  }

  async _token() {
    const t = await this._getToken();
    if (!t || !PLATFORMS.includes(t.platform) || typeof t.token !== 'string' || !t.token) {
      throw new Error('HibiraPush: getToken must return { platform: "fcm" | "apns", token }');
    }
    return t;
  }

  async _register(platform, token) {
    const previous = this._state?.previous ?? [];
    const body = {
      token,
      knownPreviousClientIds: previous,
      metadata: { sdkVersion: SDK_VERSION, sdk: 'react-native', ...this._metadata },
    };
    if (platform === 'apns' && this._bundleId) body.bundleIdentifier = this._bundleId;
    const res = await this._request('POST', `/device_api/v1/instances/${encodeURIComponent(this.instanceId)}/devices/${platform}`, body);
    if (!res?.id) throw new PushError(0, 'BadResponse', 'register returned no device id');
    await this._save({ deviceId: res.id, platform, token, userId: null, previous });
    return res.id;
  }

  async _setToken(token) {
    try {
      await this._request('PUT', `${this._devicePath(this._state)}/token`, { token });
      await this._save({ ...this._state, token });
    } catch (e) {
      if (!isGone(e)) throw e;
      await this._register(this._state.platform, token);
    }
  }

  _devicePath(s) {
    return `/device_api/v1/instances/${encodeURIComponent(this.instanceId)}/devices/${s.platform}/${encodeURIComponent(s.deviceId)}`;
  }

  _requireStarted(what) {
    if (!this._state?.deviceId) throw new Error(`${what}: the device is not registered; call start() first`);
  }

  _deviceCall(method, suffix, body) {
    return this._serial(async () => {
      await this._load();
      this._requireStarted('Hibira Push');
      return this._deviceRequest(method, suffix, body);
    });
  }

  // A device the server no longer knows (deleted from the console, or the
  // user was deleted) is registered again, once, and the call retried.
  async _deviceRequest(method, suffix, body, headers) {
    try {
      return await this._request(method, this._devicePath(this._state) + suffix, body, headers);
    } catch (e) {
      if (!isGone(e)) throw e;
      const { platform, token } = this._state;
      await this._save({ previous: [this._state.deviceId, ...(this._state.previous ?? [])].slice(0, 10) });
      await this._register(platform, token);
      return this._request(method, this._devicePath(this._state) + suffix, body, headers);
    }
  }

  async _request(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await (this._fetch ?? globalThis.fetch)(this._endpoint + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new PushError(res.status, json?.error ?? 'Error', json?.description ?? text.slice(0, 200));
    return json;
  }
}

/**
 * Starts `push` while mounted (and `enabled`), keeps the device's interests
 * equal to `interests` when given, and links `userId` when given with a
 * tokenProvider. Returns { deviceId, error, ready }.
 */
export function useHibiraPush(push, { interests, userId, tokenProvider, enabled = true } = {}) {
  const [deviceId, setDeviceId] = useState(null);
  const [error, setError] = useState(null);
  const providerRef = useRef(tokenProvider);
  providerRef.current = tokenProvider;
  const interestKey = Array.isArray(interests) ? JSON.stringify([...new Set(interests)].sort()) : null;

  useEffect(() => {
    if (!push || !enabled) return undefined;
    let live = true;
    const off = push.onChange((id) => live && setDeviceId(id));
    push.start().then(
      (id) => {
        if (!live) return;
        setDeviceId(id);
        setError(null);
      },
      (e) => live && setError(e),
    );
    return () => {
      live = false;
      off();
    };
  }, [push, enabled]);

  useEffect(() => {
    if (!push || !deviceId || interestKey == null) return;
    push.setDeviceInterests(JSON.parse(interestKey)).catch(setError);
  }, [push, deviceId, interestKey]);

  useEffect(() => {
    if (!push || !deviceId || !userId || !providerRef.current) return;
    push.setUserId(userId, providerRef.current).catch(setError);
  }, [push, deviceId, userId]);

  return { deviceId, error, ready: deviceId != null };
}

// 404 "Device not found", not "Instance not found" (a wrong instance ID).
function isGone(e) {
  return e instanceof PushError && e.status === 404 && /device/i.test(e.description ?? '');
}

function validateInterest(interest) {
  if (typeof interest !== 'string' || !interest) throw new TypeError('Interest must be a non-empty string');
  if (interest.length > MAX_INTEREST_LENGTH) throw new RangeError(`Interest "${interest}" is longer than ${MAX_INTEREST_LENGTH} characters`);
  if (!INTEREST_RE.test(interest)) {
    throw new Error(`Interest "${interest}" has a forbidden character; use ASCII letters, digits and _-=@,.;`);
  }
}
