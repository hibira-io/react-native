// Just enough of react-native for the hooks: an AppState tests drive by hand,
// and a Platform whose OS tests can set.
export const Platform = { OS: 'ios' };
const listeners = new Set();
export const AppState = {
  currentState: 'active',
  addEventListener(type, fn) {
    listeners.add(fn);
    return { remove: () => listeners.delete(fn) };
  },
  set(state) {
    AppState.currentState = state;
    for (const fn of [...listeners]) fn(state);
  },
  get listeners() {
    return listeners.size;
  },
};
