// React Native and Expo hooks for Hibira Channels. The hooks are those of
// @hibira-io/react (pusher-js picks its React Native build through the
// package's "react-native" field); this adds what a phone needs: the
// connection closes while the app sits in the background and opens again
// when it returns, and payloads too big for one message (Free plans allow
// 4 KB) are sent in chunks and put back together.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  HibiraProvider as WebProvider,
  hibiraOptions,
  useChannel,
  useEvent,
  usePusher,
} from '@hibira-io/react';
import { watchAppState, DEFAULT_BACKGROUND_TIMEOUT } from './background.js';
import { chunkPayload, createChunkAssembler } from './chunk.js';
import { PusherClient } from './pusher-client.js';

export {
  HIBIRA_DEFAULTS,
  STREAM_EVENT,
  createStreamStore,
  hibiraOptions,
  useChannel,
  useConnectionState,
  useEvent,
  usePresence,
  usePusher,
  useStream,
  useTrigger,
} from '@hibira-io/react';
export { DEFAULT_BACKGROUND_TIMEOUT, watchAppState } from './background.js';
export { CHUNK_KEY, DEFAULT_MAX_BYTES, DEFAULT_MAX_CHUNKS, chunkPayload, createChunkAssembler, isChunk } from './chunk.js';

/**
 * Opens one Hibira connection for the components inside it.
 *
 * @param {object} props
 * @param {string} [props.appKey] the app key from the Hibira portal
 * @param {object} [props.options] pusher-js options, merged over HIBIRA_DEFAULTS
 * @param {object} [props.client] an existing pusher-js client to use instead
 * @param {number|null} [props.backgroundTimeout=30000] ms in the background
 *   before the connection closes; null keeps it open
 */
export function HibiraProvider({ appKey, options, client, backgroundTimeout = DEFAULT_BACKGROUND_TIMEOUT, children }) {
  // The client is made here rather than by @hibira-io/react, whose default
  // import of pusher-js is not the constructor under Metro.
  const [own, setOwn] = useState(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (client || !appKey) return undefined;
    const pusher = new PusherClient(appKey, hibiraOptions(optionsRef.current));
    setOwn(pusher);
    return () => {
      pusher.disconnect();
      setOwn(null);
    };
  }, [client, appKey]);

  return createElement(
    WebProvider,
    { client: client ?? own },
    createElement(AppStateWatcher, { timeout: backgroundTimeout }),
    children,
  );
}

function AppStateWatcher({ timeout }) {
  const pusher = usePusher();
  const immediate = Platform.OS === 'android';
  useEffect(() => watchAppState(pusher, AppState, { timeout, immediate }), [pusher, timeout, immediate]);
  return null;
}

/**
 * Like useEvent, for events sent with useChunkedTrigger() or triggerChunked()
 * from @hibira-io/react-native/server: handler(data, metadata) runs once per
 * whole payload. Plain events pass straight through.
 */
export function useChunkedEvent(target, event, handler, { timeout } = {}) {
  const assembler = useMemo(() => createChunkAssembler({ timeout }), [timeout]);
  return useEvent(target, event, (payload, metadata) => {
    const whole = assembler.add(payload, metadata?.user_id);
    if (whole) handler?.(whole.data, metadata);
  });
}

/**
 * Like useTrigger, for client events of any size: resolves to true once
 * every chunk is sent, false when the channel is not subscribed. Chunks go
 * out `interval` ms apart, inside the 10 client events per second a
 * connection may send.
 */
export function useChunkedTrigger(target, { maxBytes, maxChunks, interval = 110 } = {}) {
  const named = target == null || typeof target === 'string';
  const subscribed = useChannel(named ? target : null);
  const channel = named ? subscribed : target;
  const ref = useRef(channel);
  ref.current = channel;

  return useCallback(
    async (event, data) => {
      if (typeof event !== 'string' || !event.startsWith('client-')) {
        throw new Error(`useChunkedTrigger: "${event}" must start with "client-"`);
      }
      const events = chunkPayload(data ?? {}, { maxBytes, maxChunks });
      for (let i = 0; i < events.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, interval));
        const ch = ref.current;
        if (!ch || !ch.subscribed) return false;
        if (!ch.trigger(event, events[i])) return false;
      }
      return true;
    },
    [maxBytes, maxChunks, interval],
  );
}
