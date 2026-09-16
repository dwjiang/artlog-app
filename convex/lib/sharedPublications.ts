import { ConvexError, type Infer, v } from 'convex/values';
import { pagination, type JournalOwner } from '../../shared/journal/contracts';
import { isCalendarDate, isRevision, isUuid, LIMITS, utf8Bytes } from '../../shared/journal/limits';
import { publicProfile, sharedVisitCard, validateSelection } from '../../shared/social/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { findOwnedVisit, requireMembership, requireOwnedSave } from './ownership';
import { projectProfile, projectSharedVisitCard } from './projections';
import { resolveDisplayAsset } from './displayMedia';

export const publicationHeader = v.object({
  postId: v.string(), author: publicProfile, venue: v.object({ venueId: v.id('museums'), name: v.string(), city: v.optional(v.string()) }),
  visitedOn: v.string(), reflection: v.string(), publishedAt: v.number(), revision: v.number(),
});
export const artworkPage = v.object({ page: v.array(sharedVisitCard), cursor: v.union(v.string(), v.null()), isDone: v.boolean() });
export const publicationView = v.object({ ...publicationHeader.fields, artworks: artworkPage });
export const publicationState = v.object({ postId: v.union(v.string(), v.null()), status: v.union(v.literal('private'), v.literal('active')),
  removed: v.boolean(), reflection: v.string(), saveLocalIds: v.array(v.string()), revision: v.number() });
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
export async function selectedSaves(ctx: QueryCtx, owner: JournalOwner, input: {
  visitLocalId: string; saveLocalIds: string[]; reflection: string; revision: number;
}) {
  validateSelection(input);
  const visit = await ownedVisit(ctx, owner, input.visitLocalId);
  const saves = [];
  for (const localId of input.saveLocalIds) {
    if (!await readHeadroom(ctx, SAVE_READ_RESERVE)) throw new ConvexError({ code: 'invalid_post' });
    const save = await requireOwnedSave(ctx, owner, localId);
    requireMembership(save, visit);
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
  return { postId: publication.postId, author: await projectProfile(ctx, profile), venue: { venueId: visit.venueId, name: visit.venueName, ...(venue?.city ? { city: venue.city } : {}) },
    visitedOn: publication.visitedOn, reflection: publication.reflection, publishedAt: publication.publishedAt, revision: publication.publicationRevision };
}
export async function stateForPublication(ctx: QueryCtx, publication: Doc<'sharedVisits'> | null): Promise<Infer<typeof publicationState>> {
  return { postId: publication?.postId ?? null, status: publication?.status ?? 'private', removed: !!publication?.removal,
    reflection: publication?.reflection ?? '', revision: publication?.publicationRevision ?? 0,
    saveLocalIds: publication ? (await publicationItems(ctx, publication._id)).map((item) => item.saveLocalId) : [] };
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
  input: { cursor?: string | null; limit?: number }): Promise<Infer<typeof artworkPage>> {
  const { numItems } = pagination(input);
  const start = artworkPosition(publication, input.cursor);
  const items = await ctx.db.query('sharedVisitItems').withIndex('by_publication_position',
    (q) => q.eq('publicationId', publication._id).gt('position', start)).take(LIMITS.selectedSaves + 1);
  const page: Infer<typeof sharedVisitCard>[] = [];
  let position = start, consumed = 0, bytes = 0;
  for (const item of items) {
    if (page.length >= numItems || !await readHeadroom(ctx)) break;
    const save = await ctx.db.get(item.saveId);
    if (save && save.deletedAt === undefined && item.saveLocalId === save.localId) {
      requireMembership(save, visit);
      const card = projectSharedVisitCard(item, save, await resolveDisplayAsset(ctx, save), publication.postId);
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
export async function historyHead(ctx: QueryCtx, profileId: Id<'profiles'>, before: HistoryKey | null) {
  if (!before) return ctx.db.query('sharedVisits').withIndex('by_profile_status_history',
    (q) => q.eq('profileId', profileId).eq('status', 'active')).order('desc').first();
  const sameDate = await ctx.db.query('sharedVisits').withIndex('by_profile_status_history',
    (q) => q.eq('profileId', profileId).eq('status', 'active').eq('visitedOn', before.visitedOn).lt('postId', before.postId)).order('desc').first();
  return sameDate ?? ctx.db.query('sharedVisits').withIndex('by_profile_status_history',
    (q) => q.eq('profileId', profileId).eq('status', 'active').lt('visitedOn', before.visitedOn)).order('desc').first();
}
