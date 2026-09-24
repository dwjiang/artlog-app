import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { docentSentence, factChip } from "./validators";

export const publicArtworkStory = v.object({
  docent: v.array(docentSentence),
  factSheet: v.array(factChip),
});

// Call only after authorizing the published item that exposes this saved artwork.
export async function projectArtworkStory(ctx: QueryCtx, save: Doc<"collections">) {
  const artwork = save.artworkId ? await ctx.db.get("artworks", save.artworkId) : null;
  if (
    !artwork
    || artwork.identityStatus !== "established"
    || artwork.retiredAt !== undefined
    || artwork.factSheetNeedsReview
  ) {
    return undefined;
  }
  const facts = artwork.factSheet ?? [];
  const sources = new Set(facts.map((fact) => fact.id));
  const docent = artwork.docent?.en?.filter(
    (line) => line.factIds.length > 0 && line.factIds.every((id) => sources.has(id)),
  );
  if (!docent?.length) return undefined;
  const cited = new Set(docent.flatMap((line) => line.factIds));
  return {
    docent,
    factSheet: facts
      .filter((fact) => cited.has(fact.id))
      .map(({ id, sourceUrl, sourceLabel }) => ({
        id,
        sourceUrl,
        sourceLabel,
      })),
  };
}
