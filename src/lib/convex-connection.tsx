import { useConvexAuth } from "convex/react";
import { useNetworkState } from "expo-network";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { convex } from "./convex-client";
import { hasInternetSignal } from "./network-state";
import { reportError } from "./observability";

const STALL_MS = 30_000;

export function connectionDiagnostics(): Record<string, number | boolean | null> {
  const state = convex.connectionState();
  return {
    ws_connected: state.isWebSocketConnected,
    has_ever_connected: state.hasEverConnected,
    connection_count: Math.min(state.connectionCount, 1_000),
    connection_retries: Math.min(state.connectionRetries, 1_000),
    inflight_actions: Math.min(state.inflightActions, 100),
    inflight_mutations: Math.min(state.inflightMutations, 100),
    oldest_inflight_ms: state.timeOfOldestInflightRequest
      ? Math.min(3_600_000, Math.max(0, Date.now() - state.timeOfOldestInflightRequest.getTime()))
      : null,
  };
}

// Convex keeps queries and requests waiting while its socket is down, so a socket that never comes back (for
// example after a failed token refresh) shows only spinners. Report one stall per outage while the phone is online.
export function ConvexConnectionWatch(): null {
  const online = hasInternetSignal(useNetworkState());
  const { isLoading, isAuthenticated } = useConvexAuth();
  const authState = useRef({ isLoading, isAuthenticated });
  useEffect(() => {
    authState.current = { isLoading, isAuthenticated };
  }, [isLoading, isAuthenticated]);
  useEffect(() => {
    if (!online) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reported = false;
    const stalled = () => !convex.connectionState().isWebSocketConnected && AppState.currentState === "active";
    const check = () => {
      if (!stalled()) {
        clearTimeout(timer);
        timer = undefined;
        if (convex.connectionState().isWebSocketConnected) reported = false;
        return;
      }
      if (timer || reported) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!stalled()) return;
        reported = true;
        reportError(new Error("Backend connection stalled"), "convex.connection", {
          level: "warning",
          data: {
            ...connectionDiagnostics(),
            auth_loading: authState.current.isLoading,
            authenticated: authState.current.isAuthenticated,
            stalled_ms: STALL_MS,
          },
        });
      }, STALL_MS);
    };
    const unsubscribe = convex.subscribeToConnectionState(check);
    const appState = AppState.addEventListener("change", check);
    check();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      appState.remove();
    };
  }, [online]);
  return null;
}
