import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_KEY, chunkPayload, createChunkAssembler, isChunk, utf8Bytes } from '../chunk.js';
import { SDK_VERSION } from '../version.js';
import { readFileSync } from 'node:fs';

const big = (n) => ({
  items: Array.from({ length: n }, (_, i) => ({ i, name: `項目 ${i} "quoted" \\ 🎉`, note: 'x'.repeat(40) })),
});

test('a payload that fits is sent as it is', () => {
  const data = { hello: 'world' };
  assert.deepEqual(chunkPayload(data), [data]);
  assert.deepEqual(chunkPayload(null), [null]);
});

test('every chunk stays under maxBytes as the server measures it', () => {
  for (const maxBytes of [3500, 1000, 200]) {
    const events = chunkPayload(big(300), { maxBytes, maxChunks: 10000 });
    assert.ok(events.length > 1);
    for (const e of events) {
      assert.ok(isChunk(e));
      const size = Buffer.byteLength(JSON.stringify(e));
      assert.ok(size <= maxBytes, `${size} > ${maxBytes}`);
    }
  }
});

test('the Free plan default keeps chunks under 4 KB', () => {
  for (const e of chunkPayload(big(500))) assert.ok(Buffer.byteLength(JSON.stringify(e)) <= 4096);
});

test('chunks put back together in any order, duplicates ignored', () => {
  const data = big(200);
  const events = chunkPayload(data, { maxBytes: 500, maxChunks: 1000 });
  const a = createChunkAssembler();
  const shuffled = [...events].reverse();
  shuffled.splice(3, 0, events[5]);
  let out = null;
  for (const e of shuffled) {
    const r = a.add(e);
    if (r) {
      assert.equal(out, null, 'completes once');
      out = r;
    }
  }
  assert.deepEqual(out.data, data);
  assert.equal(a.pending, 0);
});

test('characters are never cut in half', () => {
  const data = { s: '🎉'.repeat(500) + '中'.repeat(500) };
  const events = chunkPayload(data, { maxBytes: 120, maxChunks: 10000 });
  for (const e of events) assert.equal(Buffer.from(e.part, 'utf8').toString('utf8'), e.part);
  const a = createChunkAssembler();
  let whole;
  for (const e of events) whole = a.add(e) ?? whole;
  assert.deepEqual(whole.data, data);
});

test('plain payloads pass through the assembler', () => {
  assert.deepEqual(createChunkAssembler().add({ a: 1 }), { data: { a: 1 } });
});

test('maxChunks refuses payloads that would take too many messages', () => {
  assert.throws(() => chunkPayload(big(500), { maxBytes: 500, maxChunks: 3 }), RangeError);
  assert.throws(() => chunkPayload(big(5), { maxBytes: 20 }), RangeError);
});

test('incomplete payloads expire, and senders are kept apart', () => {
  let t = 0;
  const a = createChunkAssembler({ timeout: 1000, now: () => t });
  const e1 = chunkPayload(big(50), { maxBytes: 500, id: 'same' });
  const e2 = chunkPayload(big(60), { maxBytes: 500, id: 'same' });
  a.add(e1[0], 'alice');
  a.add(e2[0], 'bob');
  assert.equal(a.pending, 2);
  t = 5000;
  a.add({ [CHUNK_KEY]: { id: 'other', i: 0, n: 2 }, part: '' });
  assert.equal(a.pending, 1, 'the old ones are gone');
  let bob;
  for (const e of e2) bob = a.add(e, 'bob') ?? bob;
  assert.deepEqual(bob.data, big(60));
});

test('utf8Bytes matches Buffer.byteLength', () => {
  for (const s of ['', 'abc', 'é', '中文', '🎉x', '\ud800']) assert.equal(utf8Bytes(s), Buffer.byteLength(s), s);
});

test('SDK_VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(SDK_VERSION, pkg.version);
});
