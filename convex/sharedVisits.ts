import { selectedPhotoMedia } from './lib/albumMedia';
import { ConvexError, v } from 'convex/values';
import { pageArgs, pagination } from '../shared/journal/contracts';
import { isRevision, isUuid, LIMITS, utf8Bytes } from '../shared/journal/limits';
import { displayMedia, publicArtwork, publicProfile, sharedSelection, sharedVisitCard } from '../shared/social/contracts';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireProfile } from './lib/ownership';
import { projectArtwork, projectProfile } from './lib/projections';
import { acceptedRelationships } from './lib/friendships';
import { canReadProfilePosts, readablePublication, requireSharedVisit, requireSharedVisitItem } from './lib/publicationAccess';
import { limitKey } from './lib/rateLimits';
import { resolveDisplayAsset } from './lib/displayMedia';
import { projectArtworkStory, publicArtworkStory } from './lib/publicArtworkStory';
import { checkPublicationRevision, compareHistory, header, historyCursor, historyHead, ownedVisit, PAGE_ARTWORKS, PAGE_BYTES,
  parseHistoryCursor, projectArtworkPage, publicationForVisit, publicationItems, publicationState, publicationView, readHeadroom,
  SAVE_READ_RESERVE, selectedSaves, projectVisitAlbum, stateForPublication } from './lib/sharedPublications';

const selectionArgs = { visitLocalId: v.string(), ...sharedSelection.fields };
export const getState = query({
  args: { visitLocalId: v.string() }, returns: publicationState,
  handler: async (ctx, { visitLocalId }) => {
    const { profile, owner } = await requireProfile(ctx);
    await ownedVisit(ctx, owner, visitLocalId);
    return stateForPublication(ctx, await publicationForVisit(ctx, profile._id, visitLocalId));
  },
});
// Backs the "Shared" marker on every row of the owner's visit list with one subscription instead of one per visit.
export const listShared = query({
  args: {}, returns: v.array(v.string()),
  handler: async (ctx) => {
    const { profile } = await requireProfile(ctx);
    const publications = await ctx.db.query('sharedVisits')
      .withIndex('by_profile_status_history', (q) => q.eq('profileId', profile._id).eq('status', 'active')).take(1000);
    return publications.filter((publication) => !publication.removal).map((publication) => publication.visitLocalId);
  },
});
export const preview = query({
  args: selectionArgs,
  returns: v.object({ author: publicProfile, venue: v.object({ venueId: v.id('museums'), name: v.string() }), visitedOn: v.string(),
    reflection: v.string(), artworks: v.array(v.object({ saveLocalId: v.string(), artwork: publicArtwork, photos: v.optional(v.array(displayMedia)) })) }),
  handler: async (ctx, input) => {
    const { profile, owner } = await requireProfile(ctx);
    const { visit, saves } = await selectedSaves(ctx, owner, input);
    const artworks = [];
    for (const save of saves) {
      if (!await readHeadroom(ctx, SAVE_READ_RESERVE)) throw new ConvexError({ code: 'invalid_post' });
      const reference = { kind: 'sharedVisitPreview' as const, visitLocalId: visit.localId, saveLocalId: save.localId };
      const photos = await Promise.all((input.photoSelections?.find((row) => row.saveLocalId === save.localId)?.photoLocalIds ?? []).map((id) => selectedPhotoMedia(ctx, save, id, reference)));
      const artwork = projectArtwork(save, await resolveDisplayAsset(ctx, save), reference);
      artworks.push({ saveLocalId: save.localId, artwork: photos.length ? { ...artwork, media: photos[0] } : artwork, ...(photos.length ? { photos } : {}) });
    }
    return { author: await projectProfile(ctx, profile), venue: { venueId: visit.venueId, name: visit.venueName }, visitedOn: visit.visitedOn,
      reflection: input.reflection, artworks };
  },
});
export const publish = mutation({
  args: selectionArgs, returns: publicationState,
  handler: async (ctx, input) => {
    const { profile, owner, accountId } = await requireProfile(ctx);
    const publication = await publicationForVisit(ctx, profile._id, input.visitLocalId);
    if (publication?.removal) throw new ConvexError({ code: 'not_found' });
    checkPublicationRevision(input.revision, publication?.publicationRevision ?? 0);
    const { visit, saves } = await selectedSaves(ctx, owner, input);
    await limitKey(ctx, 'publishVisit', accountId);
    const fields = { status: 'active' as const, reflection: input.reflection, visitedOn: visit.visitedOn,
      publicationRevision: input.revision + 1, updatedAt: Date.now(), publishedAt: publication?.publishedAt || Date.now() };
    const publicationId = publication?._id ?? await ctx.db.insert('sharedVisits', { ...fields,
      profileId: profile._id, postId: crypto.randomUUID(), visitId: visit._id, visitLocalId: visit.localId });
    if (publication) await ctx.db.patch(publicationId, fields);
    const previous = await publicationItems(ctx, publicationId);
    const selected = new Set(saves.map((save) => save._id));
    for (const item of previous) if (!selected.has(item.saveId)) await ctx.db.delete(item._id);
    const ordered = [...(input.highlightLocalIds ?? []).flatMap((id) => saves.filter((save) => save.localId === id)), ...saves.filter((save) => !input.highlightLocalIds?.includes(save.localId))];
    for (const [position, save] of ordered.entries()) {
      const item = previous.find((item) => item.saveId === save._id);
      const photoLocalIds = input.photoSelections?.find((row) => row.saveLocalId === save.localId)?.photoLocalIds;
      const highlighted = input.highlightLocalIds?.includes(save.localId) ?? position < 3;
      if (item) await ctx.db.patch(item._id, { position, photoLocalIds, highlighted });
      else await ctx.db.insert('sharedVisitItems', { publicationId, saveId: save._id, saveLocalId: save.localId, position, photoLocalIds, highlighted });
    }
    return stateForPublication(ctx, (await ctx.db.get(publicationId))!);
  },
});
export const unshare = mutation({
  args: { visitLocalId: v.string(), revision: v.number() }, returns: publicationState,
  handler: async (ctx, { visitLocalId, revision }) => {
    const { owner, profile } = await requireProfile(ctx);
    const visit = await ownedVisit(ctx, owner, visitLocalId);
    const publication = await publicationForVisit(ctx, profile._id, visitLocalId);
    if (!isRevision(revision)) throw new ConvexError({ code: 'invalid_post' });
    if (publication?.status === 'private') return stateForPublication(ctx, publication);
    checkPublicationRevision(revision, publication?.publicationRevision ?? 0);
    // Even an unshared draft needs a tombstone to reject a delayed first publish.
    const publicationId = publication?._id ?? await ctx.db.insert('sharedVisits', {
      postId: crypto.randomUUID(), profileId: profile._id, visitId: visit._id, visitLocalId, visitedOn: visit.visitedOn,
      status: 'private', reflection: '', publishedAt: 0, updatedAt: Date.now(), publicationRevision: revision + 1,
    });
    if (publication) await ctx.db.patch(publicationId, { status: 'private', publicationRevision: revision + 1, updatedAt: Date.now() });
    return stateForPublication(ctx, (await ctx.db.get(publicationId))!);
  },
});
export const get = query({
  args: { postId: v.string(), ...pageArgs }, returns: publicationView,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    if (!isUuid(input.postId)) throw new ConvexError({ code: 'not_found' });
    const { publication, profile: author, visit } = await requireSharedVisit(ctx, input.postId, profile._id);
    return { ...await header(ctx, publication, author, visit), artworks: await projectArtworkPage(ctx, publication, visit, input) };
  },
});
export const getArtwork = query({
  args: { postId: v.string(), itemId: v.id('sharedVisitItems') }, returns: v.object({ ...sharedVisitCard.fields, enrichment: v.optional(publicArtworkStory) }),
  handler: async (ctx, { postId, itemId }) => {
    const { profile } = await requireProfile(ctx);
    const { item, save } = await requireSharedVisitItem(ctx, postId, itemId, profile._id);
    const enrichment = await projectArtworkStory(ctx, save);
    return { ...await projectVisitAlbum(ctx, item, save, postId), ...(enrichment ? { enrichment } : {}) };
  },
});

async function historyPage(ctx: QueryCtx, viewerId: Id<'profiles'>, authors: Id<'profiles'>[], scope: string,
  input: { cursor?: string | null; limit?: number }) {
  const { numItems } = pagination(input);
  const before = parseHistoryCursor(scope, input.cursor);
  const streams = (await Promise.all(authors.map(async (id) => ({ id, head: await historyHead(ctx, id, before) }))));
  const page = [];
  let scanned = 0, projected = 0, bytes = 0, last = before;
  while (scanned < LIMITS.maxPage && page.length < numItems) {
    const stream = streams.filter((s): s is { id: Id<'profiles'>; head: Doc<'sharedVisits'> } => !!s.head)
      .sort((a, b) => -compareHistory(a.head, b.head))[0];
    if (!stream || !await readHeadroom(ctx) || projected + 3 > PAGE_ARTWORKS) break;
    const candidate = stream.head;
    const access = await readablePublication(ctx, candidate, viewerId);
    if (access) {
      const artworks = await projectArtworkPage(ctx, candidate, access.visit, { limit: 3, highlightsOnly: true });
      const result = { ...await header(ctx, candidate, access.profile, access.visit), artworks };
      const size = utf8Bytes(result);
      if (page.length && bytes + size > PAGE_BYTES) break;
      page.push(result); bytes += size; projected += artworks.page.length;
    }
    last = candidate; scanned++;
    const next = await historyHead(ctx, stream.id, candidate);
    streams.find((s) => s.id === stream.id)!.head = next;
  }
  const isDone = streams.every((s) => !s.head);
  return { page, isDone, cursor: isDone ? null : last ? historyCursor(scope, last) : input.cursor ?? null };
}
const historyResult = v.object({ page: v.array(publicationView), cursor: v.union(v.string(), v.null()), isDone: v.boolean() });
export const listFeed = query({
  args: pageArgs, returns: historyResult,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    // Each candidate is re-authorized in historyPage, so the edge list alone selects the streams.
    const edges = await acceptedRelationships(ctx, profile._id);
    const authors = edges.slice(0, LIMITS.friends).map((edge) => edge.firstProfileId === profile._id ? edge.secondProfileId : edge.firstProfileId);
    return historyPage(ctx, profile._id, authors, `feed:${profile._id}`, input);
  },
});
export const listByProfile = query({
  args: { profileId: v.id('profiles'), ...pageArgs }, returns: historyResult,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    if (!await canReadProfilePosts(ctx, input.profileId, profile._id)) throw new ConvexError({ code: 'not_found' });
    return historyPage(ctx, profile._id, [input.profileId], `profile:${profile._id}:${input.profileId}`, input);
  },
});
