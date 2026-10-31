import type { ReactElement } from 'react';
import type { HibiraProviderProps as WebProviderProps, Channel, ChannelTarget } from '@hibira-io/react';

export * from '@hibira-io/react';
export { DEFAULT_BACKGROUND_TIMEOUT, watchAppState } from './background.js';
export type { AppStateLike } from './background.js';
export { CHUNK_KEY, DEFAULT_MAX_BYTES, DEFAULT_MAX_CHUNKS, chunkPayload, createChunkAssembler, isChunk } from './chunk.js';
export type { ChunkEnvelope, ChunkOptions, ChunkAssembler } from './chunk.js';

export interface HibiraProviderProps extends WebProviderProps {
  /** ms in the background before the connection closes, default 30000 (Android closes at once: its JS timers pause there); null keeps it open. */
  backgroundTimeout?: number | null;
}

export function HibiraProvider(props: HibiraProviderProps): ReactElement;

/** useEvent for chunked payloads: handler runs once per whole payload. */
export function useChunkedEvent<T = any>(
  target: ChannelTarget,
  event: string | null | undefined,
  handler: (data: T, metadata?: { user_id?: string }) => void,
  options?: { timeout?: number },
): Channel | null;

/** Sends a client event of any size in chunks; true once all are sent, false when not subscribed. */
export function useChunkedTrigger(
  target: ChannelTarget,
  options?: { maxBytes?: number; maxChunks?: number; interval?: number },
): (event: `client-${string}`, data?: any) => Promise<boolean>;
