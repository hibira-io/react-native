// The pusher-js constructor. Its React Native build ends in
// `module.exports.Pusher = ...` with no default export, so under Metro
// `import Pusher from 'pusher-js'` is that object, not the class; the Node
// and web builds export the class itself.
import * as PusherModule from 'pusher-js';

export function resolvePusher(mod) {
  for (const c of [mod?.default, mod?.default?.Pusher, mod?.Pusher, mod]) {
    if (typeof c === 'function') return c;
  }
  throw new Error('@hibira-io/react-native: pusher-js did not export a Pusher constructor');
}

export const PusherClient = resolvePusher(PusherModule);
