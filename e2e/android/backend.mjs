// Drives the e2e app on the Android emulator from the host and decides pass or
// fail. It serves the app's config and channel auth, sends server events, reads
// the app's chunked client event and presence with its own client, checks push
// registration, and backgrounds the app with adb.
//
//   node e2e/android/backend.mjs local    soketi on :6001, fake Hibira Push
//   node e2e/android/backend.mjs hibira   ws.hibira.io; needs HIBIRA_E2E_APP_ID,
//     HIBIRA_E2E_KEY, HIBIRA_E2E_SECRET; push also needs
//     HIBIRA_E2E_PUSH_INSTANCE and HIBIRA_E2E_PUSH_SECRET; real FCM delivery
//     also needs HIBIRA_E2E_FCM=1 (the app was built with google-services.json).
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import PusherServer from 'pusher';
import Pusher from 'pusher-js';
import { triggerChunked } from '../../server.js';
import { createChunkAssembler } from '../../chunk.js';
import { fakePushApi } from '../../test/fake-push-api.mjs';

const mode = process.argv[2] ?? 'local';
const env = process.env;
const exec = promisify(execFile);
const run = randomBytes(4).toString('hex');
const PKG = 'io.hibira.e2e';
const SERVER_KB = 12;
const CLIENT_KB = 16;
const MAX_EVENT_BYTES = 4096;

// Same rows as App.js.
function payload(kb) {
  return { rows: Array.from({ length: kb * 20 }, (_, i) => ({ i, text: `行 ${i} 🎉 "${'x'.repeat(20)}"` })) };
}

const servers = {
  local: {
    app: { appId: 'app-id', key: 'app-key', secret: 'app-secret', host: '127.0.0.1', port: '6001', useTLS: false },
    client: { wsHost: '127.0.0.1', wsPort: 6001, wssPort: 6001, forceTLS: false },
    appOptions: { wsHost: '10.0.2.2', wsPort: 6001, wssPort: 6001, forceTLS: false, enabledTransports: ['ws'] },
  },
  hibira: {
    app: { appId: env.HIBIRA_E2E_APP_ID, key: env.HIBIRA_E2E_KEY, secret: env.HIBIRA_E2E_SECRET, host: 'ws.hibira.io', useTLS: true },
    client: { wsHost: 'ws.hibira.io', forceTLS: true },
    appOptions: {},
  },
};
const target = servers[mode];
if (!target) fail(`unknown mode ${mode}`);
if (!target.app.key || !target.app.secret || !target.app.appId) fail('missing app id, key or secret');

const server = new PusherServer(target.app);
const privateName = `private-e2e-${run}`;
const presenceName = `presence-e2e-${run}`;

// --- push: a fake device API on :3001, or Hibira Push
const fake = mode === 'local' ? fakePushApi({ instanceId: 'e2e-instance' }) : null;
const push =
  mode === 'local'
    ? { instanceId: 'e2e-instance', endpoint: 'http://10.0.2.2:3001' }
    : env.HIBIRA_E2E_PUSH_INSTANCE
      ? { instanceId: env.HIBIRA_E2E_PUSH_INSTANCE, endpoint: 'https://ws.hibira.io' }
      : null;
const fcm = mode === 'hibira' && env.HIBIRA_E2E_FCM === '1';
const pushTitle = `Hibira e2e ${run}`;
if (push) Object.assign(push, { interest: `e2e-${run}`, fcm, title: pushTitle });

// --- results
const expected = ['connected', 'subscribed', 'server-small', 'server-chunked', 'client-sent', 'client-chunked', 'presence-joined', 'backgrounded', 'reconnected'];
if (push) expected.push('push-registered', 'push-checked', 'push-stopped', 'push-deleted');
if (push?.fcm) expected.push('push-received');
const results = new Map();
let finish;
const finished = new Promise((r) => (finish = r));

function pass(step, detail = '') {
  if (results.has(step)) return;
  results.set(step, { ok: true, detail });
  log(`ok   ${step} ${detail}`);
  if (expected.every((s) => results.get(s)?.ok)) finish(true);
}

function failStep(step, detail = '') {
  if (results.get(step)?.ok === false) return;
  results.set(step, { ok: false, detail });
  log(`FAIL ${step} ${detail}`);
  finish(false);
}

function log(...a) {
  console.log(`[${mode}]`, ...a);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// --- the host's own client: reads client events and presence
const watcher = new Pusher(target.app.key, {
  cluster: 'hkg',
  ...target.client,
  enabledTransports: ['ws'],
  channelAuthorization: {
    customHandler: ({ socketId, channelName }, cb) => {
      const user = channelName.startsWith('presence-') ? { user_id: 'host', user_info: {} } : undefined;
      cb(null, server.authorizeChannel(socketId, channelName, user));
    },
  },
});
const assembler = createChunkAssembler();
let clientChunks = 0;
const watchPrivate = watcher.subscribe(privateName);
watchPrivate.bind('client-big', (data, meta) => {
  clientChunks++;
  if (JSON.stringify(data).length > MAX_EVENT_BYTES) failStep('client-chunked', 'a chunk is over 4 KB');
  const whole = assembler.add(data, meta?.user_id);
  if (!whole) return;
  if (JSON.stringify(whole.data) === JSON.stringify(payload(CLIENT_KB))) pass('client-chunked', `${clientChunks} events`);
  else failStep('client-chunked', 'payload differs');
});
let phase = 'start';
let bgAt = 0;
const watchPresence = watcher.subscribe(presenceName);
watchPresence.bind('pusher:member_added', (m) => {
  if (m.id !== 'android') return;
  if (phase === 'start') pass('presence-joined');
  if (phase === 'background') failStep('reconnected', 'rejoined while still in the background');
  if (phase === 'foreground') pass('reconnected');
});
watchPresence.bind('pusher:member_removed', (m) => {
  if (m.id !== 'android') return;
  if (phase === 'background') pass('backgrounded', `${Math.round((Date.now() - bgAt) / 1000)} s after HOME`);
  else failStep('presence', `the app left during ${phase}`);
});
const watcherReady = Promise.all(
  [watchPrivate, watchPresence].map(
    (ch) =>
      new Promise((resolve, reject) => {
        ch.bind('pusher:subscription_succeeded', resolve);
        ch.bind('pusher:subscription_error', (e) => reject(new Error(`host client: ${ch.name} ${JSON.stringify(e)}`)));
      }),
  ),
);

// --- app events
async function onEvent(e) {
  const { step } = e;
  if (step === 'state') {
    log(`app state ${e.state}`);
    if (e.state === 'connected') pass('connected');
    if (e.state === 'failed' || e.state === 'unavailable') failStep('connected', e.state);
    return;
  }
  if (step === 'subscribed') {
    pass('subscribed');
    await server.trigger(privateName, 'server.small', { n: 1 });
    const sent = await triggerChunked(server, privateName, 'server.big', payload(SERVER_KB));
    log(`sent server.big in ${sent} events`);
    return;
  }
  if (step === 'push-registered') {
    if (!e.ok) return failStep(step, e.error ?? JSON.stringify(e));
    pass(step, e.deviceId);
    const dev = await device(e.deviceId);
    if (dev?.interests?.includes(push.interest)) pass('push-checked', 'interest stored on the server');
    else failStep('push-checked', JSON.stringify(dev));
    if (push.fcm) await publish();
    return;
  }
  if (step === 'push-stopped') {
    if (!e.ok) return failStep(step);
    pass(step);
    const dev = await device(e.deviceId);
    if (dev === null) pass('push-deleted');
    else failStep('push-deleted', 'device still on the server');
    return;
  }
  if (e.ok === false) return failStep(step, e.error ?? '');
  if (expected.includes(step)) pass(step);
}
// The device as the server has it, null when gone.
async function device(id) {
  if (fake) {
    const d = fake.devices.get(id);
    return d ? { interests: [...d.interests] } : null;
  }
  const base = `${push.endpoint}/device_api/v1/instances/${push.instanceId}/devices/fcm/${encodeURIComponent(id)}`;
  const [dev, interests] = await Promise.all([fetch(base), fetch(`${base}/interests`)]);
  if (dev.status === 404) return null;
  if (!dev.ok) throw new Error(`device ${dev.status}`);
  return { ...(await dev.json()), interests: (await interests.json()).interests ?? [] };
}

async function publish() {
  const res = await fetch(`${push.endpoint}/publish_api/v1/instances/${push.instanceId}/publishes/interests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.HIBIRA_E2E_PUSH_SECRET}` },
    body: JSON.stringify({ interests: [push.interest], fcm: { notification: { title: pushTitle, body: 'from CI' } } }),
  });
  log(`publish ${res.status} ${await res.text()}`);
  if (!res.ok) failStep('push-received', `publish ${res.status}`);
}

// --- HTTP for the app
function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });
}

const app = http.createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.url === '/config') {
      return send(200, { mode, run, key: target.app.key, options: target.appOptions, serverKb: SERVER_KB, clientKb: CLIENT_KB, push });
    }
    if (req.url === '/auth' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req));
      const channel = form.get('channel_name');
      if (channel !== privateName && channel !== presenceName) return send(403, { error: 'channel' });
      const user = channel.startsWith('presence-') ? { user_id: 'android', user_info: {} } : undefined;
      return send(200, server.authorizeChannel(form.get('socket_id'), channel, user));
    }
    if (req.url === '/event' && req.method === 'POST') {
      const e = JSON.parse(await body(req));
      // Answered after the step is handled, so the app can wait for checks
      // (push-checked) before it moves on.
      await onEvent(e).catch((err) => failStep(e.step, String(err?.message ?? err)));
      return send(200, {});
    }
    send(404, {});
  } catch (err) {
    log(`http ${req.url}: ${err?.stack ?? err}`);
    send(500, { error: 'internal error' });
  }
});

const pushServer = fake
  ? http.createServer(async (req, res) => {
      const r = await fake.fetch(`http://fake${req.url}`, {
        method: req.method,
        headers: { Authorization: req.headers.authorization },
        body: (await body(req)) || undefined,
      });
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(await r.text());
    })
  : null;

async function adb(...args) {
  const { stdout } = await exec('adb', args);
  return stdout.trim();
}

function timeout(ms, what) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms));
}

async function waitFor(steps, ms) {
  const end = Date.now() + ms;
  while (!steps.every((s) => results.get(s)?.ok)) {
    const bad = steps.find((s) => results.get(s)?.ok === false);
    if (bad) throw new Error(`${bad} failed`);
    if (Date.now() > end) throw new Error(`timed out waiting for ${steps.filter((s) => !results.get(s)?.ok).join(', ')}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function main() {
  await new Promise((r) => app.listen(3000, r));
  if (pushServer) await new Promise((r) => pushServer.listen(3001, r));
  await Promise.race([watcherReady, timeout(20_000, 'host client subscribe')]);
  log(`run ${run}, host client ready; launching the app`);

  await adb('shell', 'am', 'force-stop', PKG);
  await adb('shell', 'pm', 'clear', PKG);
  await adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS').catch(() => {});
  await adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');

  const main = expected.filter((s) => !['backgrounded', 'reconnected'].includes(s));
  await waitFor(main, 180_000);

  phase = 'background';
  bgAt = Date.now();
  await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  log('app sent to the background');
  await waitFor(['backgrounded'], 90_000);
  if (Date.now() - bgAt < 25_000) throw new Error('disconnected before the 30 s background timeout');

  phase = 'foreground';
  await adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  await waitFor(['reconnected'], 60_000);
}

const outcome = await Promise.race([
  main().then(
    () => finished,
    (err) => {
      log(`FAIL ${err.message}`);
      return false;
    },
  ),
  finished.then((ok) => (ok ? new Promise(() => {}) : false)),
  timeout(420_000, 'whole run').catch((err) => {
    log(`FAIL ${err.message}`);
    return false;
  }),
]);

log(outcome ? 'PASS' : 'FAIL');
for (const s of expected) log(`${results.get(s)?.ok ? 'ok  ' : 'MISS'} ${s}`);
watcher.disconnect();
process.exit(outcome ? 0 : 1);
