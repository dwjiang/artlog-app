import { ConvexError, type Infer, v } from "convex/values";

import { isCountry, isRevision, isUuid, LIMITS, normalizeSearch } from "../journal/limits";
import { WALL_FRAMES } from "../wall/frames";
import { avatarId } from "./avatars";
import { isAllowedIdentity, isOffensive } from "./profile-text";
import { isUsername } from "./username";

export const publicProfile = v.object({
  profileId: v.id("profiles"),
  username: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  /** Shown whenever there is no photo. */
  avatar: avatarId,
  publishedWallCount: v.number(),
});
export const frame = v.union(...WALL_FRAMES.map((finish) => v.literal(finish.value)));
/** A wall without a pattern is plain color. */
export const wallPattern = v.union(
  ...(["stripe", "pinstripe", "grid", "dots", "check", "trellis"] as const).map(v.literal),
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
export const visitAudience = v.union(v.literal("private"), v.literal("friends"), v.literal("public"));
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
  variant: v.optional(v.literal("crop")),
  cropRevision: v.optional(v.number()),
});
export const displayMediaContext = v.union(wallItemMediaContext, sharedVisitMediaContext);
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
export const commonArtwork = v.object({
  itemId: v.id("wallItems"),
  artwork: publicArtwork,
});
/** Why a person is suggested. Artworks come from their public wall; museums from visits the viewer can read. */
export const suggestionReason = v.union(
  v.object({ kind: v.literal("mutual"), count: v.number(), friends: v.array(publicProfile) }),
  v.object({ kind: v.literal("artwork"), artwork: commonArtwork }),
  v.object({ kind: v.literal("museum"), venueName: v.string() }),
  v.object({ kind: v.literal("liked"), venueName: v.string() }),
);
export const suggestion = v.object({ profile: browsedProfile, reason: suggestionReason });
export const inCommon = v.object({
  artworks: v.array(commonArtwork),
  museums: v.array(v.object({ venueId: v.id("museums"), name: v.string(), city: v.optional(v.string()) })),
});
export const reportTarget = v.union(
  v.object({ kind: v.literal("profile"), profileId: v.id("profiles") }),
  v.object({ kind: v.literal("wallItem"), itemId: v.id("wallItems") }),
  v.object({ kind: v.literal("sharedVisit"), postId: v.string() }),
  v.object({ kind: v.literal("comment"), commentId: v.id("visitComments") }),
  // Generated text and audio are shared by everyone who sees the artwork, so these name the artwork.
  v.object({ kind: v.literal("docent"), artworkId: v.id("artworks") }),
  v.object({ kind: v.literal("transcript"), artworkId: v.id("artworks") }),
  v.object({ kind: v.literal("audio"), artworkId: v.id("artworks"), renderId: v.string() }),
  // Written for one scan's confirmed details and shown only to its owner.
  v.object({ kind: v.literal("scanDocent"), scanId: v.id("scans") }),
);
export type ReportKind = Infer<typeof reportTarget>["kind"];
export const REPORT_REASONS = [
  "spam",
  "harassment",
  "impersonation",
  "privacy",
  "wrongFacts",
  "wrongArtwork",
  "offensive",
  "mispronounced",
  "glitches",
  "mismatch",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const reportReason = v.union(...REPORT_REASONS.map(v.literal));
/** Stored reasons add "blocked", which the server files when someone blocks a profile; the form never offers it. */
export const filedReportReason = v.union(...reportReason.members, v.literal("blocked"));
/** Each kind lists the reasons that fit it, most common first; "other" stays last. */
export const REASONS_BY_KIND: Record<ReportKind, readonly ReportReason[]> = {
  profile: ["spam", "impersonation", "harassment", "other"],
  wallItem: ["spam", "harassment", "other"],
  sharedVisit: ["harassment", "privacy", "spam", "other"],
  comment: ["harassment", "spam", "privacy", "other"],
  docent: ["wrongFacts", "wrongArtwork", "offensive", "other"],
  scanDocent: ["wrongFacts", "wrongArtwork", "offensive", "other"],
  transcript: ["wrongFacts", "wrongArtwork", "offensive", "other"],
  audio: ["mispronounced", "glitches", "mismatch", "other"],
};
export const reportInput = v.object({
  target: reportTarget,
  reason: reportReason,
  details: v.optional(v.string()),
});
export const removal = v.object({
  reportId: v.id("reports"),
  removedAt: v.number(),
});
export const audioReportEvidence = v.object({
  kind: v.literal("audio"),
  artworkId: v.id("artworks"),
  renderId: v.string(),
  speechModel: v.string(),
  voice: v.string(),
  sentences: v.array(v.string()),
  fileIds: v.array(v.id("files")),
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
  v.object({
    kind: v.literal("comment"),
    profileId: v.id("profiles"),
    postId: v.string(),
    commentId: v.id("visitComments"),
    body: v.string(),
  }),
  // Keep the reported version as evidence for review, even if the generated content changes later.
  v.object({ kind: v.literal("docent"), artworkId: v.id("artworks"), sentences: v.array(v.string()) }),
  v.object({ kind: v.literal("transcript"), artworkId: v.id("artworks"), sentences: v.array(v.string()) }),
  v.object({ kind: v.literal("scanDocent"), scanId: v.id("scans"), sentences: v.array(v.string()) }),
  audioReportEvidence,
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
// The text is a preview snapshot, checked against the visit before publishing. The artworks are in shared order,
// and the first three lead the feed card.
export const sharedSelection = v.object({
  audience: visitAudience,
  saveLocalIds: v.array(v.string()),
  reflection: v.string(),
  revision: v.number(),
  photoSelections: v.optional(v.array(sharedPhotoSelection)),
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
  if (
    !isAllowedIdentity(name)
    || (bio !== undefined && isOffensive(bio))
    || (input.username !== undefined && !isAllowedIdentity(input.username))
  ) {
    throw new ConvexError({ code: "profile_not_allowed" });
  }
  return { name, bio };
}
export function validateSearch(query: string): string {
  const normalized = normalizeSearch(query);
  if (
    query.length > LIMITS.searchMax
    || !normalized
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
  ) {
    throw new ConvexError({ code: "invalid_media" });
  }
}
export function validateSelection(input: Infer<typeof sharedSelection>): void {
  if (
    !["private", "friends", "public"].includes(input.audience)
    || input.saveLocalIds.length > LIMITS.selectedSaves
    || new Set(input.saveLocalIds).size !== input.saveLocalIds.length
    || input.saveLocalIds.some((id) => !isUuid(id))
    || input.reflection.length > LIMITS.note
    || !isRevision(input.revision)
  ) {
    throw new ConvexError({ code: "invalid_post" });
  }
  if (
    (input.photoSelections?.length ?? 0) > LIMITS.selectedSaves
    || new Set(input.photoSelections?.map((row) => row.saveLocalId)).size !== (input.photoSelections?.length ?? 0)
    || input.photoSelections?.some(
      (row) =>
        !input.saveLocalIds.includes(row.saveLocalId)
        || row.photoLocalIds.length === 0
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
    || !REASONS_BY_KIND[input.target.kind].includes(input.reason)
    || (input.reason === "other" && !input.details?.trim())
    || (input.details?.length ?? 0) > LIMITS.reportDetails
  ) {
    throw new ConvexError({ code: "invalid_report" });
  }
}
