import { ownedAlbumPhoto, selectedPhotoMedia } from './albumMedia';
import type { IndexRange, NamedTableInfo, Query } from 'convex/server';
import { ConvexError, type Infer, v } from 'convex/values';
import { pagination, type JournalOwner } from '../../shared/journal/contracts';
import { isCalendarDate, isRevision, isUuid, LIMITS, utf8Bytes } from '../../shared/journal/limits';
import { visitAudience, publicProfile, sharedVisitCard, sharedPhotoSelection, sharedSelection, validateSelection } from '../../shared/social/contracts';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { findOwnedVisit, requireMembership, requireOwnedSave } from './ownership';
import { projectProfile, projectSharedVisitCard } from './projections';
import { resolveDisplayAsset } from './displayMedia';

export const publicationHeader = v.object({ audience: visitAudience,
  postId: v.string(), author: publicProfile, venue: v.object({ venueId: v.id('museums'), name: v.string(), city: v.optional(v.string()) }),
  artworkCount: v.optional(v.number()), visitedOn: v.string(), reflection: v.string(), publishedAt: v.number(), revision: v.number(),
});
export const artworkPage = v.object({ page: v.array(sharedVisitCard), cursor: v.union(v.string(), v.null()), isDone: v.boolean() });
export const publicationView = v.object({ ...publicationHeader.fields, artworks: artworkPage });
export const publicationState = v.object({ audience: visitAudience, postId: v.union(v.string(), v.null()), status: v.union(v.literal('private'), v.literal('active')),
  photoSelections: v.optional(v.array(sharedPhotoSelection)), highlightLocalIds: v.optional(v.array(v.string())), removed: v.boolean(), reflection: v.string(), saveLocalIds: v.array(v.string()), revision: v.number() });
export const PAGE_BYTES = 2 * 1024 * 1024;
export const PAGE_ARTWORKS = 50;
// Reserve for one more maximum-size save plus its media rows; preview and publish share it so they accept the same selections.
export const SAVE_READ_RESERVE = 1.1 * 1024 * 1024;

export async function readHeadroom(ctx: QueryCtx, reserve = 6 * 1024 * 1024) {
  const metrics = await ctx.meta.getTransactionMetrics();
  return metrics.bytesRead.remaining > reserve && metrics.databaseQueries.remaining > 100;
}
export function publicationForVisit(ctx: QueryCtx, profileId: Id<'profiles'>, visitLocalId: string) {
  return ctx.db.query('sharedVisits').withIndex('by_profile_visit', (q) => q.eq('profileId', profileId).eq('visitLocalId', visitLocalId)).unique();
}
export async function ownedVisit(ctx: QueryCtx, owner: JournalOwner, localId: string) {
  if (!isUuid(localId)) throw new ConvexError({ code: 'not_found' });
  const visit = await findOwnedVisit(ctx, owner, localId);
  if (!visit) throw new ConvexError({ code: 'not_found' });
  return visit;
}
export async function selectedSaves(ctx: QueryCtx, owner: JournalOwner, input: Infer<typeof sharedSelection> & { visitLocalId: string }) {
  validateSelection(input);
  const visit = await ownedVisit(ctx, owner, input.visitLocalId);
  if (visit.visibility === 'private') throw new ConvexError({ code: 'visit_private' });
  if (input.reflection !== (visit.reflection ?? '')) throw new ConvexError({ code: 'conflict' });
  const saves = [];
  for (const localId of input.saveLocalIds) {
    if (!await readHeadroom(ctx, SAVE_READ_RESERVE)) throw new ConvexError({ code: 'invalid_post' });
    const save = await requireOwnedSave(ctx, owner, localId);
    await requireMembership(ctx, save, visit);
    for (const id of input.photoSelections?.find((row) => row.saveLocalId === localId)?.photoLocalIds ?? []) await ownedAlbumPhoto(ctx, save, id);
    saves.push(save);
  }
  return { visit, saves };
}
export function publicationItems(ctx: QueryCtx, publicationId: Id<'sharedVisits'>) {
  return ctx.db.query('sharedVisitItems').withIndex('by_publication_position', (q) => q.eq('publicationId', publicationId))
    .take(LIMITS.selectedSaves + 1);
}
export async function header(ctx: QueryCtx, publication: Doc<'sharedVisits'>, profile: Doc<'profiles'>, visit: Doc<'visits'>): Promise<Infer<typeof publicationHeader>> {
  const venue = await ctx.db.get(visit.venueId);
  return { audience: publication.audience, artworkCount: (await publicationItems(ctx, publication._id)).length, postId: publication.postId, author: await projectProfile(ctx, profile), venue: { venueId: visit.venueId, name: visit.venueName, ...(venue?.city ? { city: venue.city } : {}) },
    visitedOn: publication.visitedOn, reflection: publication.reflection, publishedAt: publication.publishedAt, revision: publication.publicationRevision };
}
export async function stateForPublication(ctx: QueryCtx, publication: Doc<'sharedVisits'> | null, visit: Doc<'visits'>): Promise<Infer<typeof publicationState>> {
  const items = publication ? await publicationItems(ctx, publication._id) : [];
  return { audience: publication?.audience ?? 'public', photoSelections: items.filter((item) => item.photoLocalIds?.length).map((item) => ({ saveLocalId: item.saveLocalId, photoLocalIds: item.photoLocalIds! })),
    highlightLocalIds: items.filter((item) => item.highlighted).map((item) => item.saveLocalId), postId: publication?.postId ?? null, status: publication?.status ?? 'private', removed: !!publication?.removal,
    reflection: (visit.reflection ?? ''), revision: publication?.publicationRevision ?? 0,
    saveLocalIds: items.map((item) => item.saveLocalId) };
}
export function checkPublicationRevision(observed: number, current: number) {
  if (!isRevision(observed)) throw new ConvexError({ code: 'invalid_post' });
  if (observed !== current) throw new ConvexError({ code: 'conflict' });
}

function artworkCursor(publication: Doc<'sharedVisits'>, position: number) {
  return JSON.stringify({ kind: 'artworks', postId: publication.postId, revision: publication.publicationRevision, position });
}
function artworkPosition(publication: Doc<'sharedVisits'>, cursor?: string | null): number {
  if (!cursor) return -1;
  try {
    const value = JSON.parse(cursor);
    if (Object.keys(value).sort().join(',') !== 'kind,position,postId,revision' || value.kind !== 'artworks' ||
      value.postId !== publication.postId || !isRevision(value.revision) || !isRevision(value.position) || value.position >= LIMITS.selectedSaves) throw Error();
    if (value.revision !== publication.publicationRevision) throw new ConvexError({ code: 'conflict' });
    return value.position;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({ code: 'invalid_pagination' });
  }
}
export async function projectArtworkPage(ctx: QueryCtx, publication: Doc<'sharedVisits'>, visit: Doc<'visits'>,
  input: { cursor?: string | null; limit?: number; highlightsOnly?: boolean }): Promise<Infer<typeof artworkPage>> {
  const { numItems } = pagination(input);
  const start = artworkPosition(publication, input.cursor);
  const items = await ctx.db.query('sharedVisitItems').withIndex('by_publication_position',
    (q) => q.eq('publicationId', publication._id).gt('position', start)).take(LIMITS.selectedSaves + 1);
  const page: Infer<typeof sharedVisitCard>[] = [];
  let position = start, consumed = 0, bytes = 0;
  for (const item of items) {
    if (page.length >= numItems || !await readHeadroom(ctx)) break;
    const save = await ctx.db.get(item.saveId);
    if (save && save.deletedAt === undefined && item.saveLocalId === save.localId && (!input.highlightsOnly || item.highlighted)) {
      await requireMembership(ctx, save, visit);
      const card = await projectVisitAlbum(ctx, item, save, publication.postId);
      const size = utf8Bytes(card);
      if (page.length && bytes + size > PAGE_BYTES) break;
      page.push(card); bytes += size;
    }
    position = item.position; consumed++;
  }
  const isDone = consumed === items.length;
  return { page, isDone, cursor: isDone ? null : artworkCursor(publication, position) };
}

export type HistoryKey = { visitedOn: string; postId: string };
export const compareHistory = (a: HistoryKey, b: HistoryKey) =>
  a.visitedOn === b.visitedOn ? (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0) : (a.visitedOn < b.visitedOn ? -1 : 1);
export function historyCursor(scope: string, key: HistoryKey) {
  return JSON.stringify({ kind: 'history', scope, visitedOn: key.visitedOn, postId: key.postId });
}
export function parseHistoryCursor(scope: string, cursor?: string | null): HistoryKey | null {
  if (cursor == null) return null;
  try {
    const value = JSON.parse(cursor);
    if (Object.keys(value).sort().join(',') !== 'kind,postId,scope,visitedOn' || value.kind !== 'history' || value.scope !== scope ||
      typeof value.visitedOn !== 'string' || !isCalendarDate(value.visitedOn) || typeof value.postId !== 'string' || !isUuid(value.postId)) throw Error();
    return { visitedOn: value.visitedOn, postId: value.postId };
  } catch { throw new ConvexError({ code: 'invalid_pagination' }); }
}
// Every history index ends in ['visitedOn', 'postId']; a stream binds the prefix so one head query serves all of them.
type HistoryTail = IndexRange & { eq(field: 'visitedOn', value: string): { lt(field: 'postId', value: string): IndexRange }; lt(field: 'visitedOn', value: string): IndexRange };
export type HistoryStream = (bound: (tail: HistoryTail) => IndexRange) => Query<NamedTableInfo<DataModel, 'sharedVisits'>>;
export const profileHistory = (ctx: QueryCtx, profileId: Id<'profiles'>): HistoryStream => (bound) =>
  ctx.db.query('sharedVisits').withIndex('by_profile_status_history', (q) => bound(q.eq('profileId', profileId).eq('status', 'active')));
export const publicHistory = (ctx: QueryCtx): HistoryStream => (bound) =>
  ctx.db.query('sharedVisits').withIndex('by_audience_status_history', (q) => bound(q.eq('audience', 'public').eq('status', 'active')));
export async function historyHead(stream: HistoryStream, before: HistoryKey | null) {
  if (!before) return stream((tail) => tail).order('desc').first();
  const sameDate = await stream((tail) => tail.eq('visitedOn', before.visitedOn).lt('postId', before.postId)).order('desc').first();
  return sameDate ?? stream((tail) => tail.lt('visitedOn', before.visitedOn)).order('desc').first();
}

export async function projectVisitAlbum(ctx: QueryCtx, item: Doc<'sharedVisitItems'>, save: Doc<'collections'>, postId: string): Promise<Infer<typeof sharedVisitCard>> {
  const card = projectSharedVisitCard(item, save, await resolveDisplayAsset(ctx, save), postId);
  const photos = [];
  for (const localId of item.photoLocalIds ?? []) {
    try { photos.push(await selectedPhotoMedia(ctx, save, localId, { kind: 'sharedVisit', postId, itemId: item._id })); }
    catch (error) { if (!(error instanceof ConvexError && error.data.code === 'not_found')) throw error; }
  }
  return photos.length ? { ...card, artwork: { ...card.artwork, media: photos[0] }, photos } : card;
}
