import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { deleteOrbIfUnreferenced } from "./orbStorage";
import { expireVectorArchiveIfUnreferenced } from "./vectorStore";

export function findSavedRecognition(ctx: QueryCtx, saveId: Id<"collections">) {
  return ctx.db
    .query("savedRecognition")
    .withIndex("by_saveId", (q) => q.eq("saveId", saveId))
    .unique();
}

export async function deleteSavedRecognition(ctx: MutationCtx, saveId: Id<"collections">) {
  const row = await findSavedRecognition(ctx, saveId);
  if (!row) return;
  await ctx.db.delete("savedRecognition", row._id);
  await expireVectorArchiveIfUnreferenced(ctx, row.archiveId);
  await deleteOrbIfUnreferenced(ctx, row.orbStorageId);
}

export async function mergeSavedRecognition(
  ctx: MutationCtx,
  sourceId: Id<"collections">,
  targetId: Id<"collections">,
) {
  const source = await findSavedRecognition(ctx, sourceId);
  if (!source) return;
  if (await findSavedRecognition(ctx, targetId)) {
    await deleteSavedRecognition(ctx, sourceId);
  } else {
    await ctx.db.patch("savedRecognition", source._id, {
      saveId: targetId,
      candidateIds: [],
      saveUpdatedAt: undefined,
      attempt: source.attempt + 1,
    });
  }
}
