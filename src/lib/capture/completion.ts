import type { Id } from "../../../convex/_generated/dataModel";

/** How a save met a visit: `started` opened it, `joined` added to the open one, `past` went to a visit on the books. */
export type VisitOutcome = "started" | "joined" | "past";

export type SavedCaptureContext = {
  capturedAt: number;
  venueId?: Id<"museums">;
  photoIds: string[];
};

export type CaptureCompletion = {
  savedId: string;
  capture: SavedCaptureContext;
  previewPath: string | null;
  visitOutcome?: VisitOutcome;
};
