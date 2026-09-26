import { getNetworkStateAsync } from "expo-network";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { showErrorToast } from "./toast";

/**
 * Sends a form sheet's input once at a time and closes the sheet when `run` succeeds. A failure's Retry resends the
 * same input and can outlive the sheet, since the toast moves to the root layer when the sheet closes.
 */
export function useSheetSubmit<T>(
  run: (input: T) => Promise<void>,
  { offlineMessage, onError }: { offlineMessage: string; onError: (cause: unknown, retry: () => void) => void },
) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(input: T) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const retry = () => void submit(input);
    try {
      // Convex queues mutations while offline instead of failing, so the send would never settle.
      const network = await getNetworkStateAsync();
      if (network.isConnected === false || network.isInternetReachable === false) {
        showErrorToast(offlineMessage, retry);
        return;
      }
      await run(input);
      if (mounted.current) router.back();
    } catch (cause) {
      onError(cause, retry);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, submit };
}
