import { v } from "convex/values";

import { guideOpening, guideResearch } from "../shared/audio/guide";
import { query } from "./_generated/server";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { narrationEntry, renderedNarration, scriptCurrent } from "./lib/narrationCache";
import { readObjectDetails } from "./lib/objectDetails";
import { docentSentence, factChip, rightsStatus, type FactSheetEntry } from "./lib/validators";

const chip = ({ id, sourceUrl, sourceLabel }: FactSheetEntry) => ({
  id,
  sourceUrl,
  sourceLabel,
});

// Artwork-level enrichment for a saved work: the snapshot never changes, this can.
export const enrichment = query({
  args: { artworkId: v.id("artworks") },
  returns: v.union(
    v.null(),
    v.object({
      docent: v.optional(v.array(docentSentence)),
      docentWriting: v.boolean(),
      factSheet: v.optional(v.array(factChip)),
      narrationFacts: v.optional(v.array(factChip)),
      narrationResearchUpdatedAt: v.optional(v.number()),
      narrationOpening: v.string(),
      narrationRenderId: v.optional(v.string()),
      narration: v.optional(v.array(docentSentence)),
      narrationWriting: v.boolean(),
      rightsStatus,
      thumbnailUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) return null;
    let thumbnailUrl: string | undefined;
    if (artwork.rightsStatus === "public_domain") {
      for await (const object of ctx.db
        .query("objects")
        .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
        if (object.reverted || object.mergedInto) {
          continue;
        }
        const details = await readObjectDetails(ctx, object);
        if (!details?.thumbnailUrl) continue;
        thumbnailUrl = details.thumbnailUrl;
        break;
      }
    }
    const content = await readArtworkContent(ctx, artwork);
    const narrationFacts =
      content?.factSheet
      && !artwork.factSheetNeedsReview
      && !artwork.retiredAt
      && artwork.identityStatus === "established"
        ? guideResearch(content.factSheet)
        : [];
    const rendered = narrationFacts.length > 0 ? await renderedNarration(ctx, artwork) : null;
    const entry = narrationFacts.length > 0 ? await narrationEntry(ctx, artworkId) : null;
    // The script shows as soon as it is written, before its audio; a claimed row without one is being written.
    const script = entry && scriptCurrent(entry, artwork) ? entry : null;
    return {
      docent: content?.docent?.en,
      docentWriting: !content?.docent?.en && artwork.enrichClaimedAt !== undefined && !artwork.factSheetNeedsReview,
      factSheet: content?.factSheet?.map(chip),
      narrationFacts: narrationFacts.length > 0 ? narrationFacts.map(chip) : undefined,
      narrationResearchUpdatedAt: narrationFacts.length > 0 ? artwork.factSheetUpdatedAt : undefined,
      narrationRenderId: rendered?.renderId,
      narration: script?.sentences,
      narrationWriting: !!script?.claim && !script.sentences,
      narrationOpening: guideOpening(artwork),
      rightsStatus: artwork.rightsStatus,
      thumbnailUrl,
    };
  },
});
