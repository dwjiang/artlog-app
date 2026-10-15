import { type JournalOwner, sameOwner } from "../../shared/journal/contracts";
import { LIMITS } from "../../shared/journal/limits";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Saves are never trimmed; reads stop at the newest `limit`. */
export async function newestMuseumSaves(
  ctx: QueryCtx | MutationCtx,
  owner: JournalOwner,
  limit: number = LIMITS.wantToSee,
) {
  return await ctx.db
    .query("museumSaves")
    .withIndex("by_owner_savedAt", (q) => q.eq("owner", owner))
    .order("desc")
    .take(limit);
}

async function findMuseumSave(ctx: QueryCtx | MutationCtx, owner: JournalOwner, museumId: Id<"museums">) {
  return await ctx.db
    .query("museumSaves")
    .withIndex("by_owner_museumId", (q) => q.eq("owner", owner).eq("museumId", museumId))
    .unique();
}

/** The owner's saves of a museum, including saves of duplicates the museum audit has since merged into it. */
export async function findMuseumSaves(ctx: MutationCtx, owner: JournalOwner, museumId: Id<"museums">) {
  const aliases = await ctx.db
    .query("museums")
    .withIndex("by_mergedInto", (q) => q.eq("mergedInto", museumId))
    .collect();
  const saves: Doc<"museumSaves">[] = [];
  for (const id of [museumId, ...aliases.map((alias) => alias._id)]) {
    const save = await findMuseumSave(ctx, owner, id);
    if (save) saves.push(save);
  }
  return saves;
}

/** Claims one batch of guest saves, dropping museums the account already saved. */
export async function claimMuseumSaves(ctx: MutationCtx, from: JournalOwner, to: JournalOwner) {
  if (sameOwner(from, to)) return { complete: true, moved: 0 };
  const saves = await newestMuseumSaves(ctx, from, LIMITS.batchRecords);
  for (const save of saves) {
    if (await findMuseumSave(ctx, to, save.museumId)) await ctx.db.delete("museumSaves", save._id);
    else await ctx.db.patch("museumSaves", save._id, { owner: to });
  }
  return { complete: saves.length < LIMITS.batchRecords, moved: saves.length };
}
