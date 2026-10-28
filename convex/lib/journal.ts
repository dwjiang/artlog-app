import { ConvexError } from "convex/values";

import {
  type JournalOwner,
  type JournalSave,
  type JournalVisit,
  validateSave,
  validateVisit,
} from "../../shared/journal/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordArtworkScore, recordVisitScore } from "./leaderboard";
import { findOwnedSave, findOwnedVisit, nextChangeVersion } from "./ownership";
import { invalidateDeletedSave } from "./publicationAccess";

export async function upsertJournalVisit(
  ctx: MutationCtx,
  owner: JournalOwner,
  deviceId: Id<"devices">,
  input: JournalVisit,
) {
  validateVisit(input);
  const existing = await findOwnedVisit(ctx, owner, input.localId);
  // A discarded visit stays discarded; a device that has not seen the discard yet may still send older edits.
  if (existing?.deletedAt !== undefined) return existing;
  const venue = await ctx.db.get("museums", input.venueId);
  if (!venue) throw new ConvexError({ code: "invalid_venue" });
  const unchanged =
    existing
    && Object.entries(input).every(([key, value]) => existing[key as keyof typeof existing] === value)
    && existing.startedAt === input.startedAt
    && existing.reflection === input.reflection
    && existing.endedAt === input.endedAt;
  if (unchanged) return existing;
  const fields = {
    ...input,
    reflection: input.deletedAt === undefined ? input.reflection : undefined,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    owner,
    venueName: venue.name,
    updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1),
    updatedBy: deviceId,
    changeVersion: await nextChangeVersion(ctx, owner),
  };
  const id = existing?._id ?? (await ctx.db.insert("visits", fields));
  if (existing) await ctx.db.patch("visits", id, fields);
  if (existing && existing.venueId !== input.venueId) {
    await ctx.db.patch("visits", id, { lastConfidentGallery: undefined, lastConfidentAt: undefined });
    // Saves recorded on a visit were made at its museum, so they move with it.
    for await (const save of ctx.db.query("collections").withIndex("by_visitId", (q) => q.eq("visitId", id))) {
      await ctx.db.patch("collections", save._id, {
        venueId: input.venueId,
        venueName: venue.name,
        updatedAt: Math.max(Date.now(), save.updatedAt + 1),
        updatedBy: deviceId,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
    }
  }
  if (input.deletedAt !== undefined) {
    await discardVisitRecords(ctx, owner, id, input.deletedAt);
  } else if (
    existing
    && (existing.visitedOn !== input.visitedOn
      || existing.visibility !== input.visibility
      || existing.venueId !== input.venueId)
  ) {
    const publication = await ctx.db
      .query("sharedVisits")
      .withIndex("by_visitId", (q) => q.eq("visitId", id))
      .unique();
    if (publication) {
      // The published version's audience mirrors the visit. An audience change keeps the revision, so a share flow
      // that just switched it can still publish its draft. A museum move only touches the post, for its triggers.
      await ctx.db.patch("sharedVisits", publication._id, {
        visitedOn: input.visitedOn,
        audience: input.visibility,
        ...(existing.visitedOn !== input.visitedOn ? { publicationRevision: publication.publicationRevision + 1 } : {}),
        updatedAt: Date.now(),
      });
    }
  }
  await recordVisitScore(ctx, owner, input, existing ?? undefined);
  return (await ctx.db.get("visits", id))!;
}
/** A discarded visit's artworks stay in the collection, unlinked, and its post comes down with its notes. */
async function discardVisitRecords(ctx: MutationCtx, owner: JournalOwner, visitId: Id<"visits">, deletedAt: number) {
  for await (const encounter of ctx.db
    .query("artworkEncounters")
    .withIndex("by_visitId", (q) => q.eq("visitId", visitId))) {
    if (encounter.deletedAt !== undefined) continue;
    await ctx.db.patch("artworkEncounters", encounter._id, {
      deletedAt,
      updatedAt: Date.now(),
      changeVersion: await nextChangeVersion(ctx, owner),
    });
  }
  const publication = await ctx.db
    .query("sharedVisits")
    .withIndex("by_visitId", (q) => q.eq("visitId", visitId))
    .unique();
  if (publication) {
    await ctx.db.patch("sharedVisits", publication._id, {
      status: "private",
      reflection: "",
      mentions: undefined,
      publicationRevision: publication.publicationRevision + 1,
      updatedAt: Date.now(),
    });
  }
}
export async function upsertJournalSave(
  ctx: MutationCtx,
  owner: JournalOwner,
  deviceId: Id<"devices">,
  { note: _note, ...input }: JournalSave,
): Promise<Doc<"collections">> {
  validateSave(input);
  const existing = await findOwnedSave(ctx, owner, input.localId);
  const visit = input.visitLocalId ? await findOwnedVisit(ctx, owner, input.visitLocalId) : null;
  if (input.visitLocalId && !visit) throw new ConvexError({ code: "not_found" });
  // A save on a visit takes the visit's museum, which a device that has not yet seen a move still reports as the old one.
  const venue = visit ? { venueId: visit.venueId, venueName: visit.venueName } : undefined;
  if (existing && (existing.visitLocalId !== input.visitLocalId || (!venue && existing.venueId !== input.venueId))) {
    throw new ConvexError({ code: "invalid_save" });
  }
  if (existing?.deletedAt !== undefined) return existing;
  if (!venue && input.venueId && !(await ctx.db.get("museums", input.venueId))) {
    throw new ConvexError({ code: "invalid_venue" });
  }
  const object = input.objectId ? await ctx.db.get("objects", input.objectId) : null;
  if (input.objectId && !object) {
    throw new ConvexError({ code: "invalid_object" });
  }
  if (input.artworkId && !(await ctx.db.get("artworks", input.artworkId))) {
    throw new ConvexError({ code: "invalid_artwork" });
  }
  if (object && input.artworkId && object.artworkId !== input.artworkId) {
    throw new ConvexError({ code: "invalid_artwork" });
  }
  if (
    existing
    && JSON.stringify(existing.snapshot) === JSON.stringify(input.snapshot)
    && existing.deletedAt === input.deletedAt
  ) {
    return existing;
  }
  const stamps = {
    updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1),
    updatedBy: deviceId,
    changeVersion: await nextChangeVersion(ctx, owner),
  };
  const id =
    existing?._id
    ?? (await ctx.db.insert("collections", {
      ...input,
      ...venue,
      artworkId: object?.artworkId ?? input.artworkId,
      owner,
      visitId: visit?._id,
      ...stamps,
    }));
  if (existing) {
    await ctx.db.patch("collections", id, {
      snapshot: input.snapshot,
      deletedAt: input.deletedAt,
      ...stamps,
    });
  }
  if (!existing && visit) {
    await ctx.db.insert("artworkEncounters", {
      owner,
      savedLocalId: input.localId,
      saveId: id,
      visitLocalId: visit.localId,
      visitId: visit._id,
      deletedAt: input.deletedAt ?? visit.deletedAt,
      updatedAt: stamps.updatedAt,
      changeVersion: await nextChangeVersion(ctx, owner),
    });
  }
  const row = (await ctx.db.get("collections", id))!;
  await recordArtworkScore(ctx, owner, row, existing);
  if (row.deletedAt !== undefined) await invalidateDeletedSave(ctx, row);
  return row;
}
