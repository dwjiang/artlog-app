import { getNetworkStateAsync } from "expo-network";
import { useEffect, useRef, useState } from "react";

import { useDiscardEditsGuard } from "@/hooks/use-discard-edits-guard";
import { isOffline } from "@/lib/network-state";

import { playSuccessHaptic } from "./haptics";
import { showErrorToast } from "./toast";

/**
 * Sends a form sheet's input once at a time and closes the sheet when `run` succeeds. While `edited`, closing it any
 * other way asks before discarding the input. A failure's Retry resends the same input and can outlive the sheet,
 * since the toast moves to the root layer when the sheet closes.
 */
export function useSheetSubmit<T>(
  run: (input: T) => Promise<void>,
  {
    edited,
    offlineMessage,
    onError,
  }: { edited: boolean; offlineMessage: string; onError: (cause: unknown, retry: () => void) => void },
) {
  const [busy, setBusy] = useState(false);
  const leave = useDiscardEditsGuard({ edited, busy });
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
      if (isOffline(network)) {
        showErrorToast(offlineMessage, retry);
        return;
      }
      await run(input);
      playSuccessHaptic();
      if (mounted.current) leave();
    } catch (cause) {
      onError(cause, retry);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, submit };
}
