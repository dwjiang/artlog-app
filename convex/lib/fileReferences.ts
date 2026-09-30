import type { Triggers } from "convex-helpers/server/triggers";
import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";

export const FILE_RELEASE_GRACE_MS = 31 * 60_000;

type Reference = Id<"files"> | undefined;
export function registerFileReferences(fileTriggers: Triggers<DataModel>) {
  function register<T extends TableNames>(
    table: T,
    references: (doc: Doc<T>) => Reference[],
    provenance: { crop?: (doc: Doc<T>) => Reference; ownerPhoto?: (doc: Doc<T>) => Reference } = {},
  ) {
    fileTriggers.register(table, async (ctx, { oldDoc, newDoc }) => {
      const changes = new Map<Id<"files">, number>();
      for (const [doc, amount] of [
        [oldDoc, -1],
        [newDoc, 1],
      ] as const) {
        if (!doc) continue;
        for (const id of references(doc)) {
          if (id) changes.set(id, (changes.get(id) ?? 0) + amount);
        }
      }
      const changedMarker = (read?: (doc: Doc<T>) => Reference) =>
        newDoc && read && (!oldDoc || read(oldDoc) !== read(newDoc)) ? read(newDoc) : undefined;
      const ownerPhoto = changedMarker(provenance.ownerPhoto);
      const contributionCrop = changedMarker(provenance.crop);
      for (const id of [ownerPhoto, contributionCrop]) {
        if (id && !changes.has(id)) changes.set(id, 0);
      }
      for (const [id, amount] of changes) {
        if (amount === 0 && id !== ownerPhoto && id !== contributionCrop) continue;
        const file = await ctx.db.get("files", id);
        if (!file || file.state !== "ready") throw new ConvexError({ code: "file_missing" });
        const refCount = file.refCount + amount;
        if (refCount < 0) throw new Error("File reference count underflow");
        const released = refCount === 0;
        const archive = file.contentType === "application/vnd.artlog.embedding";
        await ctx.db.patch("files", id, {
          refCount,
          expiresAt: released ? Date.now() + (archive ? FILE_RELEASE_GRACE_MS : 0) : undefined,
          // These provenance flags are permanent, including after a photo is soft-deleted.
          ownerPhoto: file.ownerPhoto || id === ownerPhoto,
          contributionCrop: file.contributionCrop || id === contributionCrop,
        });
        if (released && !archive) await ctx.scheduler.runAfter(0, internal.files.discard, { id });
      }
    });
  }

  register("scanEmbeddings", (row) => [row.archiveId]);
  register("vectors", (row) => [row.archiveId]);
  register("savedRecognition", (row) => [row.archiveId, row.orbStorageId]);
  register("contributions", (row) => [row.orbStorageId, row.cropStorageId], { crop: (row) => row.cropStorageId });
  register("objectDetails", (row) => [row.thumbnailStorageId, row.orb?.storageId]);
  register("collections", (row) => (row.deletedAt === undefined ? [row.cropStorageId] : []), {
    ownerPhoto: (row) => row.cropStorageId,
  });
  register("artworkPhotos", (row) => (row.deletedAt === undefined ? [row.storageId] : []), {
    ownerPhoto: (row) => row.storageId,
  });
  register("mediaAssets", (row) => (row.revokedAt === undefined ? [row.storageId] : []));
  register("profiles", (row) => [row.photoStorageId]);
  register("narrationAudio", (row) => [row.storageId, ...(row.segments ?? []).map((segment) => segment.storageId)]);
  register("narrationFailures", (row) => row.fileIds);
  register("reports", (row) => (row.evidence.kind === "audio" ? row.evidence.fileIds : []));
  register("museumDownloads", (row) =>
    [...(row.published?.chunks ?? []), ...(row.building?.chunks ?? [])].map((part) => part.storageId),
  );
}
