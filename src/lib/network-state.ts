import type { NetworkState } from "expo-network";

type Connection = Pick<NetworkState, "isConnected" | "isInternetReachable">;

export function isOffline(state: Connection): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

export function hasInternetSignal(state: Connection): boolean {
  return !isOffline(state) && (state.isInternetReachable ?? state.isConnected) === true;
}
