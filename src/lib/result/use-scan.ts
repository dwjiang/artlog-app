import { useQueries, type RequestForQueries } from "convex/react";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo } from "react";

import { connectionDiagnostics } from "@/lib/convex-connection";
import { hasInternetSignal } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { reportIfStalled } from "@/lib/stall-report";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ScanResult } from "./state";

// The result shows a spinner until the scan arrives, so one that never does would otherwise go unseen.
const LOAD_STALL_MS = 10_000;

/** The live scan document; `undefined` until the device can query, an `Error` when the server refuses it. */
export function useScan(scanId: Id<"scans"> | undefined): ScanResult | Error | undefined {
  const ready = useDeviceReady();
  const query = useMemo(
    (): RequestForQueries => (ready && scanId ? { scan: { query: api.scans.get, args: { scanId } } } : {}),
    [ready, scanId],
  );
  const { scan }: { scan?: ScanResult | Error } = useQueries(query);
  useEffect(() => {
    if (scan instanceof Error) reportError(scan, "result.load_scan");
  }, [scan]);
  const online = hasInternetSignal(useNetworkState());
  const loaded = scan !== undefined;
  useEffect(() => {
    // Offline, waiting is expected.
    if (!scanId || loaded || !online) return;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    void reportIfStalled(settled, "result.load_scan_stalled", LOAD_STALL_MS, {
      requiresNetwork: true,
      data: () => ({ device_ready: ready, ...connectionDiagnostics() }),
    });
    return () => settle();
  }, [scanId, loaded, online, ready]);
  return scan;
}
