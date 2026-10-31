// For your Node backend: streamToChannel() (LLM output for useStream) from
// @hibira-io/react, and triggerChunked() for payloads bigger than one
// message, which useChunkedEvent() puts back together.

import { chunkPayload } from './chunk.js';

export { streamToChannel, textOf } from '@hibira-io/react/server';
export { chunkPayload, createChunkAssembler, CHUNK_KEY } from './chunk.js';

/**
 * Sends `data` on a channel in as many events as it takes to keep each
 * under `maxBytes` (default 3500; Free plans allow 4 KB per message).
 * Events go one after another. Resolves to the number of events sent.
 * `pusher` is the `pusher` package's client, or anything with its trigger().
 */
export async function triggerChunked(pusher, channel, event, data, { maxBytes, maxChunks, socketId } = {}) {
  const events = chunkPayload(data, { maxBytes, maxChunks });
  const params = socketId ? { socket_id: socketId } : undefined;
  for (const payload of events) await pusher.trigger(channel, event, payload, params);
  return events.length;
}
