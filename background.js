// What the connection does while the app is in the background. iOS suspends
// a backgrounded app within seconds and its socket dies quietly; Android
// keeps it open and it counts against the plan's concurrent connections.
// So after `timeout` ms in the background the connection is closed, and it
// opens again when the app comes back. Subscriptions are kept: pusher-js
// subscribes to them again when it reconnects.

export const DEFAULT_BACKGROUND_TIMEOUT = 30_000;

/**
 * Closes `pusher` after `timeout` ms in the background and reconnects it on
 * return. `appState` is React Native's AppState. Returns a function that
 * stops watching. timeout null keeps the connection open.
 */
export function watchAppState(pusher, appState, { timeout = DEFAULT_BACKGROUND_TIMEOUT, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!pusher || !appState || timeout == null) return () => {};
  let timer = null;
  let closed = false;

  const onChange = (state) => {
    if (state === 'active') {
      if (timer) clearTimer(timer);
      timer = null;
      const s = pusher.connection?.state;
      if (closed || s === 'disconnected' || s === 'unavailable' || s === 'failed') pusher.connect();
      closed = false;
    } else if (state === 'background' && !timer && !closed) {
      timer = setTimer(() => {
        timer = null;
        closed = true;
        pusher.disconnect();
      }, timeout);
    }
  };

  const sub = appState.addEventListener('change', onChange);
  return () => {
    if (timer) clearTimer(timer);
    sub?.remove?.();
  };
}
