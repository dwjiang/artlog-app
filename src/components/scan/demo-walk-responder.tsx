import { router } from "expo-router";
import { useEffect } from "react";

import { walkRequestTime, WALK_REQUEST_POLL_MS } from "@/lib/capture/demo-viewfinder";

/**
 * Opens Scan each time the judges' demo page picks a painting, so the viewfinder can walk up to it from wherever the
 * judge is. Mount after the navigator, in the demo build only.
 */
export function DemoWalkResponder() {
  useEffect(() => {
    let answered: number | undefined;
    const timer = setInterval(() => {
      const requested = walkRequestTime();
      if (requested === undefined || requested === answered) return;
      answered = requested;
      // dismissTo closes every screen above the tabs, nested stacks included, and does nothing inside them, where
      // navigate switches tabs. Either alone can leave the judge off Scan or push a second set of tabs.
      router.dismissTo("/scan");
      router.navigate("/scan");
    }, WALK_REQUEST_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
