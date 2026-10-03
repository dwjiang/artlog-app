import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { captureOwner } from "@/lib/account/owner-store";
import { convex } from "@/lib/convex-client";
import { toConfirmedFields, type LabelFormState } from "@/lib/label/fields";
import { isNetworkError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConfirmedSource } from "../../../convex/lib/validators";

export const CONFIRM_WAIT_MS = 10_000;
const UNAVAILABLE = "Couldn’t reach Artlog. You can save these details privately or try confirming again.";

/** Confirms a scan's details, then returns to its result page, which now names the work. */
export function useConfirmDetails(scanId: Id<"scans"> | undefined, source: ConfirmedSource) {
  const router = useRouter();
  const offline = isOffline(useNetworkState());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const pending = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (offline) pending.current?.();
  }, [offline]);
  useEffect(
    () => () => {
      const cancel = pending.current;
      pending.current = undefined;
      cancel?.();
    },
    [],
  );

  async function confirm(form: LabelFormState) {
    const fields = toConfirmedFields(form);
    if (!scanId || !fields || pending.current || offline) return;
    const owner = captureOwner();
    let cancel!: () => void;
    const disconnected = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Network request timed out"));
    });
    pending.current = cancel;
    const current = () => pending.current === cancel && owner.isCurrent();
    const timeout = setTimeout(cancel, CONFIRM_WAIT_MS);
    setConfirming(true);
    setError(undefined);
    setUnavailable(false);
    try {
      // Convex retains an offline mutation for reconnection. Stop waiting without letting its late reply navigate.
      await Promise.race([convex.mutation(api.scans.confirm, { scanId, source, fields }), disconnected]);
      if (current()) router.dismissTo({ pathname: "/result/[scanId]", params: { scanId } });
    } catch (cause) {
      if (!current()) return;
      const networkFailure = isNetworkError(cause);
      if (!networkFailure) reportError(cause, "result.confirm_details");
      setUnavailable(networkFailure);
      setError(networkFailure ? UNAVAILABLE : "Couldn’t confirm these details. Try again.");
    } finally {
      clearTimeout(timeout);
      if (pending.current === cancel) {
        pending.current = undefined;
        setConfirming(false);
      }
    }
  }

  return { confirming, error, confirm, offline, unavailable };
}
