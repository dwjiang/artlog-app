import type { Infer } from "convex/values";

import { defaultAvatar, isAvatarId } from "../../shared/social/avatars";
import {
  type browsedProfile,
  type displayMedia,
  type publicArtwork,
  type publicProfile,
  type displayMediaContext,
  validateMedia,
} from "../../shared/social/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fileStorage } from "./fileStorage";
import { relationshipSnapshot } from "./friendships";

export async function projectProfile(ctx: QueryCtx, profile: Doc<"profiles">): Promise<Infer<typeof publicProfile>> {
  const photoUrl = profile.photoStorageId ? await fileStorage.getUrl(ctx, profile.photoStorageId) : null;
  return {
    profileId: profile._id,
    username: profile.username,
    name: profile.name,
    ...(profile.bio ? { bio: profile.bio } : {}),
    ...(photoUrl ? { photoUrl } : {}),
    avatar: isAvatarId(profile.avatar) ? profile.avatar : defaultAvatar(profile._id),
    publishedWallCount: profile.publishedWallCount,
  };
}
// Browse lists carry the viewer's relationship so each row does not need its own friendship subscription.
export async function projectBrowsedProfile(
  ctx: QueryCtx,
  viewer: Doc<"profiles"> | null,
  profile: Doc<"profiles">,
): Promise<Infer<typeof browsedProfile>> {
  const person = await projectProfile(ctx, profile);
  if (!viewer || viewer._id === profile._id) return person;
  return {
    ...person,
    relationship: (await relationshipSnapshot(ctx, viewer._id, profile._id)).state,
  };
}
export function projectArtwork(
  save: Pick<Doc<"collections">, "_id" | "snapshot">,
  asset?: Doc<"mediaAssets"> | null,
  reference?: Infer<typeof displayMediaContext>,
): Infer<typeof publicArtwork> {
  let media: Infer<typeof displayMedia> = {
    kind: "placeholder",
    width: 1,
    height: 1,
  };
  if (asset && asset.saveId === save._id && asset.revokedAt === undefined) {
    try {
      validateMedia(asset.source);
      const { width, height, credit } = asset.source;
      const metadata = { width, height, ...(credit ? { credit } : {}) };
      if (asset.source.kind === "catalog") {
        media = {
          kind: "catalog",
          url: asset.source.url,
          sourceUrl: asset.source.sourceUrl,
          rights: asset.source.rights,
          ...metadata,
        };
      } else if (reference && asset.storageId) {
        media = {
          kind: "derivative",
          rights: "contributor_consent",
          reference,
          ...metadata,
        };
      }
    } catch {
      /* Ineligible media renders the same placeholder as missing media. */
    }
  }
  const { title, artist, date, medium } = save.snapshot;
  return {
    title,
    artist,
    ...(date ? { date } : {}),
    ...(medium ? { medium } : {}),
    media,
  };
}
export function projectWallArtwork(
  item: Doc<"wallItems">,
  save: Doc<"collections">,
  asset?: Doc<"mediaAssets"> | null,
) {
  return {
    itemId: item._id,
    layout: item.layout,
    artwork: projectArtwork(save, asset, {
      kind: "wallItem",
      itemId: item._id,
    }),
    ...(item.noteVisible && save.note?.trim() ? { note: save.note } : {}),
  };
}
export function projectSharedVisitCard(
  item: Doc<"sharedVisitItems">,
  save: Doc<"collections">,
  asset?: Doc<"mediaAssets"> | null,
  postId?: string,
) {
  return {
    itemId: item._id,
    artwork: projectArtwork(save, asset, postId ? { kind: "sharedVisit", postId, itemId: item._id } : undefined),
  };
}
