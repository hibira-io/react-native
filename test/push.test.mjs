import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HibiraPush, PushError, RegistrationState, TokenProvider } from '../push.js';
import { fakePushApi, memoryStorage } from './fake-push-api.mjs';

const fcm = (token = 'fcm-token-1') => async () => ({ platform: 'fcm', token });

function client(api, extra = {}) {
  return new HibiraPush({ instanceId: 'inst-1', endpoint: 'https://push.test/', getToken: fcm(), fetch: api.fetch, ...extra });
}

test('registers once and remembers the device between launches', async () => {
  const api = fakePushApi();
  const storage = memoryStorage();
  const first = client(api, { storage });
  const id = await first.start();
  assert.equal(id, 'fcm-1');
  assert.equal(await first.start(), id, 'second start does not register again');

  const relaunch = client(api, { storage });
  assert.equal(await relaunch.getDeviceId(), id);
  assert.equal(await relaunch.start(), id);
  assert.equal(api.devices.size, 1);
  const reg = api.log.find(([m]) => m === 'POST');
  assert.equal(reg[1], '/device_api/v1/instances/inst-1/devices/fcm');
  assert.equal(reg[2].token, 'fcm-token-1');
  assert.equal(reg[2].metadata.sdk, 'react-native');
});

test('a changed token is sent, not registered again', async () => {
  const api = fakePushApi();
  const storage = memoryStorage();
  await client(api, { storage }).start();
  const next = client(api, { storage, getToken: fcm('fcm-token-2') });
  assert.equal(await next.start(), 'fcm-1');
  assert.equal(api.devices.get('fcm-1').token, 'fcm-token-2');
  await next.updateToken('fcm-token-3');
  assert.equal(api.devices.get('fcm-1').token, 'fcm-token-3');
});

test('interests', async () => {
  const api = fakePushApi();
  const push = client(api);
  await assert.rejects(push.addDeviceInterest('news'), /start\(\) first/);
  await push.start();
  await push.addDeviceInterest('news');
  await push.addDeviceInterest('sale-jp');
  await push.removeDeviceInterest('news');
  assert.deepEqual(await push.getDeviceInterests(), ['sale-jp']);
  await push.setDeviceInterests(['a', 'b', 'a']);
  assert.deepEqual((await push.getDeviceInterests()).sort(), ['a', 'b']);
  await push.clearDeviceInterests();
  assert.deepEqual(await push.getDeviceInterests(), []);
  assert.throws(() => push.addDeviceInterest('bad interest'), /forbidden/);
  assert.throws(() => push.addDeviceInterest('x'.repeat(165)), RangeError);
});

test('setUserId sends the token from the token provider', async () => {
  const api = fakePushApi();
  const storage = memoryStorage();
  const push = client(api, { storage });
  await push.start();
  const seen = [];
  const tokenProvider = new TokenProvider({
    url: 'https://app.test/push-auth',
    headers: async () => ({ Authorization: 'Bearer session' }),
    fetch: async (url, init) => {
      seen.push([url, init.headers]);
      return Response.json({ token: 'jwt-for-u1' });
    },
  });
  await push.setUserId('u1', tokenProvider);
  assert.equal(seen[0][0], 'https://app.test/push-auth?user_id=u1');
  assert.deepEqual(seen[0][1], { Authorization: 'Bearer session' });
  assert.equal(api.devices.get('fcm-1').user, 'jwt-for-u1');
  await push.setUserId('u1', tokenProvider); // same user: nothing to do
  assert.equal(seen.length, 1);
  await assert.rejects(push.setUserId('u2', tokenProvider), /cannot change/);
  assert.equal(await client(api, { storage }).getUserId(), 'u1');
});

test('stop deletes the device; the next start carries interests over', async () => {
  const api = fakePushApi();
  const storage = memoryStorage();
  const push = client(api, { storage });
  await push.start();
  await push.addDeviceInterest('news');
  await push.stop();
  assert.equal(api.devices.size, 0);
  assert.equal(await push.getDeviceId(), null);
  const id = await push.start();
  assert.equal(id, 'fcm-2');
  const reg = api.log.filter(([m]) => m === 'POST').at(-1);
  assert.deepEqual(reg[2].knownPreviousClientIds, ['fcm-1']);
});

test('a device deleted on the server is registered again', async () => {
  const api = fakePushApi();
  const push = client(api);
  await push.start();
  api.devices.clear();
  await push.addDeviceInterest('news');
  assert.equal(await push.getDeviceId(), 'fcm-2');
  assert.deepEqual([...api.devices.get('fcm-2').interests], ['news']);
});

test('a wrong instance id is an error, not a new device', async () => {
  const api = fakePushApi();
  const push = new HibiraPush({ instanceId: 'nope', getToken: fcm(), fetch: api.fetch });
  await assert.rejects(push.start(), (e) => e instanceof PushError && e.status === 404 && /Instance/.test(e.description));
});

test('permission: asked on start, refused means no registration', async () => {
  const api = fakePushApi();
  let status = 'undetermined';
  const asked = [];
  const permissions = {
    get: async () => status,
    request: async () => (asked.push(1), (status = 'denied')),
  };
  const push = client(api, { permissions });
  assert.equal(await push.getRegistrationState(), RegistrationState.PERMISSION_PROMPT_REQUIRED);
  await assert.rejects(push.start(), /permission/);
  assert.equal(asked.length, 1);
  assert.equal(await push.getRegistrationState(), RegistrationState.PERMISSION_DENIED);
  assert.equal(api.devices.size, 0);
  status = 'granted';
  await push.start();
  assert.equal(await push.getRegistrationState(), RegistrationState.PERMISSION_GRANTED_REGISTERED);
});

test('APNs registration sends the bundle id', async () => {
  const api = fakePushApi();
  const push = client(api, { getToken: async () => ({ platform: 'apns', token: 'ab'.repeat(32) }), bundleIdentifier: 'io.hibira.demo' });
  assert.equal(await push.start(), 'apns-1');
  assert.equal(api.devices.get('apns-1').body.bundleIdentifier, 'io.hibira.demo');
});

test('calls run one at a time, in order', async () => {
  const api = fakePushApi();
  const push = client(api);
  await Promise.all([push.start(), push.addDeviceInterest('a'), push.addDeviceInterest('b'), push.removeDeviceInterest('a')]);
  assert.deepEqual(await push.getDeviceInterests(), ['b']);
});

test('bad config', () => {
  assert.throws(() => new HibiraPush({ getToken: fcm() }), /instanceId/);
  assert.throws(() => new HibiraPush({ instanceId: 'x' }), /getToken/);
  assert.throws(() => new HibiraPush({ instanceId: 'x', getToken: fcm(), endpoint: 'ws.hibira.io' }), /http/);
});
