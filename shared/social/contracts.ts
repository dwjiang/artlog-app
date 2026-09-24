import { ConvexError, type Infer, v } from "convex/values";
import { isCountry, isRevision, isUuid, LIMITS, normalizeSearch } from "../journal/limits";
import { isUsername } from "./username";

export const publicProfile = v.object({
  profileId: v.id("profiles"),
  username: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  publishedWallCount: v.number(),
});
export const frame = v.union(
  ...(["gilt", "baroque", "walnut", "oak", "black", "white", "mat", "none"] as const).map(v.literal),
);
export const wallLayout = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  layer: v.number(),
  frame,
});
export const relationshipState = v.union(v.literal("none"), v.literal("pending"), v.literal("accepted"));
export const relationship = v.object({
  state: relationshipState,
  revision: v.number(),
  requesterId: v.union(v.id("profiles"), v.null()),
  blocked: v.boolean(),
  blockRevision: v.number(),
});
/** A profile in a browse list, with the viewer's relationship to it when the viewer has a profile of their own. */
export const browsedProfile = v.object({
  ...publicProfile.fields,
  relationship: v.optional(relationship),
});
export const visitAudience = v.literal("public");
export const publicationStatus = v.union(v.literal("private"), v.literal("active"));
export const sharedVisitMediaContext = v.object({
  kind: v.literal("sharedVisit"),
  postId: v.string(),
  itemId: v.id("sharedVisitItems"),
  photoLocalId: v.optional(v.string()),
});
export const wallItemMediaContext = v.object({
  kind: v.literal("wallItem"),
  itemId: v.id("wallItems"),
  photoLocalId: v.optional(v.string()),
});
export const publicMediaContext = v.union(wallItemMediaContext, sharedVisitMediaContext);
export const previewMediaContext = v.object({
  kind: v.literal("sharedVisitPreview"),
  visitLocalId: v.string(),
  saveLocalId: v.string(),
  photoLocalId: v.optional(v.string()),
});
export const displayMediaContext = v.union(publicMediaContext, previewMediaContext);
export const mediaContext = v.union(
  v.object({ kind: v.literal("owner"), saveLocalId: v.string() }),
  displayMediaContext,
);
const mediaMetadata = {
  credit: v.optional(v.string()),
  width: v.number(),
  height: v.number(),
};
export const catalogMedia = v.object({
  kind: v.literal("catalog"),
  url: v.string(),
  sourceUrl: v.string(),
  rights: v.union(v.literal("public_domain"), v.literal("licensed")),
  ...mediaMetadata,
});
export const derivativeMedia = v.object({
  kind: v.literal("derivative"),
  rights: v.literal("contributor_consent"),
  ...mediaMetadata,
});
export const mediaSource = v.union(catalogMedia, derivativeMedia);
export const displayMedia = v.union(
  v.object({
    kind: v.literal("placeholder"),
    width: v.literal(1),
    height: v.literal(1),
  }),
  catalogMedia,
  v.object({ ...derivativeMedia.fields, reference: displayMediaContext }),
  v.object({
    kind: v.literal("photo"),
    credit: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    reference: displayMediaContext,
  }),
);
export const publicArtwork = v.object({
  title: v.string(),
  artist: v.string(),
  date: v.optional(v.string()),
  medium: v.optional(v.string()),
  media: displayMedia,
});
export const wallArtwork = v.object({
  itemId: v.id("wallItems"),
  layout: wallLayout,
  artwork: publicArtwork,
  note: v.optional(v.string()),
});
export const sharedVisitCard = v.object({
  itemId: v.id("sharedVisitItems"),
  artwork: publicArtwork,
  photos: v.optional(v.array(displayMedia)),
});
export const reportTarget = v.union(
  v.object({ kind: v.literal("profile"), profileId: v.id("profiles") }),
  v.object({ kind: v.literal("wallItem"), itemId: v.id("wallItems") }),
  v.object({ kind: v.literal("sharedVisit"), postId: v.string() }),
);
export const reportInput = v.object({
  target: reportTarget,
  reason: v.string(),
  details: v.optional(v.string()),
});
export const removal = v.object({
  reportId: v.id("reports"),
  removedAt: v.number(),
});
export const reportEvidence = v.union(
  v.object({
    kind: v.literal("profile"),
    profileId: v.id("profiles"),
    username: v.string(),
    name: v.string(),
    bio: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("wallItem"),
    profileId: v.id("profiles"),
    itemId: v.id("wallItems"),
    title: v.string(),
    artist: v.string(),
    date: v.optional(v.string()),
    medium: v.optional(v.string()),
    note: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("sharedVisit"),
    profileId: v.id("profiles"),
    postId: v.string(),
    reflection: v.string(),
  }),
);
export const reportDecision = v.union(v.literal("dismiss"), v.literal("remove"));
export const reportReview = v.object({
  operator: v.string(),
  decision: reportDecision,
  reason: v.string(),
  reviewedAt: v.number(),
});
export const sharedPhotoSelection = v.object({
  saveLocalId: v.string(),
  photoLocalIds: v.array(v.string()),
});
// The text is a preview snapshot, checked against the visit before publishing.
export const sharedSelection = v.object({
  audience: visitAudience,
  saveLocalIds: v.array(v.string()),
  reflection: v.string(),
  revision: v.number(),
  photoSelections: v.optional(v.array(sharedPhotoSelection)),
  highlightLocalIds: v.optional(v.array(v.string())),
});
export function validateProfile(input: { username?: string; name: string; bio?: string }) {
  const name = input.name.trim();
  const bio = input.bio?.trim();
  if (
    !name
    || name.length > LIMITS.name
    || (bio?.length ?? 0) > LIMITS.bio
    || (input.username !== undefined && !isUsername(input.username))
  ) {
    throw new ConvexError({ code: "invalid_profile" });
  }
  return { name, bio };
}
export function validateSearch(query: string): string {
  const normalized = normalizeSearch(query);
  if (
    query.length > LIMITS.searchMax
    || normalized.length < LIMITS.searchMin
    || normalized.length > LIMITS.searchMax
    || normalized.split(" ").length > 16
  ) {
    throw new ConvexError({ code: "invalid_profile" });
  }
  return normalized;
}
export function validateGeography(input: { city?: string; country?: string }): void {
  if (
    (input.city !== undefined && (!input.city.trim() || input.city.length > LIMITS.city))
    || (input.country !== undefined && !isCountry(input.country))
  ) {
    throw new ConvexError({ code: "invalid_venue" });
  }
}
export function validateLayout(input: Infer<typeof wallLayout>): void {
  if (
    ![input.x, input.y, input.width].every(Number.isFinite)
    || input.x < 0
    || input.y < 0
    || input.width <= 0
    || input.x + input.width > 1
    || input.y > 100
    || !isRevision(input.layer)
    || input.layer >= LIMITS.wallItems
  ) {
    throw new ConvexError({ code: "invalid_wall" });
  }
}
export function isPublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 4096
      && url.protocol === "https:"
      && !url.username
      && !url.password
      && !/(^|\.)convex\.(cloud|site)$/.test(url.hostname)
      && !/collection.?photos?|\/api\/storage|owner.?photos?/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function validateMedia(input: Infer<typeof mediaSource>): void {
  if (
    ![input.width, input.height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 65_535)
    || (input.credit?.length ?? 0) > LIMITS.snapshot
    || (input.kind === "catalog"
      && (!isPublicMediaUrl(input.url)
        || !isPublicMediaUrl(input.sourceUrl)
        || !["public_domain", "licensed"].includes(input.rights)))
    || (input.kind === "derivative"
      && (input.rights !== "contributor_consent" || Math.max(input.width, input.height) > 256))
  ) {
    throw new ConvexError({ code: "invalid_media" });
  }
}
export function validateMediaContext(input: Infer<typeof mediaContext>): void {
  if (
    (input.kind === "owner" && !isUuid(input.saveLocalId))
    || (input.kind === "sharedVisit" && !isUuid(input.postId))
    || (input.kind === "sharedVisitPreview" && (!isUuid(input.visitLocalId) || !isUuid(input.saveLocalId)))
  ) {
    throw new ConvexError({ code: "invalid_media" });
  }
}
export function validateSelection(input: Infer<typeof sharedSelection>): void {
  if (
    input.audience !== "public"
    || input.saveLocalIds.length > LIMITS.selectedSaves
    || new Set(input.saveLocalIds).size !== input.saveLocalIds.length
    || input.saveLocalIds.some((id) => !isUuid(id))
    || input.reflection.length > LIMITS.note
    || !isRevision(input.revision)
  ) {
    throw new ConvexError({ code: "invalid_post" });
  }
  if (
    (input.highlightLocalIds?.length ?? 0) > 3
    || new Set(input.highlightLocalIds).size !== (input.highlightLocalIds?.length ?? 0)
    || input.highlightLocalIds?.some((id) => !input.saveLocalIds.includes(id))
    || (input.photoSelections?.length ?? 0) > LIMITS.selectedSaves
    || new Set(input.photoSelections?.map((row) => row.saveLocalId)).size !== (input.photoSelections?.length ?? 0)
    || input.photoSelections?.some(
      (row) =>
        !input.saveLocalIds.includes(row.saveLocalId)
        || !row.photoLocalIds.length
        || row.photoLocalIds.length > 100
        || new Set(row.photoLocalIds).size !== row.photoLocalIds.length
        || row.photoLocalIds.some((id) => !isUuid(id)),
    )
  ) {
    throw new ConvexError({ code: "invalid_post" });
  }
}
export function validateRelationship(input: {
  firstProfileId: string;
  secondProfileId: string;
  requesterId: string;
  revision: number;
}): void {
  if (
    input.firstProfileId >= input.secondProfileId
    || ![input.firstProfileId, input.secondProfileId].includes(input.requesterId)
    || !isRevision(input.revision)
  ) {
    throw new ConvexError({ code: "invalid_relationship" });
  }
}
export function validateWallItems(
  items: {
    placementId: string;
    saveLocalId: string;
    photoLocalId?: string;
    layout: Infer<typeof wallLayout>;
  }[],
  revision: number,
): void {
  if (
    items.length > LIMITS.wallItems
    || new Set(items.map((item) => item.placementId)).size !== items.length
    || new Set(items.map((item) => item.layout.layer)).size !== items.length
    || !isRevision(revision)
  ) {
    throw new ConvexError({ code: "invalid_wall" });
  }
  for (const item of items) {
    if (
      !isUuid(item.saveLocalId)
      || !isUuid(item.placementId)
      || (item.photoLocalId !== undefined && !isUuid(item.photoLocalId))
    ) {
      throw new ConvexError({ code: "invalid_wall" });
    }
    validateLayout(item.layout);
  }
}
export function validateReport(input: Infer<typeof reportInput>): void {
  if (
    (input.target.kind === "sharedVisit" && !isUuid(input.target.postId))
    || !input.reason.trim()
    || input.reason.length > LIMITS.reportReason
    || (input.details?.length ?? 0) > LIMITS.reportDetails
  ) {
    throw new ConvexError({ code: "invalid_report" });
  }
}
