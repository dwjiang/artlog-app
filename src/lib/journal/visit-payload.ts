import type { FunctionArgs } from "convex/server";

import type { NewVisit } from "@/db/schema";

import type { api } from "../../../convex/_generated/api";

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
    | "deletedAt"
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
    deletedAt: visit.deletedAt ?? undefined,
  };
}
