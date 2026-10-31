import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { resolvePusher } from '../pusher-client.js';
import { HibiraProvider, usePusher } from '../index.js';

const { act, createElement: h } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Pusher {}

test('resolvePusher finds the constructor in each pusher-js build shape', () => {
  // React Native build under Metro: default is module.exports = { Pusher }
  assert.equal(resolvePusher({ default: { Pusher }, Pusher }), Pusher);
  assert.equal(resolvePusher({ default: { Pusher } }), Pusher);
  // Node and web builds: the class is the default export
  assert.equal(resolvePusher({ default: Pusher }), Pusher);
  assert.equal(resolvePusher(Pusher), Pusher);
  assert.throws(() => resolvePusher({ default: {} }), /Pusher constructor/);
});

test('HibiraProvider opens its own client from appKey and closes it on unmount', async () => {
  const out = {};
  function Probe() {
    out.pusher = usePusher();
    return null;
  }
  let r;
  await act(async () => {
    r = TestRenderer.create(
      h(HibiraProvider, { appKey: 'key-1', options: { wsHost: '127.0.0.1', wsPort: 1, forceTLS: false, enabledTransports: ['ws'] }, backgroundTimeout: null }, h(Probe)),
    );
  });
  const pusher = out.pusher;
  assert.ok(pusher, 'a client is provided');
  assert.equal(pusher.key, 'key-1');
  assert.equal(pusher.config.wsHost, '127.0.0.1');
  await act(async () => r.unmount());
  assert.equal(pusher.connection.state, 'disconnected');
});
