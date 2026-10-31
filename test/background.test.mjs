import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchAppState } from '../background.js';
import { AppState } from './stubs/react-native.mjs';
import { fakePusher } from './fake-pusher.mjs';

function timers() {
  const pending = new Map();
  let n = 0;
  return {
    setTimer: (fn, ms) => (pending.set(++n, { fn, ms }), n),
    clearTimer: (id) => pending.delete(id),
    fire: () => {
      for (const [id, t] of [...pending]) {
        pending.delete(id);
        t.fn();
      }
    },
    pending,
  };
}

test('closes after the timeout in the background and reconnects on return', () => {
  const pusher = fakePusher();
  pusher.setState('connected');
  const t = timers();
  const stop = watchAppState(pusher, AppState, { timeout: 30000, ...t });
  AppState.set('background');
  assert.equal(t.pending.size, 1);
  assert.equal([...t.pending.values()][0].ms, 30000);
  t.fire();
  assert.equal(pusher.connection.state, 'disconnected');
  AppState.set('active');
  assert.equal(pusher.connection.state, 'connected');
  stop();
  assert.equal(AppState.listeners, 0);
});

test('a short trip to the background keeps the connection', () => {
  const pusher = fakePusher();
  pusher.setState('connected');
  const t = timers();
  const stop = watchAppState(pusher, AppState, t);
  AppState.set('inactive'); // iOS control centre, incoming call
  AppState.set('background');
  AppState.set('active');
  assert.equal(t.pending.size, 0);
  assert.deepEqual(pusher.log, []);
  stop();
});

test('timeout null keeps the connection open', () => {
  const pusher = fakePusher();
  const stop = watchAppState(pusher, AppState, { timeout: null });
  assert.equal(AppState.listeners, 0);
  stop();
});
