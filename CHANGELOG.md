# Changelog

## 0.1.1

- Fix: `HibiraProvider` with `appKey` crashed on React Native with
  "Object cannot be used as a constructor". pusher-js's React Native build
  has no default export, so the provider now makes the client itself.
- Fix: on Android the connection stayed open in the background, because
  Android pauses JS timers there and the 30 s timer never fired. It now closes
  as soon as the app leaves the foreground on Android. On any platform,
  coming back after `backgroundTimeout` opens a fresh connection.
- CI runs the SDK on an Android emulator (`e2e/android`).

## 0.1.0

First release: `HibiraProvider` with background handling, the hooks of
`@hibira-io/react`, chunked payloads (`triggerChunked`, `useChunkedTrigger`,
`useChunkedEvent`) for the 4 KB Free plan limit, and Hibira Push
(`HibiraPush`, `createExpoPush`, `useHibiraPush`).
