// What the connection does while the app is in the background. iOS suspends
// a backgrounded app within seconds and its socket dies quietly; Android
// keeps it open and it counts against the plan's concurrent connections.
// So after `timeout` ms in the background the connection is closed, and it
// opens again when the app comes back. Subscriptions are kept: pusher-js
// subscribes to them again when it reconnects.
//
// Android pauses JS timers while the app is in the background (onHostPause),
// so a timer there would never fire: with `immediate` (the default on
// Android) the connection closes as soon as the app leaves the foreground.
// Where a timer did not get to run (iOS suspended the app), coming back after
// `timeout` opens a fresh connection instead of trusting the old socket.

export const DEFAULT_BACKGROUND_TIMEOUT = 30_000;

/**
 * Closes `pusher` after `timeout` ms in the background and reconnects it on
 * return. `appState` is React Native's AppState. Returns a function that
 * stops watching. timeout null keeps the connection open; immediate closes
 * it on entering the background (Android, where timers are paused there).
 */
export function watchAppState(
  pusher,
  appState,
  { timeout = DEFAULT_BACKGROUND_TIMEOUT, immediate = false, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {},
) {
  if (!pusher || !appState || timeout == null) return () => {};
  let timer = null;
  let closed = false;
  let leftAt = null;

  const close = () => {
    timer = null;
    closed = true;
    pusher.disconnect();
  };

  const onChange = (state) => {
    if (state === 'active') {
      if (timer) clearTimer(timer);
      timer = null;
      const away = leftAt == null ? 0 : now() - leftAt;
      leftAt = null;
      if (!closed && away >= timeout) pusher.disconnect();
      const s = pusher.connection?.state;
      if (closed || away >= timeout || s === 'disconnected' || s === 'unavailable' || s === 'failed') pusher.connect();
      closed = false;
    } else if (state === 'background' && !timer && !closed) {
      leftAt = now();
      if (immediate || timeout <= 0) close();
      else timer = setTimer(close, timeout);
    }
  };

  const sub = appState.addEventListener('change', onChange);
  return () => {
    if (timer) clearTimer(timer);
    sub?.remove?.();
  };
}
