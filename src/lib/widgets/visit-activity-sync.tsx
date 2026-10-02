import { useEffect, useRef } from "react";

import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { reportError } from "@/lib/observability";
import { useVenue } from "@/lib/venue/use-venue";

import { VisitActivity } from "./visit-activity";

/**
 * Keeps one Live Activity in step with the open visit: started with the visit, updated with each save, ended when the
 * visit ends. On launch it adopts an activity left over from the previous process or ends it when no visit is open.
 */
export function VisitActivitySync() {
  const owner = useLocalOwner();
  const { visit, hydrated } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, owner);
  const count = loading || error ? undefined : works.length;
  const since = visit ? formatVisitStart(visit.startedAt, visit.timeZone) : undefined;
  const localId = visit?.localId;
  const venueName = visit?.venueName;
  // Native updates cannot be cancelled once started; finish them before applying the next visit snapshot.
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    writes.current = writes.current
      .then(async () => {
        if (cancelled || !hydrated) return;
        if (!localId || !venueName || since === undefined || count === undefined) {
          if (localId) return;
          for (const activity of VisitActivity.getInstances()) {
            if (cancelled) return;
            await activity.end("immediate");
          }
          return;
        }
        const props = { venueName, count, since };
        const [adopted, ...extra] = VisitActivity.getInstances();
        for (const activity of extra) {
          if (cancelled) return;
          await activity.end("immediate");
        }
        if (cancelled) return;
        if (adopted) {
          await adopted.update(props);
        } else {
          VisitActivity.start(props, "artlog:///scan");
        }
      })
      .catch((cause: unknown) => {
        reportError(cause, "visit.live-activity", { level: "warning" });
      });
    return () => {
      cancelled = true;
    };
  }, [owner, hydrated, localId, venueName, count, since]);
  return null;
}
