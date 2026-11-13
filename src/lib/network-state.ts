import type { NetworkState } from "expo-network";

type Connection = Pick<NetworkState, "isConnected" | "isInternetReachable">;

export function isOffline(state: Connection): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

export function hasInternetSignal(state: Connection): boolean {
  return !isOffline(state) && (state.isInternetReachable ?? state.isConnected) === true;
}

let lastSignal: "online" | "offline" | "unknown" = "unknown";

export function rememberNetworkSignal(state: Connection): void {
  lastSignal = isOffline(state) ? "offline" : hasInternetSignal(state) ? "online" : "unknown";
}

export function lastNetworkSignal(): typeof lastSignal {
  return lastSignal;
}
