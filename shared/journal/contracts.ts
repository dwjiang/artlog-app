import { ConvexError, type Infer, v } from "convex/values";
import { calendarDate, isCalendarDate, isRevision, isTimestamp, isTimeZone, isUuid, LIMITS, utf8Bytes } from "./limits";

export const journalOwner = v.union(
  v.object({ kind: v.literal("account"), accountId: v.id("accounts") }),
  v.object({ kind: v.literal("device"), deviceId: v.id("devices") }),
);
export type JournalOwner = Infer<typeof journalOwner>;
export const ownerKey = (owner: JournalOwner): string =>
  owner.kind === "account" ? `account:${owner.accountId}` : `device:${owner.deviceId}`;
export const sameOwner = (a: JournalOwner, b: JournalOwner): boolean => ownerKey(a) === ownerKey(b);
export const journalSnapshot = v.object({
  title: v.string(),
  artist: v.string(),
  date: v.optional(v.string()),
  medium: v.optional(v.string()),
  institution: v.optional(v.string()),
});
export const visitVisibility = v.union(v.literal("public"), v.literal("private"));
export const journalVisit = v.object({
  visibility: visitVisibility,
  localId: v.string(),
  venueId: v.id("museums"),
  visitedOn: v.string(),
  timeZone: v.string(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  reflection: v.optional(v.string()),
});
export const journalSave = v.object({
  localId: v.string(),
  visitLocalId: v.optional(v.string()),
  venueId: v.optional(v.id("museums")),
  venueName: v.optional(v.string()),
  gallery: v.optional(v.string()),
  savedAt: v.number(),
  snapshot: journalSnapshot,
  objectId: v.optional(v.id("objects")),
  artworkId: v.optional(v.id("artworks")),
  note: v.optional(v.string()),
  deletedAt: v.optional(v.number()),
});
export type JournalVisit = Infer<typeof journalVisit>;
export type JournalSave = Infer<typeof journalSave>;
export const pageArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};
export function pagination(input: { cursor?: string | null; limit?: number }) {
  const limit = input.limit ?? LIMITS.page;
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > LIMITS.maxPage
    || (input.cursor && new TextEncoder().encode(input.cursor).byteLength > LIMITS.cursorBytes)
  ) {
    throw new ConvexError({ code: "invalid_pagination" });
  }
  return { numItems: limit, cursor: input.cursor ?? null };
}
export function validateVisit(visit: JournalVisit, now = Date.now()): void {
  if (
    (visit.visibility !== "public" && visit.visibility !== "private")
    || !isUuid(visit.localId)
    || !isCalendarDate(visit.visitedOn)
    || !isTimeZone(visit.timeZone)
    || visit.visitedOn > calendarDate(now, visit.timeZone)
    || (visit.reflection?.length ?? 0) > LIMITS.note
    || (visit.startedAt !== undefined
      && (!isTimestamp(visit.startedAt) || calendarDate(visit.startedAt, visit.timeZone) !== visit.visitedOn))
    || (visit.endedAt !== undefined
      && (!isTimestamp(visit.endedAt) || visit.startedAt === undefined || visit.endedAt < visit.startedAt))
  ) {
    throw new ConvexError({ code: "invalid_visit" });
  }
}
export function validateSave(save: JournalSave): void {
  if (
    !isUuid(save.localId)
    || (save.visitLocalId !== undefined && !isUuid(save.visitLocalId))
    || !isTimestamp(save.savedAt)
    || !save.snapshot.title.trim()
    || Object.values(save.snapshot).some((s) => (s?.length ?? 0) > LIMITS.snapshot)
    || (save.note?.length ?? 0) > LIMITS.note
    || (save.venueName?.length ?? 0) > LIMITS.snapshot
    || (save.gallery?.length ?? 0) > LIMITS.snapshot
    || (save.deletedAt !== undefined && !isTimestamp(save.deletedAt))
  ) {
    throw new ConvexError({ code: "invalid_save" });
  }
}
export function validateBatch(visits: JournalVisit[], saves: JournalSave[], since: number): void {
  if (
    !isRevision(since)
    || visits.length + saves.length > LIMITS.batchRecords
    || utf8Bytes({ visits, saves }) > LIMITS.batchBytes
    || new Set(visits.map((row) => row.localId)).size !== visits.length
    || new Set(saves.map((row) => row.localId)).size !== saves.length
  ) {
    throw new ConvexError({ code: "invalid_sync" });
  }
  visits.forEach((visit) => validateVisit(visit));
  saves.forEach(validateSave);
}
