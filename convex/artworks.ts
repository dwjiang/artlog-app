import { v } from "convex/values";
import { guideOpening, guideResearch } from "../shared/audio/guide";

import { query } from "./_generated/server";
import { requireDevice } from "./lib/auth";
import { renderedNarration } from "./lib/narrationCache";
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
      factSheet: v.optional(v.array(factChip)),
      narrationFacts: v.optional(v.array(factChip)),
      narrationResearchUpdatedAt: v.optional(v.number()),
      narrationOpening: v.string(),
      narrationRenderId: v.optional(v.string()),
      rightsStatus,
      thumbnailUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    await requireDevice(ctx);
    const artwork = await ctx.db.get(artworkId);
    if (!artwork) return null;
    let thumbnailUrl: string | undefined;
    if (artwork.rightsStatus === "public_domain") {
      for await (const object of ctx.db
        .query("objects")
        .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
        if (object.reverted || object.mergedInto || !object.thumbnailUrl) {
          continue;
        }
        thumbnailUrl = object.thumbnailUrl;
        break;
      }
    }
    const narrationFacts =
      artwork.factSheet
      && !artwork.factSheetNeedsReview
      && !artwork.retiredAt
      && artwork.identityStatus === "established"
        ? guideResearch(artwork.factSheet)
        : [];
    return {
      docent: artwork.docent?.en,
      factSheet: artwork.factSheet?.map(chip),
      narrationFacts: narrationFacts.length ? narrationFacts.map(chip) : undefined,
      narrationResearchUpdatedAt: narrationFacts.length ? artwork.factSheetUpdatedAt : undefined,
      narrationRenderId: narrationFacts.length ? (await renderedNarration(ctx, artwork))?.renderId : undefined,
      narrationOpening: guideOpening(artwork),
      rightsStatus: artwork.rightsStatus,
      thumbnailUrl,
    };
  },
});
