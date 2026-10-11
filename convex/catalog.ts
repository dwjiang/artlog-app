import { v } from "convex/values";

import { query } from "./_generated/server";
import { artistSummary, searchArtists } from "./artists";
import { catalogArtworkPage, searchArtworks } from "./artworks";
import { requireDevice } from "./lib/auth";

/** Search's catalog sections in one call per keystroke: the best-matching artists and a first page of works. */
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.object({ artists: v.array(artistSummary), artworks: catalogArtworkPage }),
  handler: async (ctx, input) => {
    await requireDevice(ctx);
    // Artwork results take priority over optional avatar scans sharing this transaction's read budget.
    const artworks = await searchArtworks(ctx, input.query, input);
    const artists = await searchArtists(ctx, input.query);
    return { artists, artworks };
  },
});
