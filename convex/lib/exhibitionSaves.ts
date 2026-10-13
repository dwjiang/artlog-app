import { type JournalOwner, sameOwner } from "../../shared/journal/contracts";
import { LIMITS } from "../../shared/journal/limits";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Saves are never trimmed, closed shows included; reads stop at the newest `limit`. */
export async function newestExhibitionSaves(
  ctx: QueryCtx | MutationCtx,
  owner: JournalOwner,
  limit: number = LIMITS.wantToSee,
) {
  return await ctx.db
    .query("exhibitionSaves")
    .withIndex("by_owner_savedAt", (q) => q.eq("owner", owner))
    .order("desc")
    .take(limit);
}

export async function findExhibitionSave(
  ctx: QueryCtx | MutationCtx,
  owner: JournalOwner,
  exhibitionId: Id<"exhibitions">,
) {
  return await ctx.db
    .query("exhibitionSaves")
    .withIndex("by_owner_exhibitionId", (q) => q.eq("owner", owner).eq("exhibitionId", exhibitionId))
    .unique();
}

/** Claims one batch of guest saves, dropping shows the account already saved. */
export async function claimExhibitionSaves(ctx: MutationCtx, from: JournalOwner, to: JournalOwner) {
  if (sameOwner(from, to)) return { complete: true, moved: 0 };
  const saves = await newestExhibitionSaves(ctx, from, LIMITS.batchRecords);
  for (const save of saves) {
    if (await findExhibitionSave(ctx, to, save.exhibitionId)) await ctx.db.delete("exhibitionSaves", save._id);
    else await ctx.db.patch("exhibitionSaves", save._id, { owner: to });
  }
  return { complete: saves.length < LIMITS.batchRecords, moved: saves.length };
}
