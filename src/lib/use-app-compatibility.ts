import Constants from "expo-constants";
import { addNetworkStateListener } from "expo-network";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { isIosBuildSupported, parseIosBuild } from "@/shared/app-compatibility";

import { cacheMinimum, fetchMinimum, readCachedMinimum } from "./app-compatibility";
import { hasInternetSignal } from "./network-state";
import { reportError } from "./observability";

const checkTimeoutMs = 4_000;
const checkIntervalMs = 60_000;

export function useAppCompatibility() {
  const [minimum, setMinimum] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const build = Constants.platform?.ios?.buildNumber ?? null;

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    let request: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      if (disposed || !initialized || request || AppState.currentState !== "active") return;
      const controller = new AbortController();
      request = controller;
      timeout = setTimeout(() => controller.abort(), checkTimeoutMs);
      try {
        const next = await fetchMinimum(controller.signal);
        if (disposed || request !== controller || controller.signal.aborted) return;
        setMinimum(next);
        await cacheMinimum(next);
      } catch (cause) {
        if (!controller.signal.aborted) reportError(cause, "app-update.check");
      } finally {
        if (request === controller) {
          clearTimeout(timeout);
          request = null;
          if (!disposed) setLoading(false);
        }
      }
    }

    function cancel() {
      request?.abort();
      request = null;
      clearTimeout(timeout);
    }

    void readCachedMinimum().then((cached) => {
      if (disposed) return;
      // A saved answer opens the app at once; the check below still shows the update screen if the minimum rose.
      if (cached !== undefined) {
        setMinimum(cached);
        setLoading(false);
      }
      initialized = true;
      void refresh();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else cancel();
    });
    const network = addNetworkStateListener((state) => {
      if (hasInternetSignal(state)) void refresh();
    });
    const interval = setInterval(() => void refresh(), checkIntervalMs);
    return () => {
      disposed = true;
      cancel();
      appState.remove();
      network.remove();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (build === null || !parseIosBuild(build)) {
      reportError(new Error("Native iOS build number unavailable"), "app-update.build");
    }
  }, [build]);

  return { loading, updateRequired: !isIosBuildSupported(build, minimum) };
}
