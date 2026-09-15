import { ConvexError, v } from 'convex/values';
import { journalSave, journalVisit, validateBatch } from '../shared/journal/contracts';
import { LIMITS, utf8Bytes } from '../shared/journal/limits';
import type { Doc } from './_generated/dataModel';
import { mutation } from './_generated/server';
import { upsertJournalSave, upsertJournalVisit } from './lib/journal';
import { requireJournalOwner } from './lib/ownership';
import { limitDevice } from './lib/rateLimits';
import schema from './schema';

const ack = v.object({ localId: v.string(), updatedAt: v.number(), updatedBy: v.id('devices'), deletedAt: v.optional(v.number()) });
export const syncJournal = mutation({
  args: { visits: v.array(journalVisit), saves: v.array(journalSave), since: v.number(), scope: v.string() },
  returns: v.object({
    visits: v.array(schema.doc('visits')), saves: v.array(schema.doc('collections')),
    acceptedVisits: v.array(ack.extend({ visitId: v.id('visits') })), acceptedSaves: v.array(ack),
    checkpoint: v.number(), hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { device, owner } = await requireJournalOwner(ctx, args.scope);
    validateBatch(args.visits, args.saves, args.since);
    await limitDevice(ctx, 'sync', device._id);
    const state = await ctx.db.query('journalSyncState').withIndex('by_owner', (q) => q.eq('owner', owner)).unique();
    if (args.since > (state?.version ?? 0)) throw new ConvexError({ code: 'invalid_sync' });
    const acceptedVisits = [], acceptedSaves = [];
    for (const input of args.visits) {
      const row = await upsertJournalVisit(ctx, owner, device._id, input);
      acceptedVisits.push({ localId: row.localId, visitId: row._id, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
    }
    for (const input of args.saves) {
      const row = await upsertJournalSave(ctx, owner, device._id, input);
      acceptedSaves.push({ localId: row.localId, updatedAt: row.updatedAt, updatedBy: row.updatedBy, ...(row.deletedAt === undefined ? {} : { deletedAt: row.deletedAt }) });
    }
    const visitChanges = await ctx.db.query('visits').withIndex('by_owner_changeVersion', (q) => q.eq('owner', owner).gt('changeVersion', args.since)).take(LIMITS.batchRecords + 1);
    const saveChanges = await ctx.db.query('collections').withIndex('by_owner_changeVersion', (q) => q.eq('owner', owner).gt('changeVersion', args.since)).take(LIMITS.batchRecords + 1);
    const changes = [...visitChanges.map((row) => ({ kind: 'visit' as const, row })), ...saveChanges.map((row) => ({ kind: 'save' as const, row }))]
      .sort((a, b) => a.row.changeVersion - b.row.changeVersion);
    const visits: Doc<'visits'>[] = [], saves: Doc<'collections'>[] = [];
    let bytes = utf8Bytes({ acceptedVisits, acceptedSaves }), checkpoint = args.since, processed = 0;
    for (const change of changes) {
      const parent = change.kind === 'save' && change.row.visitId && !visits.some((v) => v._id === change.row.visitId)
        ? await ctx.db.get(change.row.visitId) : null;
      const alreadyAdded = change.kind === 'visit' && visits.some((v) => v._id === change.row._id);
      const records = (alreadyAdded ? 0 : 1) + (parent ? 1 : 0);
      const size = (alreadyAdded ? 0 : utf8Bytes(change.row)) + (parent ? utf8Bytes(parent) : 0);
      // The first change always ships, even oversized: an empty page would return the same checkpoint forever.
      if (processed && (visits.length + saves.length + records > LIMITS.batchRecords || bytes + size > LIMITS.batchBytes - 1024)) break;
      if (parent) visits.push(parent);
      if (change.kind === 'visit') { if (!alreadyAdded) visits.push(change.row); }
      else saves.push(change.row);
      bytes += size; checkpoint = change.row.changeVersion; processed++;
    }
    return { visits, saves, acceptedVisits, acceptedSaves, checkpoint, hasMore: processed < changes.length };
  },
});
