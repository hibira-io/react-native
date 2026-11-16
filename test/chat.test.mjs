import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import {
  createChatClient,
  createConversationListStore,
  createConversationStore,
  messageText,
  tokenUser,
  useChatConversation,
  ChatApiError,
} from '../chat.js';
import { fakePusher } from './fake-pusher.mjs';

const { act, createElement: h } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const b64 = (s) => Buffer.from(s).toString('base64url');
const jwt = (sub) => `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`;
const msg = (seq, sender = 'bob', text = `m${seq}`) => ({ id: `id${seq}`, seq, sender, kind: 'text', text, created_at: `t${seq}` });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/apps/a/chat/me', '') + u.search;
    calls.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const [status, body] = route(init.method ?? 'GET', path) ?? [404, { error: 'not found' }];
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('reads the user from a token, and the text for a language', () => {
  assert.equal(tokenUser(jwt('ann')), 'ann');
  assert.equal(tokenUser('nope'), '');
  const m = { text: 'hi', translations: { ja: 'やあ' } };
  assert.equal(messageText(m, 'ja'), 'やあ');
  assert.equal(messageText(m, 'ko'), 'hi');
});

test('calls the user routes and refreshes the token after a 401', async () => {
  let n = 0;
  let tokens = 0;
  const fetch = fakeFetch((method, path) => {
    n++;
    if (n === 1) return [401, { error: 'expired' }];
    if (path === '/conversations/trip%201/messages') return [201, { message: msg(4, 'ann', 'hi'), push: { users: 1 } }];
    if (path === '/') return [200, { user_id: 'ann', language: 'ja' }];
    if (path === '/conversations/c/typing') return [403, { error: 'you are muted' }];
    if (path === '/conversations/c/messages/3/translations') return [200, { message: { seq: 3, text: 'hi', translations: { ja: 'やあ' } } }];
  });
  const client = createChatClient({ appId: 'a', token: () => (tokens++, jwt('ann')), fetch });
  const out = await client.send('trip 1', { text: 'hi', metadata: { reply_to: 2 } });
  assert.equal(out.message.seq, 4);
  assert.equal(tokens, 2);
  assert.equal(client.user(), 'ann');
  assert.deepEqual(fetch.calls[1].body, { text: 'hi', metadata: { reply_to: 2 } });
  assert.match(fetch.calls[1].headers.Authorization, /^Bearer ey/);
  assert.deepEqual(await client.setLanguage('ja'), { user_id: 'ann', language: 'ja' });
  assert.equal(fetch.calls[2].method, 'PUT');
  assert.equal((await client.translate('c', 3, 'ja')).translations.ja, 'やあ');
  await assert.rejects(client.typing('c'), (e) => e instanceof ChatApiError && e.status === 403 && e.message === 'you are muted');
});

test('takes events from a signed-in pusher-js client', async () => {
  const pusher = fakePusher();
  const userHandlers = new Map();
  pusher.user = {
    bind: (e, fn) => userHandlers.set(e, fn),
    unbind: (e) => userHandlers.delete(e),
  };
  const client = createChatClient({ appId: 'a', token: jwt('ann'), pusher, fetch: fakeFetch(() => undefined) });
  const got = [];
  let lives = 0;
  client.on((e, d) => got.push([e, d.user_id]));
  client.onLive(() => lives++);
  userHandlers.get('chat.typing')({ conversation_id: 'c', user_id: 'bob', typing: true });
  pusher.setState('connected');
  assert.deepEqual(got, [['chat.typing', 'bob']]);
  assert.equal(lives, 1);
  assert.equal(client.handleEvent('other', {}), false);
  assert.equal(client.handleEvent('chat.left', '{}'), false);
});

function conversationFetch() {
  return fakeFetch((method, path) => {
    if (path === '/conversations/c')
      return [200, { conversation: { id: 'c', members: [{ user_id: 'ann', read_seq: 3 }, { user_id: 'bob', read_seq: 5 }], last_seq: 120 } }];
    if (path === '/conversations/c/messages?last=50') return [200, { messages: range(71, 120).map((s) => msg(s)), last_seq: 120 }];
    if (path === '/conversations/c/messages?after=20&limit=50') return [200, { messages: range(21, 70).map((s) => msg(s)), last_seq: 120 }];
    if (path === '/conversations/c/messages?after=0&limit=20') return [200, { messages: range(1, 20).map((s) => msg(s)), last_seq: 120 }];
    if (path.startsWith('/conversations/c/messages?after=121')) return [200, { messages: [msg(121)], last_seq: 121 }];
    if (path.startsWith('/conversations/c/messages?last=')) return [200, { messages: [msg(120, 'bob', 'edited'), msg(121)], last_seq: 121 }];
    if (path === '/conversations/c/read') return [200, { read_seq: 121 }];
    if (path === '/conversations/c/messages' && method === 'POST') return [201, { message: msg(122, 'ann', 'hello') }];
  });
}

test('a conversation store pages, applies events and catches up', async () => {
  const fetch = conversationFetch();
  const client = createChatClient({ appId: 'a', token: jwt('ann'), fetch });
  const c = createConversationStore(client, 'c');
  await c.refresh();
  assert.equal(c.get().messages.length, 50);
  assert.equal(c.get().hasOlder, true);
  assert.equal(c.get().reads.bob, 5);
  await c.loadOlder();
  await c.loadOlder();
  assert.deepEqual(c.get().messages.map((m) => m.seq), range(1, 120));
  assert.equal(c.get().hasOlder, false);

  c.start();
  await c.refresh();
  client.handleEvent('chat.typing', { conversation_id: 'c', user_id: 'bob', typing: true });
  assert.deepEqual(c.get().typing, ['bob']);
  client.handleEvent('chat.message', { conversation_id: 'c', message: msg(121) });
  assert.equal(c.get().messages.at(-1).seq, 121);
  assert.deepEqual(c.get().typing, []);
  client.handleEvent('chat.message', { conversation_id: 'x', message: msg(500) });
  client.handleEvent('chat.read', { conversation_id: 'c', user_id: 'bob', read_seq: 121 });
  assert.deepEqual(c.readBy(121), ['bob']);

  client.notifyLive();
  await c.refresh();
  assert.equal(c.get().messages.find((m) => m.seq === 120).text, 'edited');
  assert.ok(fetch.calls.some((x) => x.path.startsWith('/conversations/c/messages?after=121')));
  await c.markRead();
  assert.equal(c.get().reads.ann, 121);
  assert.equal((await c.send('hello')).seq, 122);
  assert.equal(c.get().messages.at(-1).seq, 122);
  client.handleEvent('chat.left', { conversation_id: 'c' });
  assert.equal(c.get().closed, true);
  c.stop();
});

test('the list store moves conversations and counts unread', async () => {
  const client = createChatClient({
    appId: 'a',
    token: jwt('ann'),
    fetch: fakeFetch(() => [200, { conversations: [{ id: 'a', last_seq: 3, unread: 0 }, { id: 'b', last_seq: 9, unread: 2 }], next: '' }]),
  });
  const l = createConversationListStore(client);
  l.start();
  await l.refresh();
  assert.deepEqual(l.get().conversations.map((c) => c.id), ['a', 'b']);
  client.handleEvent('chat.message', { conversation_id: 'b', message: msg(10) });
  assert.deepEqual(l.get().conversations.map((c) => c.id), ['b', 'a']);
  assert.equal(l.get().unread, 3);
  client.handleEvent('chat.read', { conversation_id: 'b', user_id: 'ann', read_seq: 10 });
  assert.equal(l.get().unread, 0);
  client.handleEvent('chat.deleted', { conversation_id: 'a' });
  assert.deepEqual(l.get().conversations.map((c) => c.id), ['b']);
  l.stop();
});

test('useChatConversation renders the live conversation', async () => {
  const client = createChatClient({ appId: 'a', token: jwt('ann'), fetch: conversationFetch() });
  const out = {};
  function Probe() {
    out.value = useChatConversation(client, 'c');
    return null;
  }
  let r;
  await act(async () => {
    r = TestRenderer.create(h(Probe));
  });
  await act(async () => {
    await new Promise((res) => setTimeout(res, 20));
  });
  assert.equal(out.value.messages.length, 50);
  assert.equal(typeof out.value.typing, 'function');
  await act(async () => {
    client.handleEvent('chat.typing', { conversation_id: 'c', user_id: 'bob', typing: true });
  });
  assert.deepEqual(out.value.typingUsers, ['bob']);
  await act(async () => {
    await out.value.loadOlder();
  });
  assert.equal(out.value.messages.length, 100);
  await act(async () => r.unmount());
});
