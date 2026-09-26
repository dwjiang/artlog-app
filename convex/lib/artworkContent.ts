import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type ArtworkContentFields = Omit<Doc<"artworkContent">, "_id" | "_creationTime">;

export function readArtworkContent(ctx: QueryCtx, artwork: Pick<Doc<"artworks">, "contentId">) {
  return artwork.contentId ? ctx.db.get("artworkContent", artwork.contentId) : Promise.resolve(null);
}

export async function patchArtworkContent(
  ctx: MutationCtx,
  artwork: Pick<Doc<"artworks">, "_id">,
  patch: ArtworkContentFields,
): Promise<void> {
  // Re-read the pointer so invalidation and replacement in one transaction use the same content row.
  const current = await ctx.db.get("artworks", artwork._id);
  if (!current) throw new Error("Artwork not found");
  const content = await readArtworkContent(ctx, current);
  const { _id, _creationTime, ...previous } = content ?? {};
  const fields = { ...previous, ...patch };
  if (Object.values(fields).every((value) => value === undefined)) {
    if (_id) await ctx.db.delete("artworkContent", _id);
    if (current.contentId) await ctx.db.patch("artworks", current._id, { contentId: undefined });
  } else if (_id) {
    await ctx.db.patch("artworkContent", _id, patch);
  } else {
    const contentId = await ctx.db.insert("artworkContent", fields);
    await ctx.db.patch("artworks", current._id, { contentId });
  }
}
