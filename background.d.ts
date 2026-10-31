import type Pusher from 'pusher-js';

export const DEFAULT_BACKGROUND_TIMEOUT: number;

export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void } | undefined;
}

/** Closes the connection after `timeout` ms in the background and reconnects on return; null keeps it open. */
export function watchAppState(
  pusher: Pick<Pusher, 'connect' | 'disconnect' | 'connection'> | null | undefined,
  appState: AppStateLike,
  options?: {
    timeout?: number | null;
    /** Close on entering the background instead of after timeout; default in HibiraProvider on Android. */
    immediate?: boolean;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    now?: () => number;
  },
): () => void;
