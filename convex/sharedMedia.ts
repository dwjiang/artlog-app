import { ConvexError, type Infer, v } from "convex/values";

import { sharedVisitMediaContext, validateMediaContext } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import { internalQuery, type ActionCtx } from "./_generated/server";
import { ownedAlbumPhoto } from "./lib/albumMedia";
import { resolveDisplayAsset } from "./lib/displayMedia";
import { fileStorage } from "./lib/fileStorage";
import { reportBackendError, reportMissingStoredFile } from "./lib/observability";
import { optionalProfile } from "./lib/ownership";
import { projectArtwork } from "./lib/projections";
import { requireSharedVisitItem } from "./lib/publicationAccess";

const mediaSize = v.optional(v.literal("feed"));

export const authorize = internalQuery({
  args: { context: sharedVisitMediaContext, size: mediaSize },
  returns: v.string(),
  handler: async (ctx, { context, size }) => {
    validateMediaContext(context);
    const profile = await optionalProfile(ctx);
    const { item, save } = await requireSharedVisitItem(ctx, context.postId, context.itemId, profile?._id);
    if (context.photoLocalId && !item.photoLocalIds?.includes(context.photoLocalId)) {
      throw new ConvexError({ code: "not_found" });
    }
    if (context.photoLocalId) {
      const photo = await ownedAlbumPhoto(ctx, save, context.photoLocalId);
      if (!photo.storageId) throw new ConvexError({ code: "not_found" });
      // Until its copy exists, a photo's feed size is the original.
      return (size === "feed" && photo.feedStorageId) || photo.storageId;
    }
    if (size) throw new ConvexError({ code: "not_found" });
    const asset = await resolveDisplayAsset(ctx, save);
    if (!asset?.storageId || projectArtwork(save, asset, context).media.kind !== "derivative") {
      throw new ConvexError({ code: "not_found" });
    }
    // A media row must never turn a reusable owner photo into a social derivative.
    const file = await fileStorage.getMetadata(ctx, asset.storageId);
    if (!file || file.ownerPhoto) throw new ConvexError({ code: "not_found" });
    return asset.storageId;
  },
});

// The wall transport supplies the validated context and forwards the caller's auth.
export async function serveSharedMedia(
  ctx: Pick<ActionCtx, "runQuery">,
  context: Infer<typeof sharedVisitMediaContext>,
  size?: Infer<typeof mediaSize>,
): Promise<Response> {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const storageId = await ctx.runQuery(internal.sharedMedia.authorize, { context, size });
    const blob = await fileStorage.get(ctx, storageId);
    if (!blob) {
      if ((await ctx.runQuery(internal.sharedMedia.authorize, { context, size })) === storageId) {
        await reportMissingStoredFile("sharedMedia.download", context.kind);
      }
      throw new ConvexError({ code: "not_found" });
    }
    // Recheck after fetching the bytes so a revocation during storage IO is honored.
    if ((await ctx.runQuery(internal.sharedMedia.authorize, { context, size })) !== storageId) {
      throw new ConvexError({ code: "not_found" });
    }
    return new Response(blob, {
      headers: {
        ...headers,
        "Content-Type": blob.type || "application/octet-stream",
      },
    });
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    await reportBackendError(error, "sharedMedia.download");
    return Response.json({ code: "not_found" }, { status: 404, headers });
  }
}
