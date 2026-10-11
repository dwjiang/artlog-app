import { GUIDE_MODEL, guideOpening } from "../../shared/audio/guide";
import { SPEECH_MODEL, SPEECH_VOICE } from "../../shared/audio/speech";
import type { Doc, Id } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { fileStorage } from "./fileStorage";
import type { GuideSentence } from "./validators";

export type RenderedNarration = {
  uri: string;
  sentences: GuideSentence[];
  renderId: string;
  // A playlist that grows while speech is still being generated, instead of the finished file.
  live: boolean;
};

// What a script is written from. One row per artwork; a script whose research, opening and model are
// current is spoken again rather than rewritten, and `narration.clear` re-renders everything after a
// prompt or delivery change worth hearing.
export function scriptProvenance(artwork: Doc<"artworks">) {
  return {
    factSheetUpdatedAt: artwork.factSheetUpdatedAt,
    opening: guideOpening(artwork),
    guideModel: GUIDE_MODEL,
  };
}

// What the audio is rendered from: the script and the voice that speaks it.
export function narrationProvenance(artwork: Doc<"artworks">) {
  return { ...scriptProvenance(artwork), speechModel: SPEECH_MODEL, voice: SPEECH_VOICE };
}

export function scriptCurrent(entry: Doc<"narrationAudio">, artwork: Doc<"artworks">): boolean {
  const provenance = scriptProvenance(artwork);
  return (
    !artwork.factSheetNeedsReview
    && !artwork.retiredAt
    && artwork.identityStatus === "established"
    && entry.factSheetUpdatedAt === provenance.factSheetUpdatedAt
    && entry.opening === provenance.opening
    && entry.guideModel === provenance.guideModel
  );
}

export function narrationCurrent(entry: Doc<"narrationAudio">, artwork: Doc<"artworks">): boolean {
  return scriptCurrent(entry, artwork) && entry.speechModel === SPEECH_MODEL && entry.voice === SPEECH_VOICE;
}

export function narrationEntry(ctx: QueryCtx, artworkId: Id<"artworks">) {
  return ctx.db
    .query("narrationAudio")
    .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))
    .unique();
}

export function narrationFiles(entry: Doc<"narrationAudio">) {
  return [...(entry.storageId ? [entry.storageId] : []), ...(entry.segments ?? []).map(({ storageId }) => storageId)];
}

export async function renderedNarration(ctx: QueryCtx, artwork: Doc<"artworks">): Promise<RenderedNarration | null> {
  const entry = await narrationEntry(ctx, artwork._id);
  if (!entry?.claim || !entry.storageId || !entry.sentences || !narrationCurrent(entry, artwork)) {
    return null;
  }
  const uri = await fileStorage.getUrl(ctx, entry.storageId, { artworkId: artwork._id, render: entry.claim });
  return uri ? { uri, sentences: entry.sentences, renderId: entry.claim, live: false } : null;
}

export function liveNarration(entry: Doc<"narrationAudio">, artwork: Doc<"artworks">): RenderedNarration | null {
  if (
    !entry.claim
    || entry.storageId
    || !entry.sentences
    || !entry.segments?.length
    || !narrationCurrent(entry, artwork)
  ) {
    return null;
  }
  const params = new URLSearchParams({ artworkId: artwork._id, render: entry.claim });
  return {
    uri: `${env.CONVEX_SITE_URL}/narration-playlist?${params}`,
    sentences: entry.sentences,
    renderId: entry.claim,
    live: true,
  };
}
