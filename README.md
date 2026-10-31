# @hibira-io/react-native

[![npm](https://img.shields.io/npm/v/@hibira-io/react-native)](https://www.npmjs.com/package/@hibira-io/react-native)
[![ci](https://github.com/hibira-io/react-native/actions/workflows/ci.yml/badge.svg)](https://github.com/hibira-io/react-native/actions/workflows/ci.yml)

React Native and Expo hooks for [Hibira](https://hibira.io), or any
Pusher-compatible server, plus push notifications through Hibira Push.

- **Channels**: the hooks of [@hibira-io/react](https://github.com/hibira-io/react)
  (`useEvent`, `usePresence`, `useTrigger`, `useStream`...) on the React
  Native build of pusher-js.
- **Background aware**: the connection closes in the background (after 30 s on iOS, at once on Android)
  and opens again when the app returns, so a phone in a pocket does not hold
  one of your plan's connections.
- **Payloads of any size**: `triggerChunked()` and `useChunkedTrigger()` split
  what does not fit in one message (Free plans allow 4 KB) and
  `useChunkedEvent()` puts it back together.
- **Push notifications**: registers the device's FCM / APNs token with Hibira
  Push (Beams-compatible) from `expo-notifications`, or from any other source
  of the native token. Interests, users and token refresh included.
- Plain ESM with TypeScript types. Expo SDK 50+ and bare React Native 0.70+.

## Install

```sh
npx expo install @hibira-io/react-native pusher-js @react-native-community/netinfo
# for push notifications:
npx expo install expo-notifications @react-native-async-storage/async-storage
```

In a bare React Native app use `npm install` with the same packages, then
`npx pod-install`.

## Setup

Wrap your app once. The app key is in the Hibira portal; it is public.

```jsx
import { HibiraProvider } from '@hibira-io/react-native';

export default function App() {
  return (
    <HibiraProvider
      appKey={process.env.EXPO_PUBLIC_HIBIRA_KEY}
      options={{
        channelAuthorization: {
          endpoint: 'https://api.example.com/hibira/auth',
          transport: 'ajax',
          headersProvider: () => ({ Authorization: `Bearer ${session.token}` }),
        },
      }}
    >
      <Home />
    </HibiraProvider>
  );
}
```

`options` are [pusher-js options](https://github.com/pusher/pusher-js#configuration)
merged over the Hibira defaults (`wsHost: 'ws.hibira.io'`, TLS). For a server
on your computer, set `wsHost` to its LAN address (not `localhost`, which is
the phone itself), `wsPort` and `forceTLS: false`.

| Prop | Default | |
| --- | --- | --- |
| `appKey` | | app key from the portal |
| `options` | | pusher-js options |
| `client` | | an existing pusher-js client to use instead |
| `backgroundTimeout` | `30000` | ms in the background before the connection closes; `null` keeps it open. Android pauses JS timers in the background, so there the connection closes as soon as the app leaves the foreground |

Subscriptions survive the background: they are made again when the
connection comes back. Events sent while the app was away are not replayed,
so refetch what matters when the app becomes active.

### Allowed origins

Apps on Hibira need nothing in their allowed origins for React Native.
React Native's WebSocket sends an Origin made from the socket URL (iOS
`https://ws.hibira.io`, Android `https://ws.hibira.io:443`); Hibira knows
that Origin as a native app's and does not apply the allowlist to it. A
self-hosted pusher-server older than v0.2.26 does not, so there add both
to the app's allowed origins (or upgrade).

## Hooks

```jsx
import { useEvent, usePresence, useTrigger, useConnectionState, useStream } from '@hibira-io/react-native';

function Orders() {
  const [orders, setOrders] = useState([]);
  useEvent('orders', 'order.created', (order) => setOrders((list) => [order, ...list]));
  return <OrderList orders={orders} />;
}

function Room({ id }) {
  const { others, count } = usePresence(`presence-room-${id}`);
  const trigger = useTrigger(`presence-room-${id}`);
  return <TextInput onChangeText={() => trigger('client-typing', {})} />;
}
```

`usePusher`, `useChannel`, `useEvent`, `usePresence`, `useTrigger`,
`useConnectionState` and `useStream` behave exactly as in
[@hibira-io/react](https://github.com/hibira-io/react#hooks), including LLM
streaming with `streamToChannel()` (import it from
`@hibira-io/react-native/server`).

## Payloads bigger than one message

The Free plan allows 4 KB per message. Send bigger payloads in chunks from
your backend:

```js
import Pusher from 'pusher';
import { triggerChunked } from '@hibira-io/react-native/server';

await triggerChunked(pusher, 'catalogue', 'catalogue.updated', { items });
```

and receive them whole in the app:

```jsx
import { useChunkedEvent } from '@hibira-io/react-native';

useChunkedEvent('catalogue', 'catalogue.updated', (data) => setItems(data.items));
```

Client events work the same way, on private and presence channels with
client events turned on:

```jsx
const send = useChunkedTrigger('private-board-1');
await send('client-drawing', strokes); // true once every chunk is sent
```

A payload that fits is sent as one ordinary event, so other listeners
(`useEvent`, the web SDKs) still get small events as they are. A bigger one
becomes a run of events of at most 3500 bytes each (`maxBytes`), sent one
after another; client events go out 110 ms apart to stay inside the 10
client events per second a connection may send. Each chunk counts as one
message against the plan's daily messages, and payloads that would need more
than 100 chunks (`maxChunks`) are refused. Chunks that never complete (the
sender went away) are dropped after 30 s.

Other runtimes can use the same format from `@hibira-io/react-native/chunk`
(`chunkPayload`, `createChunkAssembler`), which has no React Native imports.

## Push notifications

Hibira Push delivers through FCM on Android and APNs on iOS, with a device
API compatible with Pusher Beams. In the portal, turn on Push notifications
for the app, upload your Firebase service account and APNs key, and copy the
instance ID.

```jsx
import { createExpoPush, useHibiraPush, TokenProvider } from '@hibira-io/react-native/expo';
import * as Application from 'expo-application';

const push = createExpoPush({
  instanceId: process.env.EXPO_PUBLIC_HIBIRA_PUSH_INSTANCE,
  bundleIdentifier: Application.applicationId, // iOS: the APNs topic
});

const tokenProvider = new TokenProvider({
  url: 'https://api.example.com/push-auth',
  headers: () => ({ Authorization: `Bearer ${session.token}` }),
});

function Notifications({ user }) {
  const { ready, error } = useHibiraPush(push, {
    interests: ['orders', `team-${user.teamId}`],
    userId: user.id,
    tokenProvider,
  });
  return ready ? null : <Text>{error?.message ?? 'Turning on notifications…'}</Text>;
}
```

`createExpoPush()` asks for notification permission on `start()`, registers
the device's native token (`getDevicePushTokenAsync()`, not an Expo push
token), keeps the device ID in AsyncStorage so a relaunch does not register
again, and sends a new token when the system changes it.
`useHibiraPush(push, options)` starts it while mounted (`enabled: false`
waits, for example until after onboarding), keeps the device's interests
equal to `interests`, and links `userId`.

Without the hook:

```js
await push.start();                     // → device ID
await push.addDeviceInterest('news');
await push.setDeviceInterests(['news', 'sale-jp']);
await push.getDeviceInterests();
await push.setUserId('user-1', tokenProvider);
await push.stop();                       // on sign out: deletes the device
await push.getRegistrationState();       // PERMISSION_DENIED, PERMISSION_GRANTED_REGISTERED...
```

Your backend's token endpoint answers `GET ?user_id=...` with
`{"token": "..."}`, made with `generateToken(userId)` of any Beams server SDK
and the instance's secret key, after checking the signed-in user is that
user. Publish with any Beams server SDK pointed at `https://ws.hibira.io`.

Notes:

- Push needs a development build (`npx expo run:ios`, EAS Build), not
  Expo Go. Add `"plugins": ["expo-notifications"]` to `app.json`.
- Android: put the Firebase project's `google-services.json` in the app
  (`android.googleServicesFile` in `app.json`). On Android 13+ create a
  notification channel with `Notifications.setNotificationChannelAsync()`.
- iOS: debug builds get development APNs tokens; set the instance's APNs
  environment to Development while you test from Xcode.
- Showing notifications while the app is open is up to
  `Notifications.setNotificationHandler()`.

### Without Expo

`HibiraPush` from `@hibira-io/react-native/push` takes the token from
anywhere, for example `@react-native-firebase/messaging`:

```js
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HibiraPush } from '@hibira-io/react-native/push';

const push = new HibiraPush({
  instanceId: 'YOUR_INSTANCE_ID',
  storage: AsyncStorage,
  getToken: async () =>
    Platform.OS === 'ios'
      ? { platform: 'apns', token: await messaging().getAPNSToken() }
      : { platform: 'fcm', token: await messaging().getToken() },
});
messaging().onTokenRefresh((token) => push.updateToken(token));
```

Pass `endpoint` for a self-hosted server.

## Example

[`example/`](example) is an Expo app with a live order feed, presence, a
chunked catalogue and push notifications.

## Development

```sh
npm install
npm test            # unit tests, React Native stubbed
npm run typecheck
npm run test:e2e    # against a running server, see test/e2e/sdk.e2e.mjs
```

The `android` workflow builds `e2e/android` as a release APK and runs it on an
Android emulator, driven from the host by `e2e/android/backend.mjs`. It checks
the connection, chunked events both ways under a 4 KB limit, presence, the
background disconnect and reconnect, and push registration. Each run goes
against soketi first, and also against ws.hibira.io when these repository
secrets are set:

| Secret | For |
| --- | --- |
| `HIBIRA_E2E_APP_ID`, `HIBIRA_E2E_KEY`, `HIBIRA_E2E_SECRET` | a Free app with client events on (native Origin, 4 KB limit) |
| `HIBIRA_E2E_PUSH_INSTANCE`, `HIBIRA_E2E_PUSH_SECRET` | a Hibira Push instance: registration, interests, delete |
| `GOOGLE_SERVICES_JSON` | Firebase config for package `io.hibira.e2e`, with that project's service account uploaded to the push instance: real FCM delivery |

## Licence

MIT
