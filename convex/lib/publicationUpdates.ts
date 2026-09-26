import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function advancePublicationRevision(ctx: MutationCtx, publication: Doc<"sharedVisits">): Promise<void> {
  await ctx.db.patch("sharedVisits", publication._id, {
    publicationRevision: publication.publicationRevision + 1,
    updatedAt: Date.now(),
  });
}
