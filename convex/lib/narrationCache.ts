import { GUIDE_MODEL, guideOpening } from "../../shared/audio/guide";
import { SPEECH_MODEL, SPEECH_VOICE } from "../../shared/audio/speech";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { DocentSentence } from "./validators";

export type RenderedNarration = {
  uri: string;
  sentences: DocentSentence[];
  renderId: string;
};

// What a narration is rendered from. One row per artwork; a mismatch on play re-renders it,
// and `narration.clear` re-renders everything after a prompt or delivery change worth hearing.
export function narrationProvenance(artwork: Doc<"artworks">) {
  return {
    factSheetUpdatedAt: artwork.factSheetUpdatedAt,
    opening: guideOpening(artwork),
    guideModel: GUIDE_MODEL,
    speechModel: SPEECH_MODEL,
    voice: SPEECH_VOICE,
  };
}

export function narrationCurrent(entry: Doc<"narrationAudio">, artwork: Doc<"artworks">): boolean {
  const provenance = narrationProvenance(artwork);
  return (
    entry.factSheetUpdatedAt === provenance.factSheetUpdatedAt
    && entry.opening === provenance.opening
    && entry.guideModel === provenance.guideModel
    && entry.speechModel === provenance.speechModel
    && entry.voice === provenance.voice
  );
}

export function narrationEntry(ctx: QueryCtx, artworkId: Id<"artworks">) {
  return ctx.db
    .query("narrationAudio")
    .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))
    .unique();
}

export async function renderedNarration(ctx: QueryCtx, artwork: Doc<"artworks">): Promise<RenderedNarration | null> {
  const entry = await narrationEntry(ctx, artwork._id);
  if (!entry?.storageId || !entry.sentences || !narrationCurrent(entry, artwork)) {
    return null;
  }
  const uri = await ctx.storage.getUrl(entry.storageId);
  return uri ? { uri, sentences: entry.sentences, renderId: entry.claim } : null;
}
