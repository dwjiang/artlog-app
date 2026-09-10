import { ConvexError, v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireDevice } from './lib/auth';
import schema from './schema';

export const startVisit = mutation({
  args: { venueId: v.id('museums'), localVisitId: v.string() },
  returns: v.object({ visitId: v.id('visits') }),
  handler: async (ctx, { venueId, localVisitId }) => {
    const device = await requireDevice(ctx);
    if (!localVisitId.trim() || localVisitId.length > 200) throw new ConvexError({ code: 'invalid_visit' });
    if (!await ctx.db.get(venueId)) throw new ConvexError({ code: 'invalid_venue' });
    const existing = await ctx.db.query('visitStarts')
      .withIndex('by_device_localVisitId', (q) => q.eq('deviceId', device._id).eq('localVisitId', localVisitId))
      .unique();
    if (existing) {
      const visit = await ctx.db.get(existing.visitId);
      if (!visit || visit.deviceId !== device._id || visit.venueId !== venueId) throw new ConvexError({ code: 'invalid_visit' });
      return { visitId: visit._id };
    }
    const [latest] = await ctx.db.query('visits')
      .withIndex('by_device_started', (q) => q.eq('deviceId', device._id)).order('desc').take(1);
    const now = Date.now();
    let visitId: Id<'visits'>;
    if (latest && latest.endedAt === undefined && latest.venueId === venueId && now - latest.startedAt < 4 * 60 * 60 * 1000) {
      visitId = latest._id;
    } else {
      if (latest && latest.endedAt === undefined) await ctx.db.patch(latest._id, { endedAt: now });
      visitId = await ctx.db.insert('visits', { deviceId: device._id, venueId, startedAt: now });
    }
    await ctx.db.insert('visitStarts', { deviceId: device._id, localVisitId, visitId });
    return { visitId };
  },
});

export const endVisit = mutation({
  args: { visitId: v.id('visits') },
  returns: v.null(),
  handler: async (ctx, { visitId }) => {
    const device = await requireDevice(ctx);
    const visit = await ctx.db.get(visitId);
    if (!visit || visit.deviceId !== device._id) throw new ConvexError({ code: 'invalid_visit' });
    if (visit.endedAt === undefined) await ctx.db.patch(visitId, { endedAt: Date.now() });
    return null;
  },
});

export const current = query({
  args: {},
  returns: v.union(schema.doc('visits'), v.null()),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const [latest] = await ctx.db.query('visits')
      .withIndex('by_device_started', (q) => q.eq('deviceId', device._id)).order('desc').take(1);
    return latest && latest.endedAt === undefined ? latest : null;
  },
});
