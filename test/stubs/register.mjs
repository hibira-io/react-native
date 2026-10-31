// Resolves react-native (and the Expo modules) to the stubs in this folder,
// so the entry points load in Node.
import { register } from 'node:module';
register(new URL('./hooks.mjs', import.meta.url));
