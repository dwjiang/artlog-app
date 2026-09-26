import { hasInternetSignal, isOffline } from "./network-state";

it.each([
  [{}, false, false],
  [{ isConnected: false }, true, false],
  [{ isInternetReachable: false }, true, false],
  [{ isConnected: true }, false, true],
  [{ isInternetReachable: true }, false, true],
  [{ isConnected: true, isInternetReachable: false }, true, false],
  [{ isConnected: false, isInternetReachable: true }, true, false],
])("handles partial network state %j", (state, offline, onlineSignal) => {
  expect(isOffline(state)).toBe(offline);
  expect(hasInternetSignal(state)).toBe(onlineSignal);
});
