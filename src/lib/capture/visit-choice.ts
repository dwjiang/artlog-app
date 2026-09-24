import type { Id } from "../../../convex/_generated/dataModel";
import { visitByDefault } from "@/lib/venue/use-venue";
import type { CaptureVisitChoice, PhotoSessionDraft } from "./photo-draft";

/**
 * Where one capture saves: the draft's choice, else the capture's own visit, else the museum it was scanned at unless its
 * visit was ended by hand on the capture's day.
 */
export function captureVisitChoice(
  capture: {
    venueId?: Id<"museums"> | null;
    visitLocalId?: string | null;
    capturedAt?: number;
  },
  session: Pick<PhotoSessionDraft, "visit">,
): CaptureVisitChoice {
  if (session.visit) return session.visit;
  if (capture.visitLocalId != null) {
    return { kind: "visit", localId: capture.visitLocalId };
  }
  if (capture.venueId && visitByDefault(capture.venueId, capture.capturedAt)) {
    return { kind: "venue", venueId: capture.venueId };
  }
  return { kind: "none" };
}
