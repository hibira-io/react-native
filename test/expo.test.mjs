import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createExpoPush, RegistrationState } from '../expo.js';
import { fakePushApi } from './fake-push-api.mjs';

test('createExpoPush: asks permission, registers the APNs device token, keeps it in AsyncStorage, follows token changes', async () => {
  const api = fakePushApi();
  const push = createExpoPush({ instanceId: 'inst-1', fetch: api.fetch, bundleIdentifier: 'io.hibira.demo' });
  assert.equal(await push.getRegistrationState(), RegistrationState.PERMISSION_PROMPT_REQUIRED);
  const id = await push.start();
  assert.equal(id, 'apns-1');
  assert.ok(Notifications.calls.includes('requestPermissions'));
  assert.equal(api.devices.get(id).token, 'ab'.repeat(32));
  assert.ok(AsyncStorage.items.get('hibira-push:inst-1').includes(id));

  Notifications.emitToken({ type: 'ios', data: 'cd'.repeat(32) });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(api.devices.get(id).token, 'cd'.repeat(32));
  push.dispose();
});

test('Android gives an FCM token; web is refused', async () => {
  const api = fakePushApi();
  Notifications.setUp({ token: { type: 'android', data: 'fcm-abc' } });
  const push = createExpoPush({ instanceId: 'inst-1', fetch: api.fetch, storage: null });
  assert.equal(await push.start(), 'fcm-1');
  Notifications.setUp({ token: { type: 'web', data: {} } });
  const web = createExpoPush({ instanceId: 'inst-1', fetch: api.fetch, storage: null });
  await assert.rejects(web.start(), /push-web/);
});
