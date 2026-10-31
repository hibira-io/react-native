export const CHUNK_KEY: 'hibira:chunk';
/** 3500: room under the Free plan's 4 KB per message. */
export const DEFAULT_MAX_BYTES: number;
export const DEFAULT_MAX_CHUNKS: number;

export interface ChunkEnvelope {
  'hibira:chunk': { id: string; i: number; n: number };
  part: string;
}

export interface ChunkOptions {
  /** Largest event payload in bytes, default 3500. */
  maxBytes?: number;
  /** Refuse payloads that need more events than this, default 100. */
  maxChunks?: number;
  /** Payload id, default random. */
  id?: string;
}

/** [data] when it fits in maxBytes, else the chunk envelopes to send in order. */
export function chunkPayload<T>(data: T, options?: ChunkOptions): Array<T | ChunkEnvelope>;

export function isChunk(payload: unknown): payload is ChunkEnvelope;

export interface ChunkAssembler {
  /** { data } once the payload is whole (at once for plain payloads), else null. `from` keeps senders apart (user_id). */
  add(payload: unknown, from?: string): { data: any } | null;
  readonly pending: number;
  clear(): void;
}

export function createChunkAssembler(options?: {
  /** ms to wait for missing chunks, default 30000. */
  timeout?: number;
  /** Payloads collected at once, default 20. */
  maxPending?: number;
  now?: () => number;
}): ChunkAssembler;

/** UTF-8 length of a string. */
export function utf8Bytes(s: string): number;
