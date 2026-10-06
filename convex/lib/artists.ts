import type { Triggers } from "convex-helpers/server/triggers";

import { artistKey, normalizeText } from "../../shared/catalog/text";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The fields search reads from an artwork, which the artworks trigger and the corpus backfill keep current. */
export function artworkSearchFields({ title, artist }: Pick<Doc<"artworks">, "title" | "artist">) {
  return { searchText: normalizeText(`${title} ${artist}`), artistKey: artistKey(artist) };
}

/** The artist a work counts toward: established, unretired works with a named artist. */
function countedKey(artwork: Doc<"artworks"> | null): string | undefined {
  return artwork && !artwork.retiredAt && artwork.identityStatus === "established" ? artwork.artistKey : undefined;
}

export function artistByKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("artists")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

async function changeWorkCount(ctx: MutationCtx, key: string, name: string, delta: number) {
  const artist = await artistByKey(ctx, key);
  const workCount = (artist?.workCount ?? 0) + delta;
  if (artist && workCount <= 0) await ctx.db.delete("artists", artist._id);
  else if (artist) await ctx.db.patch("artists", artist._id, { workCount });
  else if (workCount > 0) await ctx.db.insert("artists", { key, name, workCount });
}

// Counts follow the stored key, so the backfill that first sets it on imported rows (which skip triggers) counts them.
export function registerArtists(triggers: Triggers<DataModel>) {
  triggers.register("artworks", async (ctx, { newDoc }) => {
    if (!newDoc) return;
    const fields = artworkSearchFields(newDoc);
    if (newDoc.searchText !== fields.searchText || newDoc.artistKey !== fields.artistKey) {
      await ctx.db.patch("artworks", newDoc._id, fields);
    }
  });
  triggers.register("artworks", async (ctx, { oldDoc, newDoc }) => {
    const before = countedKey(oldDoc);
    const after = countedKey(newDoc);
    if (before === after) return;
    if (before) await changeWorkCount(ctx, before, oldDoc!.artist, -1);
    if (after) await changeWorkCount(ctx, after, newDoc!.artist, 1);
  });
}
