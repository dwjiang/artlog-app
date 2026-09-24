import { recordArtworkScore, recordVisitScore } from "./lib/leaderboard";
import { ConvexError, v } from "convex/values";
import { sameOwner } from "../shared/journal/contracts";
import { LIMITS, utf8Bytes } from "../shared/journal/limits";
import { mutation } from "./_generated/server";
import {
  findOwnedSave,
  findOwnedVisit,
  nextChangeVersion,
  resolveOwner,
} from "./lib/ownership";

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
    let moved = 0,
      bytes = 0;
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
        await ctx.db.patch(row._id, {
          owner,
          changeVersion: await nextChangeVersion(ctx, owner),
        });
        await recordVisitScore(ctx, owner, row.venueId, row.visitedOn);
        moved++;
        bytes += size;
      }
      if (
        !(await ctx.db
          .query("visits")
          .withIndex("by_owner_localId", (q) => q.eq("owner", source))
          .first())
      ) {
        await ctx.db.patch(claim._id, { phase: "saves" });
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
        const visit = await ctx.db.get(row.visitId);
        if (
          !visit
          || !sameOwner(visit.owner, owner)
          || visit.localId !== row.visitLocalId
          || visit.venueId !== row.venueId
        ) {
          throw new ConvexError({ code: "not_found" });
        }
      }
      await ctx.db.patch(row._id, {
        owner,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      await recordArtworkScore(ctx, owner, row);
      const photos = await ctx.db
        .query("artworkPhotos")
        .withIndex("by_save_deletedAt", (q) =>
          q.eq("saveId", row._id).eq("deletedAt", undefined),
        )
        .take(101);
      const encounters = await ctx.db
        .query("artworkEncounters")
        .withIndex("by_save_deletedAt", (q) =>
          q.eq("saveId", row._id).eq("deletedAt", undefined),
        )
        .take(101);
      for (const child of [...photos, ...encounters]) {
        await ctx.db.patch(child._id, {
          owner,
          changeVersion: await nextChangeVersion(ctx, owner),
        });
      }
      moved++;
      bytes += size;
    }
    const complete = !(await ctx.db
      .query("collections")
      .withIndex("by_owner_localId", (q) => q.eq("owner", source))
      .first());
    if (complete) {
      await ctx.db.patch(claim._id, {
        phase: "complete",
        completedAt: Date.now(),
      });
    }
    return { claimId: claim._id, complete, moved };
  },
});
