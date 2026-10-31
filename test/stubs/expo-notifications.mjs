export const calls = [];
export let permission = 'undetermined';
export let token = { type: 'ios', data: 'ab'.repeat(32) };
const listeners = new Set();
export function setUp(next) {
  if (next.permission) permission = next.permission;
  if (next.token) token = next.token;
}
export async function getPermissionsAsync() {
  calls.push('getPermissions');
  return { status: permission };
}
export async function requestPermissionsAsync() {
  calls.push('requestPermissions');
  permission = 'granted';
  return { status: permission };
}
export async function getDevicePushTokenAsync() {
  calls.push('getDevicePushToken');
  return token;
}
export function addPushTokenListener(fn) {
  listeners.add(fn);
  return { remove: () => listeners.delete(fn) };
}
export function emitToken(t) {
  token = t;
  for (const fn of listeners) fn(t);
}
