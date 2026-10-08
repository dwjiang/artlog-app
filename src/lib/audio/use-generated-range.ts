import { useSteadyValue } from "@/hooks/use-steady-value";

import { SEGMENT_SECONDS } from "../../../convex/lib/hls";

/**
 * The generated fraction of the progress span. Normalize before animating so a growing scale cannot pull the fill
 * backward. AVPlayer reloads about once per segment; reset immediately when the narration changes or finishes.
 */
export function useGeneratedRange(available: number, scale: number) {
  const fraction = scale > 0 ? Math.min(1, Math.max(0, available / scale)) : 0;
  return useSteadyValue(fraction, available > 0 ? SEGMENT_SECONDS * 1000 : 0);
}
