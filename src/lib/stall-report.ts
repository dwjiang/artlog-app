import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { AppState } from "react-native";

import { hasInternetSignal, isOffline } from "./network-state";
import { addBreadcrumb, reportError } from "./observability";

type DiagnosticData = Record<string, string | number | boolean | null | undefined>;
type StallOptions = { data?: () => DiagnosticData; requiresNetwork?: boolean };

export class StallError extends Error {
  constructor() {
    super("Operation did not finish");
    this.name = "StallError";
  }
}

// A request that never settles throws nothing, so a hang would leave no event. This reports once after
// `limitMs` of foreground time without changing the task's result. Leaving the app stops the watch, because
// iOS suspends the app and its requests in the background. Network watches also stop on an offline signal;
// a request waiting to reconnect is not an app stall.
export function reportIfStalled<T>(
  task: Promise<T>,
  operation: string,
  limitMs: number,
  options: StallOptions = {},
): Promise<T> {
  const started = Date.now();
  let stalled = false;
  let finished = false;
  let online = !options.requiresNetwork;
  let networkSubscription: ReturnType<typeof addNetworkStateListener> | undefined;
  const stop = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    subscription?.remove();
    networkSubscription?.remove();
  };
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") stop();
  });
  const timer = setTimeout(() => {
    if (!online) {
      stop();
      return;
    }
    stalled = true;
    stop();
    let extra: DiagnosticData = {};
    try {
      extra = options.data?.() ?? {};
    } catch {
      // Diagnostics must never replace the watched task's outcome.
    }
    reportError(new StallError(), operation, {
      level: "warning",
      data: { ...extra, app_state: AppState.currentState, limit_ms: limitMs },
    });
  }, limitMs);
  if (options.requiresNetwork) {
    const checkNetwork = (state: NetworkState) => {
      if (finished) return;
      online = hasInternetSignal(state);
      if (isOffline(state)) stop();
    };
    try {
      networkSubscription = addNetworkStateListener(checkNetwork);
      void getNetworkStateAsync().then(checkNetwork, stop);
    } catch {
      // Without connectivity evidence, a network stall cannot be distinguished from an offline wait.
      stop();
    }
  }
  const settle = () => {
    if (!finished) stop();
    if (stalled) addBreadcrumb(`${operation}.settled`, { elapsed_ms: Math.min(3_600_000, Date.now() - started) });
  };
  // Diagnostics must never break the watched call, even one that hands back a plain value.
  Promise.resolve(task).then(settle, settle);
  return task;
}
