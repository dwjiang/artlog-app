import { v } from 'convex/values';
import { journalVisit } from '../shared/journal/contracts';
import { mutation } from './_generated/server';
import { upsertJournalVisit } from './lib/journal';
import { requireJournalOwner } from './lib/ownership';
import { limitDevice } from './lib/rateLimits';
import schema from './schema';

export const upsertJournal = mutation({
  args: { scope: v.string(), visit: journalVisit }, returns: schema.doc('visits'),
  handler: async (ctx, { scope, visit }) => {
    const { owner, device } = await requireJournalOwner(ctx, scope);
    await limitDevice(ctx, 'sync', device._id);
    return upsertJournalVisit(ctx, owner, device._id, visit);
  },
});
