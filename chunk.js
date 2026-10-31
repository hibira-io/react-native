// Splits a payload that is too big for one message into several, and puts
// them back together on the other side. Free plans allow 4 KB per message;
// the limit is per message, so a bigger payload is sent as a run of events,
// all with the same event name:
//
//   { "hibira:chunk": { id, i: 0, n: 3 }, part: "{\"items\":[..." }
//   { "hibira:chunk": { id, i: 1, n: 3 }, part: "..." }
//   { "hibira:chunk": { id, i: 2, n: 3 }, part: "...]}" }
//
// `part`s are slices of JSON.stringify(data). A payload that fits is sent as
// it is, so listeners that know nothing of chunks still get small events.
// Each chunk counts as one message against the plan's daily messages.

export const CHUNK_KEY = 'hibira:chunk';
export const DEFAULT_MAX_BYTES = 3500;
export const DEFAULT_MAX_CHUNKS = 100;

// UTF-8 length; TextEncoder is missing on older Hermes.
export function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
const bytes = utf8Bytes;

/**
 * The events to send for `data`: [data] when it fits in `maxBytes`, else
 * chunk envelopes. Throws when it needs more than `maxChunks` events.
 */
export function chunkPayload(data, { maxBytes = DEFAULT_MAX_BYTES, maxChunks = DEFAULT_MAX_CHUNKS, id = randomId() } = {}) {
  const text = JSON.stringify(data ?? null);
  if (bytes(text) <= maxBytes) return [data ?? null];

  // Room left for `part` once the envelope is counted, with i and n at their
  // widest so the estimate holds for every chunk.
  const width = 10 ** String(maxChunks).length - 1;
  const overhead = bytes(JSON.stringify({ [CHUNK_KEY]: { id, i: width, n: width }, part: '' }));
  const budget = maxBytes - overhead;
  if (budget < 16) throw new RangeError(`chunkPayload: maxBytes ${maxBytes} is too small`);

  const parts = [];
  let part = '';
  let size = 0;
  for (const ch of text) {
    const cost = bytes(JSON.stringify(ch)) - 2; // escaped size inside a JSON string
    if (size + cost > budget) {
      parts.push(part);
      part = '';
      size = 0;
    }
    part += ch;
    size += cost;
  }
  parts.push(part);
  if (parts.length > maxChunks) {
    throw new RangeError(`chunkPayload: payload needs ${parts.length} events, more than maxChunks (${maxChunks})`);
  }
  const n = parts.length;
  return parts.map((p, i) => ({ [CHUNK_KEY]: { id, i, n }, part: p }));
}

export function isChunk(payload) {
  const c = payload && typeof payload === 'object' ? payload[CHUNK_KEY] : null;
  return !!c && typeof c === 'object' && c.id != null && Number.isInteger(c.i) && Number.isInteger(c.n) && typeof payload.part === 'string';
}

/**
 * Collects chunks. `add(payload)` returns { data } once a payload is
 * whole (at once for a payload that was not chunked), else null. Chunks may
 * arrive in any order; a payload still missing chunks after `timeout` ms
 * (the sender went away, or we subscribed halfway) is dropped.
 */
export function createChunkAssembler({ timeout = 30_000, maxPending = 20, now = Date.now } = {}) {
  const pending = new Map(); // key -> { parts, got, n, at }

  function add(payload, from) {
    if (!isChunk(payload)) return { data: payload };
    const { id, i, n } = payload[CHUNK_KEY];
    if (n < 1 || i < 0 || i >= n) return null;
    const t = now();
    for (const [k, p] of pending) if (t - p.at > timeout) pending.delete(k);

    // Chunks of client events from different people may share an id.
    const key = `${from ?? ''}\u0000${id}`;
    let p = pending.get(key);
    if (!p || p.n !== n) {
      p = { parts: new Array(n), got: 0, n, at: t };
      pending.set(key, p);
      if (pending.size > maxPending) pending.delete(pending.keys().next().value);
    }
    if (p.parts[i] === undefined) {
      p.parts[i] = payload.part;
      p.got++;
    }
    if (p.got < n) return null;
    pending.delete(key);
    try {
      return { data: JSON.parse(p.parts.join('')) };
    } catch {
      return null;
    }
  }

  return {
    add,
    get pending() {
      return pending.size;
    },
    clear() {
      pending.clear();
    },
  };
}

function randomId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 16);
  if (c && typeof c.getRandomValues === 'function') {
    return Array.from(c.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
