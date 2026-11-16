// The Hibira Chat API for React Native and Expo: a client for the user
// routes (/apps/{appId}/chat/me), live chat.* events from a pusher-js
// client signed in as the user (pusher.signin()), and stores and hooks that
// keep one conversation, or the user's conversation list, up to date.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePusher } from '@hibira-io/react';

export const DEFAULT_CHAT_HOST = 'api.hibira.io';

/** Chat API events, sent to each member's user channel. */
export const CHAT_EVENTS = Object.freeze([
  'chat.message',
  'chat.message_updated',
  'chat.typing',
  'chat.read',
  'chat.conversation',
  'chat.left',
  'chat.deleted',
]);

/** How long a typing indicator shows without another chat.typing. */
export const TYPING_SHOW_MS = 8_000;

function base64Decode(s) {
  if (typeof atob === 'function') return atob(s);
  return globalThis.Buffer.from(s, 'base64').toString('binary');
}

function claims(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = base64Decode(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
    const json = decodeURIComponent(
      Array.from(bin, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) ?? {};
  } catch {
    return {};
  }
}

/** The user ID (sub) inside a user token, or '' when it cannot be read. */
export const tokenUser = (token) => String(claims(token).sub ?? '');

/** An error answered by the Chat API, with its HTTP status (0: no answer). */
export class ChatApiError extends Error {
  constructor(status, message) {
    super(message || `Chat API request failed (${status})`);
    this.name = 'ChatApiError';
    this.status = status;
  }
}

/** The text to show a reader of `lang`: its translation, else the text. */
export function messageText(message, lang) {
  if (!message) return '';
  return (lang && message.translations?.[lang]) || message.text || '';
}

/**
 * The Chat API as the signed-in user.
 *
 * options:
 *   appId     the Hibira app ID (required)
 *   token     the user token, or a function returning one (or a promise),
 *             called again before it expires and after a 401
 *   tokenUrl  instead of token: a URL on your server that answers {token}
 *   pusher    a pusher-js client signed in as the user, for live events
 *   host      the HTTP API host (default api.hibira.io); may include http://
 *   fetch     a fetch implementation (default globalThis.fetch)
 */
export function createChatClient(options = {}) {
  if (!options.appId) throw new TypeError('createChatClient: appId is required');
  if (!options.token && !options.tokenUrl) throw new TypeError('createChatClient: token or tokenUrl is required');
  const doFetch = options.fetch ?? ((...a) => globalThis.fetch(...a));
  let host = String(options.host ?? DEFAULT_CHAT_HOST);
  while (host.endsWith('/')) host = host.slice(0, -1);
  const base = `${/^https?:\/\//.test(host) ? host : `https://${host}`}/apps/${encodeURIComponent(options.appId)}/chat/me`;
  let token = typeof options.token === 'string' ? options.token : null;
  let pending = null;
  const listeners = new Set();
  const liveListeners = new Set();
  let detach = () => {};

  async function fetchToken() {
    if (typeof options.token === 'string') return options.token;
    if (typeof options.token === 'function') return options.token();
    const res = await doFetch(options.tokenUrl, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ChatApiError(res.status, `token endpoint answered ${res.status}`);
    return (await res.json()).token;
  }

  function currentToken(force) {
    const exp = token ? claims(token).exp ?? 0 : 0;
    if (!force && token && (exp === 0 || exp - Date.now() / 1000 > 30)) return Promise.resolve(token);
    pending ??= Promise.resolve(fetchToken())
      .then((t) => (token = t))
      .finally(() => (pending = null));
    return pending;
  }

  async function call(method, path, { body, query, signal } = {}) {
    const params = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const url = base + path + (qs ? `?${qs}` : '');
    for (let attempt = 0; ; attempt++) {
      const t = await currentToken(attempt > 0);
      let res;
      try {
        res = await doFetch(url, {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${t}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new ChatApiError(0, err?.message);
      }
      if (res.status === 401 && attempt === 0 && typeof options.token !== 'string') continue;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ChatApiError(res.status, data?.error);
      return data;
    }
  }

  const conv = (id) => `/conversations/${encodeURIComponent(id)}`;

  const client = {
    /** The token's user, once a token is known ('' before). */
    user: () => (token ? tokenUser(token) : ''),
    /** Fetches the token if needed and returns its user. */
    currentUser: () => currentToken(false).then(tokenUser),
    conversations: ({ limit, before, signal } = {}) => call('GET', '/conversations', { query: { limit, before }, signal }),
    conversation: (id, { signal } = {}) => call('GET', conv(id), { signal }).then((d) => d.conversation),
    messages: (id, { after, last, limit, signal } = {}) =>
      call('GET', `${conv(id)}/messages`, { query: { after, last, limit }, signal }),
    search: (id, q, { before, limit, signal } = {}) => call('GET', `${conv(id)}/search`, { query: { q, before, limit }, signal }),
    send: (id, message) => call('POST', `${conv(id)}/messages`, { body: typeof message === 'string' ? { text: message } : message }),
    edit: (id, seq, change) =>
      call('PUT', `${conv(id)}/messages/${seq}`, { body: typeof change === 'string' ? { text: change } : change }).then((d) => d.message),
    remove: (id, seq) => call('DELETE', `${conv(id)}/messages/${seq}`).then((d) => d.message),
    react: (id, seq, emoji, on = true) =>
      (on
        ? call('POST', `${conv(id)}/messages/${seq}/reactions`, { body: { emoji } })
        : call('DELETE', `${conv(id)}/messages/${seq}/reactions`, { query: { emoji } })
      ).then((d) => d.message),
    report: (id, seq, reason) => call('POST', `${conv(id)}/messages/${seq}/reports`, { body: { reason } }).then((d) => d.report),
    read: (id, seq) => call('POST', `${conv(id)}/read`, { body: { seq } }),
    typing: (id, typing = true) => call('POST', `${conv(id)}/typing`, { body: { typing } }),
    /** Translates one message into a BCP 47 language and keeps it on the message. */
    translate: (id, seq, language) =>
      call('POST', `${conv(id)}/messages/${seq}/translations`, { body: { language } }).then((d) => d.message),
    /** The user's settings: {user_id, language}. */
    me: () => call('GET', '/'),
    /** Sets the language messages are translated into for this user (null for none). */
    setLanguage: (language) => call('PUT', '/', { body: { language: language ?? null } }),
    /**
     * Uploads a file straight to storage (up to 25 MB): `file` is a Blob, or
     * { uri, name, type, size } from an image or document picker. Send the
     * result in a message's attachments.
     */
    async upload(id, file, { name, type, size } = {}) {
      const fileName = name ?? file?.name ?? 'file';
      const contentType = type ?? file?.type ?? 'application/octet-stream';
      let body = file;
      if (file && typeof file.uri === 'string' && !(typeof Blob !== 'undefined' && file instanceof Blob)) {
        body = await (await doFetch(file.uri)).blob();
      }
      const bytes = size ?? file?.size ?? body?.size;
      const { attachment, upload } = await call('POST', `${conv(id)}/attachments`, {
        body: { name: fileName, content_type: contentType, size: bytes },
      });
      const res = await doFetch(upload.url, { method: upload.method ?? 'PUT', headers: upload.headers ?? {}, body });
      if (!res.ok) throw new ChatApiError(res.status, 'Upload failed');
      return attachment;
    },

    /** Calls handler(event, data) for each chat event; returns unsubscribe. */
    on(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    /** Calls handler() each time the realtime connection is (back) up. */
    onLive(handler) {
      liveListeners.add(handler);
      return () => liveListeners.delete(handler);
    },
    /** Feeds an event from the user's channel; returns true for chat events. */
    handleEvent(event, data) {
      if (!CHAT_EVENTS.includes(event)) return false;
      let d = data;
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d);
        } catch {
          return false;
        }
      }
      if (!d || typeof d !== 'object') return false;
      const id = event === 'chat.conversation' ? d.conversation?.id : d.conversation_id;
      if (!id) return false;
      listeners.forEach((fn) => fn(event, d));
      return true;
    },
    notifyLive() {
      liveListeners.forEach((fn) => fn());
    },
    /** Takes live events from a pusher-js client signed in as the user. */
    attach(pusher) {
      detach();
      detach = () => {};
      const user = pusher?.user;
      if (!user?.bind) return () => {};
      const fns = CHAT_EVENTS.map((e) => {
        const fn = (data) => client.handleEvent(e, data);
        user.bind(e, fn);
        return [e, fn];
      });
      const state = ({ current } = {}) => current === 'connected' && client.notifyLive();
      pusher.connection?.bind?.('state_change', state);
      detach = () => {
        fns.forEach(([e, fn]) => user.unbind?.(e, fn));
        pusher.connection?.unbind?.('state_change', state);
      };
      return detach;
    },
  };
  if (options.pusher) client.attach(options.pusher);
  return client;
}

function mergeMessages(list, page) {
  if (!page?.length) return list;
  const bySeq = new Map(list.map((m) => [m.seq, m]));
  for (const m of page) if (m && typeof m.seq === 'number') bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

const lastSeq = (list) => (list.length ? list[list.length - 1].seq : 0);

/**
 * One conversation kept up to date: the newest page of messages, older
 * pages on demand, live messages, edits, reactions, typing and read
 * receipts, and a catch-up read each time the connection comes back.
 */
export function createConversationStore(client, id, { pageSize = 50 } = {}) {
  let state = {
    conversation: null,
    messages: [],
    loading: true,
    loadingOlder: false,
    hasOlder: false,
    typing: [],
    reads: {},
    closed: false,
    error: null,
  };
  const subscribers = new Set();
  const typingTimers = new Map();
  let floor = -1;
  let inflight = null;
  let again = false;
  let unsubs = [];
  let typingSentAt = 0;
  let typingOff = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    subscribers.forEach((fn) => fn());
  };
  const addMessages = (page) => set({ messages: mergeMessages(state.messages, page) });
  const setRead = (user, seq) => {
    if (user && seq > (state.reads[user] ?? 0)) set({ reads: { ...state.reads, [user]: seq } });
  };
  const clearTyping = (user) => {
    clearTimeout(typingTimers.get(user));
    typingTimers.delete(user);
    if (state.typing.includes(user)) set({ typing: state.typing.filter((u) => u !== user) });
  };

  async function load() {
    try {
      if (!state.conversation || !state.messages.length) {
        const c = await client.conversation(id);
        const reads = { ...state.reads };
        for (const m of c.members ?? []) reads[m.user_id] = Math.max(m.read_seq ?? 0, reads[m.user_id] ?? 0);
        set({ conversation: c, reads });
      }
      let after = lastSeq(state.messages);
      while (after > 0) {
        const page = await client.messages(id, { after, limit: 200 });
        addMessages(page.messages);
        if ((page.messages?.length ?? 0) < 200) break;
        after = page.messages[page.messages.length - 1].seq;
      }
      const count = Math.min(200, Math.max(pageSize, state.messages.length));
      const page = await client.messages(id, { last: count });
      if (floor < 0) floor = page.messages?.length ? page.messages[0].seq : (page.last_seq ?? 0) + 1;
      set({ messages: mergeMessages(state.messages, page.messages), loading: false, hasOlder: floor > 1, error: null });
    } catch (err) {
      set({ loading: false, error: err, ...(err?.status === 404 ? { closed: true } : {}) });
    }
  }

  function refresh() {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        again = false;
        await load();
      } while (again);
    })().finally(() => (inflight = null));
    return inflight;
  }

  function apply(event, d) {
    if ((event === 'chat.conversation' ? d.conversation?.id : d.conversation_id) !== id) return;
    switch (event) {
      case 'chat.message':
        clearTyping(d.message?.sender);
        setRead(d.message?.sender, d.message?.seq);
        addMessages([d.message]);
        break;
      case 'chat.message_updated':
        if (state.messages.some((m) => m.seq === d.message?.seq)) addMessages([d.message]);
        break;
      case 'chat.typing':
        if (d.user_id === client.user()) return;
        if (d.typing !== false) {
          clearTimeout(typingTimers.get(d.user_id));
          typingTimers.set(d.user_id, setTimeout(() => clearTyping(d.user_id), TYPING_SHOW_MS));
          if (!state.typing.includes(d.user_id)) set({ typing: [...state.typing, d.user_id] });
        } else {
          clearTyping(d.user_id);
        }
        break;
      case 'chat.read':
        setRead(d.user_id, d.read_seq);
        break;
      case 'chat.conversation': {
        const reads = { ...state.reads };
        for (const m of d.conversation.members ?? []) reads[m.user_id] = Math.max(m.read_seq ?? 0, reads[m.user_id] ?? 0);
        set({ conversation: d.conversation, reads });
        break;
      }
      default:
        set({ closed: true });
    }
  }

  async function stopTyping() {
    clearTimeout(typingOff);
    if (!typingSentAt) return;
    typingSentAt = 0;
    await client.typing(id, false).catch(() => {});
  }

  async function keep(promise) {
    const m = await promise;
    addMessages([m]);
    return m;
  }

  return {
    get: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    start() {
      if (unsubs.length) return;
      unsubs = [client.on(apply), client.onLive(() => refresh())];
      refresh();
    },
    stop() {
      unsubs.forEach((fn) => fn());
      unsubs = [];
      typingTimers.forEach((t) => clearTimeout(t));
      typingTimers.clear();
      clearTimeout(typingOff);
    },
    refresh,
    apply,
    /** Loads the page of messages before the oldest one loaded. */
    async loadOlder() {
      if (floor <= 1 || state.loadingOlder) return;
      set({ loadingOlder: true });
      try {
        const after = Math.max(0, floor - 1 - pageSize);
        const page = await client.messages(id, { after, limit: floor - 1 - after });
        floor = after + 1;
        set({ messages: mergeMessages(state.messages, page.messages), loadingOlder: false, hasOlder: floor > 1 });
      } catch (err) {
        set({ loadingOlder: false, error: err });
      }
    },
    /** Sends a message (text, or {text, metadata, attachments}) and adds the stored copy. */
    async send(message) {
      await stopTyping();
      const out = await client.send(id, message);
      addMessages([out.message]);
      return out.message;
    },
    edit: (seq, change) => keep(client.edit(id, seq, change)),
    remove: (seq) => keep(client.remove(id, seq)),
    translate: (seq, language) => keep(client.translate(id, seq, language)),
    /** Adds the user's reaction, or takes it back if they already reacted. */
    async toggleReaction(seq, emoji) {
      const me = await client.currentUser();
      const mine = state.messages.find((m) => m.seq === seq)?.reactions?.[emoji]?.includes(me) ?? false;
      return keep(client.react(id, seq, emoji, !mine));
    },
    /** Marks everything loaded as read, when it is not already. */
    async markRead() {
      const seq = lastSeq(state.messages);
      const me = await client.currentUser();
      if (!seq || (state.reads[me] ?? 0) >= seq) return;
      const { read_seq: readSeq = seq } = await client.read(id, seq);
      setRead(me, readSeq);
    },
    /** Call on every keystroke: says "typing" at most every 3 s, and stops after 5 s idle. */
    typing() {
      const now = Date.now();
      if (now - typingSentAt > 3000) {
        typingSentAt = now;
        client.typing(id, true).catch(() => {});
      }
      clearTimeout(typingOff);
      typingOff = setTimeout(() => void stopTyping(), 5000);
    },
    stopTyping,
    /** Members other than the user who have read message seq. */
    readBy: (seq) => Object.entries(state.reads).filter(([u, s]) => u !== client.user() && s >= seq).map(([u]) => u),
  };
}

/**
 * The user's conversations kept up to date: new messages move one to the
 * top and count as unread, reads clear the count, and conversations come
 * and go as the user joins, leaves or they are deleted.
 */
export function createConversationListStore(client, { pageSize = 30 } = {}) {
  let state = { conversations: [], loading: true, loadingMore: false, hasMore: false, unread: 0, error: null };
  const subscribers = new Set();
  let next = '';
  let unsubs = [];

  const set = (patch) => {
    const s = { ...state, ...patch };
    s.unread = s.conversations.reduce((n, c) => n + (c.unread ?? 0), 0);
    s.hasMore = !!next;
    state = s;
    subscribers.forEach((fn) => fn());
  };

  async function refresh() {
    try {
      const page = await client.conversations({ limit: pageSize });
      next = page.next ?? '';
      set({ conversations: page.conversations ?? [], loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err });
    }
  }

  function apply(event, d) {
    const me = client.user();
    const list = state.conversations;
    if (event === 'chat.message') {
      const c = list.find((x) => x.id === d.conversation_id);
      if (!c) return void refresh();
      const m = d.message ?? {};
      const unread = m.sender === me ? 0 : (c.unread ?? 0) + (m.kind === 'system' ? 0 : 1);
      const moved = { ...c, last_seq: Math.max(c.last_seq ?? 0, m.seq ?? 0), updated_at: m.created_at ?? c.updated_at, unread };
      set({ conversations: [moved, ...list.filter((x) => x.id !== c.id)] });
    } else if (event === 'chat.read') {
      if (d.user_id !== me) return;
      set({
        conversations: list.map((c) => (c.id === d.conversation_id && d.read_seq >= (c.last_seq ?? 0) ? { ...c, unread: 0 } : c)),
      });
    } else if (event === 'chat.conversation') {
      const old = list.find((x) => x.id === d.conversation.id);
      const updated = { ...d.conversation, unread: old?.unread ?? 0 };
      set({ conversations: old ? list.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...list] });
    } else if (event === 'chat.left' || event === 'chat.deleted') {
      set({ conversations: list.filter((c) => c.id !== d.conversation_id) });
    }
  }

  return {
    get: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    start() {
      if (unsubs.length) return;
      unsubs = [client.on(apply), client.onLive(() => refresh())];
      refresh();
    },
    stop() {
      unsubs.forEach((fn) => fn());
      unsubs = [];
    },
    refresh,
    apply,
    /** Loads the next page, if there is one. */
    async loadMore() {
      if (!next || state.loadingMore) return;
      set({ loadingMore: true });
      try {
        const page = await client.conversations({ limit: pageSize, before: next });
        next = page.next ?? '';
        const have = new Set(state.conversations.map((c) => c.id));
        set({ conversations: [...state.conversations, ...(page.conversations ?? []).filter((c) => !have.has(c.id))], loadingMore: false });
      } catch (err) {
        set({ loadingMore: false, error: err });
      }
    },
  };
}

/**
 * A chat client for the components inside <HibiraProvider>, taking live
 * events from its connection (sign the user in with pusher.signin()).
 * Pass the same options as createChatClient(), without pusher.
 */
export function useChatClient(options) {
  const pusher = usePusher();
  const ref = useRef(options);
  ref.current = options;
  const client = useMemo(
    () =>
      createChatClient({
        ...ref.current,
        token: typeof ref.current.token === 'function' ? () => ref.current.token() : ref.current.token,
      }),
    [options.appId, options.host, typeof options.token === 'string' ? options.token : null, options.tokenUrl],
  );
  useEffect(() => (pusher ? client.attach(pusher) : undefined), [client, pusher]);
  return client;
}

function useStore(store) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...store, ...state };
}

/** One conversation, live: { messages, typingUsers, reads, hasOlder, loadOlder, send, markRead, typing(), ... }. */
export function useChatConversation(client, id, { pageSize = 50 } = {}) {
  const store = useMemo(() => createConversationStore(client, id, { pageSize }), [client, id, pageSize]);
  const live = useStore(store);
  return { ...live, typingUsers: live.typing, typing: store.typing };
}

/** The user's conversations, live: { conversations, unread, loadMore, refresh, ... }. */
export function useChatConversations(client, { pageSize = 30 } = {}) {
  const store = useMemo(() => createConversationListStore(client, { pageSize }), [client, pageSize]);
  return useStore(store);
}
