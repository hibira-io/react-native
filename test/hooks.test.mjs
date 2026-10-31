import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import { HibiraProvider, useChunkedEvent, useChunkedTrigger, useEvent, usePresence, chunkPayload } from '../index.js';
import { useHibiraPush, HibiraPush } from '../push.js';
import { fakePusher, sleep } from './fake-pusher.mjs';
import { fakePushApi } from './fake-push-api.mjs';

const { act, createElement: h } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const origError = console.error;
console.error = (msg, ...rest) => {
  if (typeof msg === 'string' && msg.includes('react-test-renderer is deprecated')) return;
  origError(msg, ...rest);
};

async function render(ui) {
  let r;
  await act(async () => {
    r = TestRenderer.create(ui);
  });
  return { rerender: (next) => act(async () => r.update(next)), unmount: () => act(async () => r.unmount()) };
}

function probe(hook, out) {
  return function Probe(props) {
    out.value = hook(props);
    return null;
  };
}

test('the web hooks work under the React Native provider', async () => {
  const pusher = fakePusher();
  const got = [];
  const presence = {};
  const A = probe(() => useEvent('orders', 'created', (d) => got.push(d)), {});
  const P = probe(() => usePresence('presence-room'), presence);
  const r = await render(h(HibiraProvider, { client: pusher }, h(A), h(P)));
  pusher.succeed('orders');
  await act(async () => {
    pusher.succeed('presence-room', { u1: { name: 'A' }, u2: { name: 'B' } }, 'u1');
    pusher.channels.get('orders').emit('created', { id: 1 });
  });
  assert.deepEqual(got, [{ id: 1 }]);
  assert.equal(presence.value.count, 2);
  assert.equal(presence.value.me.id, 'u1');
  await r.unmount();
});

test('the provider closes the connection after time in the background', async () => {
  const pusher = fakePusher();
  pusher.setState('connected');
  const r = await render(h(HibiraProvider, { client: pusher, backgroundTimeout: 20 }));
  AppState.set('background');
  await sleep(40);
  assert.equal(pusher.connection.state, 'disconnected');
  AppState.set('active');
  assert.equal(pusher.connection.state, 'connected');
  await r.unmount();
  assert.equal(AppState.listeners, 0);
});

test('useChunkedEvent hands over whole payloads; useChunkedTrigger sends them in chunks', async () => {
  const pusher = fakePusher();
  const got = [];
  const send = {};
  const data = { rows: Array.from({ length: 400 }, (_, i) => ({ i, text: `第 ${i} 行` })) };
  const R = probe(() => useChunkedEvent('private-sync', 'client-rows', (d, meta) => got.push([d, meta?.user_id])), {});
  const S = probe(() => useChunkedTrigger('private-sync', { interval: 1 }), send);
  const r = await render(h(HibiraProvider, { client: pusher }, h(R), h(S)));
  const ch = pusher.succeed('private-sync');

  assert.equal(await send.value('client-rows', data), true);
  assert.ok(ch.sent.length > 3, `${ch.sent.length} chunks`);
  for (const [, payload] of ch.sent) assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 3500);

  await act(async () => {
    for (const [ev, payload] of ch.sent) ch.emit(ev, payload, { user_id: 'u2' });
    ch.emit('client-rows', { small: true }, { user_id: 'u2' });
  });
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], [data, 'u2']);
  assert.deepEqual(got[1], [{ small: true }, 'u2']);
  await assert.rejects(send.value('typing', {}), /client-/);
  await r.unmount();
});

test('useChunkedTrigger returns false before the channel is subscribed', async () => {
  const pusher = fakePusher();
  const send = {};
  const S = probe(() => useChunkedTrigger('private-x'), send);
  const r = await render(h(HibiraProvider, { client: pusher }, h(S)));
  assert.equal(await send.value('client-a', chunkPayload({})), false);
  await r.unmount();
});

test('useHibiraPush starts, syncs interests and links the user', async () => {
  const api = fakePushApi();
  const push = new HibiraPush({ instanceId: 'inst-1', getToken: async () => ({ platform: 'fcm', token: 't' }), fetch: api.fetch });
  const out = {};
  const tokenProvider = { fetchToken: async (u) => ({ token: `jwt-${u}` }) };
  const P = probe((p) => useHibiraPush(push, p), out);
  const r = await render(h(P, { interests: ['news', 'jp'], userId: 'u1', tokenProvider }));
  await act(() => sleep(20));
  assert.equal(out.value.deviceId, 'fcm-1');
  assert.equal(out.value.ready, true);
  const dev = api.devices.get('fcm-1');
  assert.deepEqual([...dev.interests].sort(), ['jp', 'news']);
  assert.equal(dev.user, 'jwt-u1');

  await r.rerender(h(P, { interests: ['news'], userId: 'u1', tokenProvider }));
  await act(() => sleep(20));
  assert.deepEqual([...dev.interests], ['news']);
  await r.unmount();
});

test('useHibiraPush reports errors', async () => {
  const push = new HibiraPush({ instanceId: 'x', getToken: async () => ({ platform: 'web', token: 't' }) });
  const out = {};
  const P = probe(() => useHibiraPush(push), out);
  const r = await render(h(P));
  await act(() => sleep(10));
  assert.match(out.value.error.message, /fcm/);
  assert.equal(out.value.ready, false);
  await r.unmount();
});
