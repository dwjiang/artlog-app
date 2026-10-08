import { useRouter } from "expo-router";
import { useRef, useState } from "react";

import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";

import type { Id } from "../../../convex/_generated/dataModel";
import { useVenue } from "./use-venue";

/**
 * Start visit before anything is saved: opens today's visit at the museum, or the chooser while several nearby are
 * undecided. `openCamera` goes on to Scan, for buttons away from the camera.
 */
export function useStartVisit({ openCamera }: { openCamera: boolean }) {
  const router = useRouter();
  const { startVisit } = useVenue();
  const [starting, setStarting] = useState(false);
  const pending = useRef(false);

  async function start(venueId: Id<"museums">) {
    if (pending.current) return;
    pending.current = true;
    setStarting(true);
    try {
      await startVisit(venueId);
      showToast("Visit started.");
      if (openCamera) router.navigate("/scan");
    } catch (cause) {
      reportError(cause, "visit.start");
      showErrorToast("Couldn’t start the visit.", () => void start(venueId));
    } finally {
      pending.current = false;
      setStarting(false);
    }
  }

  return {
    starting,
    start: (venueId: Id<"museums">) => void start(venueId),
    choose: () => router.push({ pathname: "/venue-picker", params: { mode: "start" } }),
  };
}
