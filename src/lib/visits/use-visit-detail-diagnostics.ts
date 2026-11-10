import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";

import { addBreadcrumb } from "@/lib/observability";

type Snapshot = {
  state: "loading" | "ready" | "error" | "unavailable";
  workCount?: number;
  endReview: boolean;
};

export function useVisitDetailDiagnostics({ state, workCount, endReview }: Snapshot): void {
  const focused = useIsFocused();
  const snapshots = useRef(0);
  const previous = useRef<string | undefined>(undefined);
  const count =
    workCount === undefined ? null : Number.isFinite(workCount) ? Math.min(500, Math.max(0, Math.floor(workCount))) : 0;
  useEffect(() => {
    if (!focused) {
      snapshots.current = 0;
      previous.current = undefined;
      return;
    }
    const signature = `${state}:${count}:${endReview}`;
    if (signature === previous.current || snapshots.current >= 8) return;
    previous.current = signature;
    snapshots.current++;
    // Counts describe the eager gallery's potential mount size, not native frame timing.
    // Bound updates so live queries cannot fill the breadcrumb buffer during a hang.
    addBreadcrumb("visit.detail.snapshot", {
      render_state: state,
      work_count: count,
      end_review: endReview,
    });
  }, [focused, state, count, endReview]);
  useEffect(() => {
    if (focused) return () => addBreadcrumb("visit.detail.left");
  }, [focused]);
}
