import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { verifiedAccession } from "./lib/agreement";
import { revokeContributionMedia } from "./lib/displayMedia";
import { fileStorage, revokeFileDownload } from "./lib/fileStorage";
import { readObjectOrb, patchObjectDetails } from "./lib/objectDetails";
import { deleteOrbIfUnreferenced } from "./lib/orbStorage";
import { eligibleContribution } from "./lib/recognitionEligibility";
import { applyReference, earlier } from "./lib/tentativeEntries";
import { deleteVector } from "./lib/vectorStore";
import { beginRevert } from "./revert";
import { deleteEmbedding } from "./scanEmbeddings";

export async function removeContribution(
  ctx: MutationCtx,
  row: Doc<"contributions">,
  reason: "withdrawn" | "device_reverted" | "object_reverted",
): Promise<void> {
  await deleteEmbedding(ctx, row.embeddingId);
  if (row.status === "rejected" && !row.cropStorageId && !row.orbStorageId) {
    return;
  }
  const object = row.indexedObjectId ? await ctx.db.get("objects", row.indexedObjectId) : null;
  const vector = await ctx.db
    .query("vectors")
    .withIndex("by_contributionId", (q) => q.eq("contributionId", row._id))
    .unique();
  if (vector) {
    await deleteVector(ctx, vector);
    await bumpCounter(ctx, "vectors", -1);
  }
  if (object) {
    const reference = await readObjectOrb(ctx, object);
    if (reference?.contributionId === row._id) {
      await patchObjectDetails(ctx, object, { orb: undefined });
      await bumpCounter(ctx, "descriptors", -1);
    }
    await ctx.db.patch("objects", object._id, {
      supportRevision: (object.supportRevision ?? 0) + 1,
    });
  }
  await ctx.db.patch("contributions", row._id, {
    status: "rejected",
    rejectedReason: row.rejectedReason ?? reason,
    cropStorageId: undefined,
    orbStorageId: undefined,
    orbSha256: undefined,
  });
  await revokeContributionMedia(ctx, row._id);
  if (row.cropStorageId) {
    // Public consent ends now, even if a thumbnail reference survives until the entry rebuild.
    await revokeFileDownload(ctx, row.cropStorageId);
    await fileStorage.delete(ctx, row.cropStorageId);
  }
  if (row.orbStorageId) await deleteOrbIfUnreferenced(ctx, row.orbStorageId);
  const venue = await ctx.db.get("museums", row.venueId);
  if (venue) {
    await ctx.db.patch("museums", venue._id, {
      contributionRevision: (venue.contributionRevision ?? 0) + 1,
    });
  }
  if (object?.identityStatus === "tentative" && !object.reverted) {
    await queueEntryRebuild(ctx, object._id);
  }
}

export async function queueEntryRebuild(ctx: MutationCtx, objectId: Id<"objects">) {
  const existing = await ctx.db
    .query("entryRebuilds")
    .withIndex("by_object", (q) => q.eq("objectId", objectId))
    .unique();
  if (!existing) {
    const object = await ctx.db.get("objects", objectId);
    if (!object || object.reverted) return;
    const jobId = await ctx.db.insert("entryRebuilds", {
      objectId,
      revision: object.supportRevision ?? 0,
      cursor: null,
    });
    await ctx.scheduler.runAfter(0, internal.contributionRemoval.rebuildPage, {
      jobId,
    });
  }
}

export const rebuildPage = internalMutation({
  args: { jobId: v.id("entryRebuilds") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("entryRebuilds", jobId);
    if (!job) return null;
    const object = await ctx.db.get("objects", job.objectId);
    if (!object || object.reverted) {
      await ctx.db.delete("entryRebuilds", jobId);
      return null;
    }
    const restart = job.revision !== (object.supportRevision ?? 0);
    let source = !restart && job.sourceId ? await ctx.db.get("contributions", job.sourceId) : null;
    let accessionSource =
      !restart && job.accessionSourceId ? await ctx.db.get("contributions", job.accessionSourceId) : null;
    const page = await ctx.db
      .query("contributions")
      .withIndex("by_object_status_created", (q) => q.eq("indexedObjectId", object._id).eq("status", "tentative"))
      .paginate({
        cursor: restart ? null : job.cursor,
        numItems: 25,
        maximumBytesRead: 1024 * 1024,
      });
    for (const row of page.page) {
      if (!(await eligibleContribution(ctx, row))) continue;
      if (earlier(row, source)) source = row;
      if (verifiedAccession(row) && earlier(row, accessionSource)) {
        accessionSource = row;
      }
    }
    const invalid =
      (source && !(await eligibleContribution(ctx, source)))
      || (accessionSource && !(await eligibleContribution(ctx, accessionSource)));
    if (invalid || !page.isDone) {
      await ctx.db.patch("entryRebuilds", jobId, {
        revision: object.supportRevision ?? 0,
        cursor: invalid ? null : page.continueCursor,
        sourceId: invalid ? undefined : source?._id,
        accessionSourceId: invalid ? undefined : accessionSource?._id,
      });
      await ctx.scheduler.runAfter(0, internal.contributionRemoval.rebuildPage, { jobId });
      return null;
    }
    if (source) {
      await applyReference(ctx, object, source, accessionSource ? verifiedAccession(accessionSource) : undefined);
    } else {
      await ctx.db.patch("artworks", object.artworkId, { retiredAt: Date.now() });
      await beginRevert(ctx, object, "no_eligible_contributions");
      await ctx.scheduler.runAfter(0, internal.revert.revertObjectById, {
        objectId: object._id,
        reason: "no_eligible_contributions",
      });
    }
    await ctx.db.delete("entryRebuilds", jobId);
    return null;
  },
});
