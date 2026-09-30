import type { Infer } from "convex/values";

import type { audioReportEvidence } from "../../shared/social/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fileStorage, revokeFileDownload } from "./fileStorage";
import { narrationEntry, narrationFiles } from "./narrationCache";

export function audioEvidenceOf(entry: Doc<"narrationAudio">): Infer<typeof audioReportEvidence> | null {
  const fileIds = entry.storageId ? [entry.storageId] : (entry.segments ?? []).map((segment) => segment.storageId);
  if (!entry.claim || !entry.sentences || fileIds.length === 0) return null;
  return {
    kind: "audio",
    artworkId: entry.artworkId,
    renderId: entry.claim,
    speechModel: entry.speechModel,
    voice: entry.voice,
    sentences: entry.sentences.map(({ sentence }) => sentence),
    fileIds,
  };
}

export async function releaseNarrationFiles(ctx: MutationCtx, fileIds: Id<"files">[]) {
  for (const id of fileIds) {
    // Reports can keep a recording alive after playback access is revoked.
    await revokeFileDownload(ctx, id);
    await fileStorage.delete(ctx, id);
  }
}

export async function clearNarration(ctx: MutationCtx, artworkId: Id<"artworks">) {
  const entry = await narrationEntry(ctx, artworkId);
  if (!entry) return;
  await ctx.db.delete("narrationAudio", entry._id);
  await releaseNarrationFiles(ctx, narrationFiles(entry));
}
