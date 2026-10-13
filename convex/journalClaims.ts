import { ConvexError, v } from "convex/values";

import { sameOwner } from "../shared/journal/contracts";
import { LIMITS, utf8Bytes } from "../shared/journal/limits";
import { mutation } from "./functions";
import { claimExhibitionSaves } from "./lib/exhibitionSaves";
import { recordArtworkScore, recordVisitScore } from "./lib/leaderboard";
import { findOwnedSave, findOwnedVisit, nextChangeVersion, resolveOwner } from "./lib/ownership";

export const resume = mutation({
  args: { scope: v.string() },
  returns: v.object({
    claimId: v.union(v.id("journalClaims"), v.null()),
    complete: v.boolean(),
    moved: v.number(),
  }),
  handler: async (ctx, { scope }) => {
    const { device, owner } = await resolveOwner(ctx, scope);
    const claim = await ctx.db
      .query("journalClaims")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    if (!claim) return { claimId: null, complete: true, moved: 0 };
    if (owner.kind !== "account" || claim.accountId !== owner.accountId) {
      throw new ConvexError({ code: "not_found" });
    }
    if (claim.phase === "complete") {
      return { claimId: claim._id, complete: true, moved: 0 };
    }
    const source = { kind: "device" as const, deviceId: device._id };
    let moved = 0;
    let bytes = 0;
    if (claim.phase === "visits") {
      const rows = await ctx.db
        .query("visits")
        .withIndex("by_owner_localId", (q) => q.eq("owner", source))
        .take(LIMITS.batchRecords);
      for (const row of rows) {
        const size = utf8Bytes(row);
        if (bytes + size > LIMITS.batchBytes) break;
        if (await findOwnedVisit(ctx, owner, row.localId)) {
          throw new ConvexError({ code: "ownership_collision" });
        }
        await ctx.db.patch("visits", row._id, {
          owner,
          changeVersion: await nextChangeVersion(ctx, owner),
        });
        await recordVisitScore(ctx, owner, row);
        moved++;
        bytes += size;
      }
      if (
        !(await ctx.db
          .query("visits")
          .withIndex("by_owner_localId", (q) => q.eq("owner", source))
          .first())
      ) {
        await ctx.db.patch("journalClaims", claim._id, { phase: "saves" });
      }
      return { claimId: claim._id, complete: false, moved };
    }
    const rows = await ctx.db
      .query("collections")
      .withIndex("by_owner_localId", (q) => q.eq("owner", source))
      .take(LIMITS.batchRecords);
    for (const row of rows) {
      const size = utf8Bytes(row);
      if (bytes + size > LIMITS.batchBytes) break;
      if (await findOwnedSave(ctx, owner, row.localId)) {
        throw new ConvexError({ code: "ownership_collision" });
      }
      if (row.visitId) {
        const visit = await ctx.db.get("visits", row.visitId);
        if (
          !visit
          || !sameOwner(visit.owner, owner)
          || visit.localId !== row.visitLocalId
          || visit.venueId !== row.venueId
        ) {
          throw new ConvexError({ code: "not_found" });
        }
      }
      await ctx.db.patch("collections", row._id, {
        owner,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      await recordArtworkScore(ctx, owner, row);
      const photos = await ctx.db
        .query("artworkPhotos")
        .withIndex("by_save_deletedAt", (q) => q.eq("saveId", row._id).eq("deletedAt", undefined))
        .take(101);
      const encounters = await ctx.db
        .query("artworkEncounters")
        .withIndex("by_save_deletedAt", (q) => q.eq("saveId", row._id).eq("deletedAt", undefined))
        .take(101);
      for (const photo of photos) {
        await ctx.db.patch("artworkPhotos", photo._id, {
          owner,
          changeVersion: await nextChangeVersion(ctx, owner),
        });
      }
      for (const encounter of encounters) {
        await ctx.db.patch("artworkEncounters", encounter._id, {
          owner,
          changeVersion: await nextChangeVersion(ctx, owner),
        });
      }
      moved++;
      bytes += size;
    }
    let complete = !(await ctx.db
      .query("collections")
      .withIndex("by_owner_localId", (q) => q.eq("owner", source))
      .first());
    if (complete) {
      const exhibitionSaves = await claimExhibitionSaves(ctx, source, owner);
      complete = exhibitionSaves.complete;
      moved += exhibitionSaves.moved;
    }
    if (complete) {
      await ctx.db.patch("journalClaims", claim._id, {
        phase: "complete",
        completedAt: Date.now(),
      });
    }
    return { claimId: claim._id, complete, moved };
  },
});
