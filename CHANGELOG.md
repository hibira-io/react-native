# Changelog

## 0.1.1

- Fix: `HibiraProvider` with `appKey` crashed on React Native with
  "Object cannot be used as a constructor". pusher-js's React Native build
  has no default export, so the provider now makes the client itself.
- CI runs the SDK on an Android emulator (`e2e/android`).

## 0.1.0

First release: `HibiraProvider` with background handling, the hooks of
`@hibira-io/react`, chunked payloads (`triggerChunked`, `useChunkedTrigger`,
`useChunkedEvent`) for the 4 KB Free plan limit, and Hibira Push
(`HibiraPush`, `createExpoPush`, `useHibiraPush`).
