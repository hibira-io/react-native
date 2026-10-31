import type { Triggerer } from '@hibira-io/react/server';

export * from '@hibira-io/react/server';
export { chunkPayload, createChunkAssembler, CHUNK_KEY } from './chunk.js';

/** Sends data in as many events as needed to keep each under maxBytes; resolves to the number sent. */
export function triggerChunked(
  pusher: Triggerer,
  channel: string,
  event: string,
  data: any,
  options?: { maxBytes?: number; maxChunks?: number; socketId?: string },
): Promise<number>;
