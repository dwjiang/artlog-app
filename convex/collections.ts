import { ConvexError, v } from "convex/values";

import { pageArgs, pagination, validateSave } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { feedbackChanged } from "./feedbackReplay";
import { mutation } from "./functions";
import { upsertJournalSave } from "./lib/journal";
import { recordArtworkScore } from "./lib/leaderboard";
import { requireJournalOwner, findOwnedSave, nextChangeVersion } from "./lib/ownership";
import { invalidateDeletedSave } from "./lib/publicationAccess";
import { limitDevice } from "./lib/rateLimits";
import { eligibleObject } from "./lib/recognitionEligibility";
import { snapshotFields } from "./lib/validators";
import schema from "./schema";

const suggestion = v.object({ title: v.string(), artist: v.string() });

const same = (a: string, b: string) => a.trim() === b.trim();

export const saveToCollection = mutation({
  args: {
    scope: v.string(),
    visitLocalId: v.optional(v.string()),
    localId: v.string(),
    scanId: v.optional(v.id("scans")),
    objectId: v.optional(v.id("objects")),
    artworkId: v.optional(v.id("artworks")),
    venueId: v.optional(v.id("museums")),
    gallery: v.optional(v.string()),
    snapshot: snapshotFields,
    suggested: v.union(suggestion, v.null()),
    savedAt: v.number(),
    venueName: v.optional(v.string()),
  },
  returns: v.object({
    collectionId: v.id("collections"),
    updatedAt: v.number(),
    updatedBy: v.id("devices"),
    deletedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { device, owner } = await requireJournalOwner(ctx, args.scope);
    await limitDevice(ctx, "sync", device._id);
    validateSave(args);
    const existing = await findOwnedSave(ctx, owner, args.localId);
    const { suggested, scope: _scope, scanId, ...row } = args;
    const saved = await upsertJournalSave(ctx, owner, device._id, {
      ...row,
      note: existing?.note,
    });
    const scan = args.scanId ? await ctx.db.get("scans", args.scanId) : null;
    if (args.scanId) {
      if (!scan || scan.deviceId !== device._id) {
        throw new ConvexError({ code: "invalid_scan" });
      }
      // A scan identified before its museum's visit existed may be saved into that visit, and a visit moved to another
      // museum keeps its scans; any other context is a different save.
      if (scan.visitId !== undefined ? scan.visitId !== saved.visitId : scan.venueId !== saved.venueId) {
        throw new ConvexError({ code: "not_found" });
      }
    }
    if (existing && (existing.confirmationRecorded || existing.deletedAt !== undefined)) {
      return {
        collectionId: existing._id,
        updatedAt: existing.updatedAt,
        updatedBy: existing.updatedBy,
        deletedAt: existing.deletedAt,
      };
    }
    const { objectId } = saved;
    const object = objectId ? await ctx.db.get("objects", objectId) : null;
    const { updatedAt, updatedBy, _id: collectionId } = saved;
    await ctx.db.patch("collections", collectionId, {
      confirmationRecorded: true,
      ...(scanId ? { scanId } : {}),
    });
    const artwork = object && suggested ? await ctx.db.get("artworks", object.artworkId) : null;
    const snapshot = existing?.snapshot ?? args.snapshot;
    if (
      object
      && suggested
      && scan
      && ![scan.best, ...(scan.runnerUps ?? []), scan.linked].some((candidate) => candidate?.objectId === object._id)
    ) {
      throw new ConvexError({ code: "invalid_object" });
    }
    // An untouched suggestion is a confirm; an edited title or artist counts as nothing.
    const kept =
      object
      && suggested
      && artwork
      && same(snapshot.title, suggested.title)
      && same(snapshot.artist, suggested.artist)
      && same(suggested.title, artwork.title)
      && same(suggested.artist, artwork.artist)
        ? object
        : null;
    // A linked scan was named from its label, so saving it confirms nothing about recognition.
    if (kept && scan && !scan.linked && (await eligibleObject(ctx, kept, scan.venueId))) {
      const event = await ctx.db
        .query("feedbackEvents")
        .withIndex("by_save", (q) => q.eq("saveId", collectionId))
        .unique();
      if (!event) {
        await ctx.db.insert("feedbackEvents", {
          kind: "confirmation",
          deviceId: device._id,
          scanId: scan._id,
          objectId: kept._id,
          saveId: collectionId,
        });
        await ctx.db.patch("objects", kept._id, {
          confirmCount: kept.confirmCount + 1,
        });
        await feedbackChanged(ctx, kept._id, false);
      }
    }
    // Its photo can still teach recognition what the work its verified label named looks like.
    if (kept && scan?.linked?.source === "label" && scan.linked.objectId === kept._id) {
      await ctx.scheduler.runAfter(0, internal.linkedViews.learn, { scanId: scan._id });
    }
    return {
      collectionId,
      updatedAt,
      updatedBy,
      deletedAt: existing?.deletedAt,
    };
  },
});

export const listMine = query({
  args: { scope: v.string(), ...pageArgs },
  returns: v.object({
    page: v.array(schema.doc("collections")),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { owner } = await requireJournalOwner(ctx, args.scope);
    const result = await ctx.db
      .query("collections")
      .withIndex("by_owner_savedAt", (q) => q.eq("owner", owner).eq("deletedAt", undefined))
      .order("desc")
      .paginate(pagination(args));
    return {
      page: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const remove = mutation({
  args: { scope: v.string(), localId: v.string() },
  returns: v.null(),
  handler: async (ctx, { scope, localId }) => {
    const { device, owner } = await requireJournalOwner(ctx, scope);
    const row = await findOwnedSave(ctx, owner, localId);
    if (!row) throw new ConvexError({ code: "not_found" });
    if (row.deletedAt === undefined) {
      await ctx.db.patch("collections", row._id, {
        deletedAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: device._id,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      const deleted = (await ctx.db.get("collections", row._id))!;
      await recordArtworkScore(ctx, owner, deleted, row);
      await invalidateDeletedSave(ctx, deleted);
    }
    return null;
  },
});
