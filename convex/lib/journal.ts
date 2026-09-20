import { recordVisitScore } from './leaderboard';
import { ConvexError } from 'convex/values';
import { type JournalOwner, type JournalSave, type JournalVisit, validateSave, validateVisit } from '../../shared/journal/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { findOwnedSave, findOwnedVisit, nextChangeVersion } from './ownership';
import { invalidateDeletedSave, clearEmptyNoteVisibility } from './publicationAccess';

export async function upsertJournalVisit(ctx: MutationCtx, owner: JournalOwner, deviceId: Id<'devices'>, input: JournalVisit) {
  validateVisit(input);
  const existing = await findOwnedVisit(ctx, owner, input.localId);
  const venue = await ctx.db.get(input.venueId);
  if (!venue) throw new ConvexError({ code: 'invalid_venue' });
  if (existing && existing.venueId !== input.venueId) throw new ConvexError({ code: 'invalid_visit' });
  const unchanged = existing && Object.entries(input).every(([key, value]) => existing[key as keyof typeof existing] === value) &&
    existing.startedAt === input.startedAt && existing.reflection === input.reflection && existing.endedAt === input.endedAt;
  if (unchanged) return existing;
  const fields = { ...input, reflection: input.reflection, startedAt: input.startedAt, endedAt: input.endedAt,
    owner, venueName: venue.name, updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1), updatedBy: deviceId, changeVersion: await nextChangeVersion(ctx, owner) };
  const id = existing?._id ?? await ctx.db.insert('visits', fields);
  if (existing) await ctx.db.patch(id, fields);
  if (existing && (existing.visitedOn !== input.visitedOn || (input.visibility === 'private' && existing.visibility !== input.visibility))) {
    const publication = await ctx.db.query('sharedVisits').withIndex('by_visitId', (q) => q.eq('visitId', id)).unique();
    if (publication) await ctx.db.patch(publication._id, { visitedOn: input.visitedOn,
      ...(input.visibility === 'private' ? { status: 'private' as const } : {}),
      publicationRevision: publication.publicationRevision + 1, updatedAt: Date.now() });
  }
  await recordVisitScore(ctx, owner, input.venueId, input.visitedOn, existing?.visitedOn);
  return (await ctx.db.get(id))!;
}
export async function upsertJournalSave(ctx: MutationCtx, owner: JournalOwner, deviceId: Id<'devices'>, input: JournalSave): Promise<Doc<'collections'>> {
  validateSave(input);
  const existing = await findOwnedSave(ctx, owner, input.localId);
  const visit = input.visitLocalId ? await findOwnedVisit(ctx, owner, input.visitLocalId) : null;
  if (input.visitLocalId && (!visit || visit.venueId !== input.venueId)) throw new ConvexError({ code: 'not_found' });
  if (existing && (existing.visitLocalId !== input.visitLocalId || existing.venueId !== input.venueId)) {
    throw new ConvexError({ code: 'invalid_save' });
  }
  if (existing?.deletedAt !== undefined) return existing;
  if (input.venueId && !await ctx.db.get(input.venueId)) throw new ConvexError({ code: 'invalid_venue' });
  if (input.objectId && !await ctx.db.get(input.objectId)) throw new ConvexError({ code: 'invalid_object' });
  if (input.artworkId && !await ctx.db.get(input.artworkId)) throw new ConvexError({ code: 'invalid_artwork' });
  if (existing && JSON.stringify(existing.snapshot) === JSON.stringify(input.snapshot) && existing.note === input.note && existing.deletedAt === input.deletedAt) return existing;
  const stamps = { updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1), updatedBy: deviceId, changeVersion: await nextChangeVersion(ctx, owner) };
  const id = existing?._id ?? await ctx.db.insert('collections', { ...input, owner, visitId: visit?._id, ...stamps });
  if (existing) await ctx.db.patch(id, { snapshot: input.snapshot, note: input.note, deletedAt: input.deletedAt, ...stamps });
  if (!existing && visit) await ctx.db.insert('artworkEncounters', { owner, savedLocalId: input.localId, saveId: id, visitLocalId: visit.localId, visitId: visit._id, deletedAt: input.deletedAt, updatedAt: stamps.updatedAt, changeVersion: await nextChangeVersion(ctx, owner) });
  const row = (await ctx.db.get(id))!;
  if (row.deletedAt !== undefined) await invalidateDeletedSave(ctx, row);
  else if (!row.note?.trim()) await clearEmptyNoteVisibility(ctx, row._id);
  return row;
}
