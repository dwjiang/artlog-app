import { ConvexError, type Infer, v } from 'convex/values';
import { isCountry, isRevision, isUuid, LIMITS, normalizeSearch } from '../journal/limits';

export const publicProfile = v.object({
  profileId: v.id('profiles'), username: v.string(), name: v.string(), bio: v.optional(v.string()), publishedWallCount: v.number(),
});
export const frame = v.union(...(['gilt', 'baroque', 'walnut', 'oak', 'black', 'white', 'mat', 'none'] as const).map(v.literal));
export const wallLayout = v.object({ x: v.number(), y: v.number(), width: v.number(), layer: v.number(), frame });
export const relationshipState = v.union(v.literal('none'), v.literal('pending'), v.literal('accepted'));
export const publicationStatus = v.union(v.literal('private'), v.literal('active'));
export const publicMediaContext = v.union(
  v.object({ kind: v.literal('wallItem'), itemId: v.id('wallItems') }),
  v.object({ kind: v.literal('sharedVisit'), postId: v.string(), itemId: v.id('sharedVisitItems') }),
);
export const mediaContext = v.union(
  v.object({ kind: v.literal('owner'), saveLocalId: v.string() }), publicMediaContext,
);
const mediaMetadata = {
  credit: v.optional(v.string()), width: v.number(), height: v.number(),
};
export const catalogMedia = v.object({ kind: v.literal('catalog'), url: v.string(), sourceUrl: v.string(),
  rights: v.union(v.literal('public_domain'), v.literal('licensed')), ...mediaMetadata });
export const derivativeMedia = v.object({ kind: v.literal('derivative'), rights: v.literal('contributor_consent'), ...mediaMetadata });
export const mediaSource = v.union(catalogMedia, derivativeMedia);
export const displayMedia = v.union(
  v.object({ kind: v.literal('placeholder'), width: v.literal(1), height: v.literal(1) }),
  catalogMedia,
  v.object({ ...derivativeMedia.fields, reference: publicMediaContext }),
);
export const publicArtwork = v.object({
  title: v.string(), artist: v.string(), date: v.optional(v.string()), medium: v.optional(v.string()), media: displayMedia,
});
export const wallArtwork = v.object({ itemId: v.id('wallItems'), layout: wallLayout, artwork: publicArtwork, note: v.optional(v.string()) });
export const sharedVisitCard = v.object({ itemId: v.id('sharedVisitItems'), artwork: publicArtwork });
export const reportTarget = v.union(
  v.object({ kind: v.literal('profile'), profileId: v.id('profiles') }),
  v.object({ kind: v.literal('wallItem'), itemId: v.id('wallItems') }),
  v.object({ kind: v.literal('sharedVisit'), postId: v.string() }),
);
export const reportInput = v.object({ target: reportTarget, reason: v.string(), details: v.optional(v.string()) });
export const sharedSelection = v.object({ saveLocalIds: v.array(v.string()), reflection: v.string(), revision: v.number() });
export function validateProfile(input: { username?: string; name: string; bio?: string }) {
  const name = input.name.trim();
  const bio = input.bio?.trim();
  if (!name || name.length > LIMITS.name || (bio?.length ?? 0) > LIMITS.bio || (input.username !== undefined &&
    (input.username.length < LIMITS.usernameMin || input.username.length > LIMITS.usernameMax || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.username)))) {
    throw new ConvexError({ code: 'invalid_profile' });
  }
  return { name, bio };
}
export function validateSearch(query: string): string {
  const normalized = normalizeSearch(query);
  if (query.length > LIMITS.searchMax || normalized.length < LIMITS.searchMin || normalized.length > LIMITS.searchMax ||
    normalized.split(' ').length > 16) throw new ConvexError({ code: 'invalid_profile' });
  return normalized;
}
export function validateGeography(input: { city?: string; country?: string }): void {
  if ((input.city !== undefined && (!input.city.trim() || input.city.length > LIMITS.city)) ||
    (input.country !== undefined && !isCountry(input.country))) throw new ConvexError({ code: 'invalid_venue' });
}
export function validateLayout(input: Infer<typeof wallLayout>): void {
  if (![input.x, input.y, input.width].every(Number.isFinite) || input.x < 0 || input.y < 0 || input.width <= 0 ||
    input.x + input.width > 1 || input.y > 100 || !isRevision(input.layer) || input.layer >= LIMITS.wallItems) throw new ConvexError({ code: 'invalid_wall' });
}
export function isPublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password &&
      !/(^|\.)convex\.(cloud|site)$/.test(url.hostname) &&
      !/collection.?photos?|\/api\/storage|owner.?photos?/i.test(url.pathname);
  } catch { return false; }
}
export function validateMedia(input: Infer<typeof mediaSource>): void {
  if (![input.width, input.height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 65_535) ||
    (input.credit?.length ?? 0) > LIMITS.snapshot ||
    (input.kind === 'catalog' && (!isPublicMediaUrl(input.url) || !isPublicMediaUrl(input.sourceUrl) || !['public_domain', 'licensed'].includes(input.rights))) ||
    (input.kind === 'derivative' && (input.rights !== 'contributor_consent' || Math.max(input.width, input.height) > 256))) {
    throw new ConvexError({ code: 'invalid_media' });
  }
}
export function validateMediaContext(input: Infer<typeof mediaContext>): void {
  if ((input.kind === 'owner' && !isUuid(input.saveLocalId)) || (input.kind === 'sharedVisit' && !isUuid(input.postId))) {
    throw new ConvexError({ code: 'invalid_media' });
  }
}
export function validateSelection(input: Infer<typeof sharedSelection>): void {
  if (input.saveLocalIds.length > LIMITS.selectedSaves || new Set(input.saveLocalIds).size !== input.saveLocalIds.length ||
    input.saveLocalIds.some((id) => !isUuid(id)) || input.reflection.length > LIMITS.sharedReflection || !isRevision(input.revision)) {
    throw new ConvexError({ code: 'invalid_post' });
  }
}
export function validateRelationship(input: { firstProfileId: string; secondProfileId: string; requesterId: string; revision: number }): void {
  if (input.firstProfileId >= input.secondProfileId || ![input.firstProfileId, input.secondProfileId].includes(input.requesterId) || !isRevision(input.revision)) {
    throw new ConvexError({ code: 'invalid_relationship' });
  }
}
export function validateWallItems(items: { saveLocalId: string; layout: Infer<typeof wallLayout> }[], revision: number): void {
  if (items.length > LIMITS.wallItems || new Set(items.map((item) => item.saveLocalId)).size !== items.length ||
    new Set(items.map((item) => item.layout.layer)).size !== items.length || !isRevision(revision)) {
    throw new ConvexError({ code: 'invalid_wall' });
  }
  for (const item of items) {
    if (!isUuid(item.saveLocalId)) throw new ConvexError({ code: 'invalid_wall' });
    validateLayout(item.layout);
  }
}
export function validateReport(input: Infer<typeof reportInput>): void {
  if ((input.target.kind === 'sharedVisit' && !isUuid(input.target.postId)) || !input.reason.trim() || input.reason.length > LIMITS.reportReason || (input.details?.length ?? 0) > LIMITS.reportDetails) {
    throw new ConvexError({ code: 'invalid_report' });
  }
}
