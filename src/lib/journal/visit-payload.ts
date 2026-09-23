import type { FunctionArgs } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { NewVisit } from "../../db/schema";

export type VisitPayload = FunctionArgs<typeof api.visits.upsertJournal>["visit"];

export function visitInput(
  visit: Pick<
    NewVisit,
    | "localId"
    | "venueId"
    | "visitedOn"
    | "timeZone"
    | "reflection"
    | "startedAt"
    | "endedAt"
    | "visibility"
  >,
): VisitPayload {
  return {
    visibility: visit.visibility ?? "public",
    localId: visit.localId,
    venueId: visit.venueId,
    visitedOn: visit.visitedOn,
    timeZone: visit.timeZone,
    reflection: visit.reflection ?? undefined,
    startedAt: visit.startedAt ?? undefined,
    endedAt: visit.endedAt ?? undefined,
  };
}
