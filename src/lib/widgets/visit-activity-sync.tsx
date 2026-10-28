import { useEffect, useRef } from "react";

import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { reportError } from "@/lib/observability";
import { useVenue } from "@/lib/venue/use-venue";

import { VisitActivity } from "./visit-activity";
import { prepareVisitThumbnails, prepareWidgetFont, pruneVisitThumbnails } from "./widget-storage";

const THUMBNAIL_COUNT = 3;

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
  // Joined so the effect reruns only when the newest photos change, not on every query snapshot.
  const photos = works
    .flatMap((work) => (work.cropPath ? [work.cropPath] : []))
    .slice(0, THUMBNAIL_COUNT)
    .join("\n");
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
          pruneVisitThumbnails([]);
          return;
        }
        // Without the font the extension falls back to the system face, which beats no activity.
        await prepareWidgetFont().catch((cause: unknown) => {
          reportError(cause, "visit.live-activity.font", { level: "warning" });
        });
        const thumbnails = await prepareVisitThumbnails(photos ? photos.split("\n") : []);
        if (cancelled) return;
        const props = { venueName, count, since, thumbnails };
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
        pruneVisitThumbnails(thumbnails);
      })
      .catch((cause: unknown) => {
        reportError(cause, "visit.live-activity", { level: "warning" });
      });
    return () => {
      cancelled = true;
    };
  }, [owner, hydrated, localId, venueName, count, since, photos]);
  return null;
}
