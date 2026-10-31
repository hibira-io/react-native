// End-to-end test against a running Hibira (or Pusher-compatible) server
// with client events on. Channels parts need HIBIRA_E2E_KEY; push parts need
// HIBIRA_E2E_PUSH_INSTANCE and HIBIRA_E2E_PUSH_SECRET (the instance's
// secret key). Run against a server with a 4 KB event limit, as on Free:
//
//   HIBIRA_E2E_HOST=127.0.0.1 HIBIRA_E2E_PORT=6001 HIBIRA_E2E_TLS=0 \
//   HIBIRA_E2E_APP_ID=... HIBIRA_E2E_KEY=... HIBIRA_E2E_SECRET=... \
//   HIBIRA_E2E_PUSH_INSTANCE=... HIBIRA_E2E_PUSH_SECRET=... npm run test:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import Pusher from 'pusher-js';
import PusherServer from 'pusher';
import { HibiraProvider, useChunkedEvent, useChunkedTrigger, useConnectionState } from '../../index.js';
import { triggerChunked } from '../../server.js';
import { HibiraPush, TokenProvider } from '../../push.js';

const h = React.createElement;
const act = React.act;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const env = process.env;
const host = env.HIBIRA_E2E_HOST ?? '127.0.0.1';
const port = Number(env.HIBIRA_E2E_PORT ?? 8080);
const tls = env.HIBIRA_E2E_TLS === '1';
const base = `${tls ? 'https' : 'http'}://${host}:${port}`;
const skipChannels = !env.HIBIRA_E2E_KEY && 'set HIBIRA_E2E_KEY to run';
const skipPush = !env.HIBIRA_E2E_PUSH_INSTANCE && 'set HIBIRA_E2E_PUSH_INSTANCE to run';

const server = skipChannels
  ? null
  : new PusherServer({ appId: env.HIBIRA_E2E_APP_ID, key: env.HIBIRA_E2E_KEY, secret: env.HIBIRA_E2E_SECRET, host, port: String(port), useTLS: tls });

function client(userId) {
  return new Pusher(env.HIBIRA_E2E_KEY, {
    cluster: 'hkg',
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ['ws'],
    channelAuthorization: {
      customHandler: ({ socketId, channelName }, cb) => {
        const user = channelName.startsWith('presence-') ? { user_id: userId, user_info: {} } : undefined;
        cb(null, server.authorizeChannel(socketId, channelName, user));
      },
    },
  });
}

const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await act(() => new Promise((r) => setTimeout(r, 20)));
  }
};

const payload = (kb) => ({ rows: Array.from({ length: kb * 20 }, (_, i) => ({ i, text: `行 ${i} 🎉 "${'x'.repeat(20)}"` })) });

test('server events bigger than the limit arrive whole through triggerChunked', { skip: skipChannels }, async () => {
  const pusher = client('a');
  const got = [];
  const out = {};
  function Probe() {
    out.state = useConnectionState();
    useChunkedEvent('private-rn-e2e', 'rows', (d) => got.push(d));
    return null;
  }
  let r;
  await act(async () => {
    r = TestRenderer.create(h(HibiraProvider, { client: pusher }, h(Probe)));
  });
  await until(() => pusher.channel('private-rn-e2e')?.subscribed);

  const data = payload(20);
  assert.ok(Buffer.byteLength(JSON.stringify(data)) > 4096 * 4);
  await assert.rejects(server.trigger('private-rn-e2e', 'rows', data), 'the server refuses it in one event');
  const n = await triggerChunked(server, 'private-rn-e2e', 'rows', data);
  assert.ok(n >= 5, `${n} events`);
  await until(() => got.length === 1);
  assert.deepEqual(got[0], data);
  await act(async () => r.unmount());
  pusher.disconnect();
});

test('client events bigger than the limit arrive whole through useChunkedTrigger', { skip: skipChannels }, async () => {
  const a = client('a');
  const b = client('b');
  const got = [];
  const send = {};
  const Sender = () => ((send.fn = useChunkedTrigger('private-rn-client')), null);
  const Receiver = () => (useChunkedEvent('private-rn-client', 'client-rows', (d) => got.push(d)), null);
  let ra, rb;
  await act(async () => {
    ra = TestRenderer.create(h(HibiraProvider, { client: a }, h(Sender)));
    rb = TestRenderer.create(h(HibiraProvider, { client: b }, h(Receiver)));
  });
  await until(() => a.channel('private-rn-client')?.subscribed && b.channel('private-rn-client')?.subscribed);
  const data = payload(12);
  let ok;
  await act(async () => {
    ok = await send.fn('client-rows', data);
  });
  assert.equal(ok, true);
  await until(() => got.length === 1);
  assert.deepEqual(got[0], data);
  await act(async () => {
    ra.unmount();
    rb.unmount();
  });
  a.disconnect();
  b.disconnect();
});

function beamsToken(userId) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: userId, exp: Math.floor(Date.now() / 1000) + 600, iss: `https://${env.HIBIRA_E2E_PUSH_INSTANCE}.pushnotifications.pusher.com` })}`;
  return `${body}.${createHmac('sha256', env.HIBIRA_E2E_PUSH_SECRET).update(body).digest('base64url')}`;
}

test('push: register, refresh, interests, user, stop against the device API', { skip: skipPush }, async () => {
  const items = new Map();
  const storage = { getItem: async (k) => items.get(k) ?? null, setItem: async (k, v) => void items.set(k, v) };
  let token = `fcm-e2e-${Date.now()}`;
  const push = new HibiraPush({ instanceId: env.HIBIRA_E2E_PUSH_INSTANCE, endpoint: base, storage, getToken: async () => ({ platform: 'fcm', token }) });
  const id = await push.start();
  assert.match(id, /^fcm-/);
  token += '-2';
  const again = new HibiraPush({ instanceId: env.HIBIRA_E2E_PUSH_INSTANCE, endpoint: base, storage, getToken: async () => ({ platform: 'fcm', token }) });
  assert.equal(await again.start(), id, 'a new launch keeps the device');

  await again.setDeviceInterests(['news', 'sale-jp']);
  await again.addDeviceInterest('hello');
  await again.removeDeviceInterest('news');
  assert.deepEqual((await again.getDeviceInterests()).sort(), ['hello', 'sale-jp']);

  const tokenProvider = new TokenProvider({
    url: 'https://app.test/push-auth',
    fetch: async (url) => Response.json({ token: beamsToken(new URL(url).searchParams.get('user_id')) }),
  });
  await again.setUserId('rn-user-1', tokenProvider);
  const dev = await (await fetch(`${base}/device_api/v1/instances/${env.HIBIRA_E2E_PUSH_INSTANCE}/devices/fcm/${id}`)).json();
  assert.equal(dev.userId, 'rn-user-1');
  assert.equal(dev.metadata.sdk, 'react-native');

  // A device removed on the server is registered again on the next call.
  await fetch(`${base}/device_api/v1/instances/${env.HIBIRA_E2E_PUSH_INSTANCE}/devices/fcm/${id}`, { method: 'DELETE' });
  await again.addDeviceInterest('after-delete');
  assert.notEqual(await again.getDeviceId(), id);

  const apns = new HibiraPush({
    instanceId: env.HIBIRA_E2E_PUSH_INSTANCE,
    endpoint: base,
    bundleIdentifier: 'io.hibira.demo',
    getToken: async () => ({ platform: 'apns', token: 'ab'.repeat(32) }),
  });
  assert.match(await apns.start(), /^apns-/);
  await apns.stop();
  assert.equal(await apns.getDeviceId(), null);
  await again.stop();
});
