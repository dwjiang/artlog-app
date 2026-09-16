import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isVenueOptedOut } from './venueOptOut';

export function recognitionPartition(modelVersion: string, venueId?: Id<'museums'>): string {
  return JSON.stringify([modelVersion, venueId ?? 'established']);
}

export async function eligibleContribution(ctx: QueryCtx, row: Doc<'contributions'> | null): Promise<boolean> {
  if (!row || row.status !== 'tentative' || !row.cropStorageId || !row.orbStorageId) return false;
  const device = await ctx.db.get(row.deviceId);
  const venue = await ctx.db.get(row.venueId);
  return !!device && !device.banned && !!venue && !await isVenueOptedOut(ctx, venue);
}

export async function eligibleObject(ctx: QueryCtx, object: Doc<'objects'>, venueId?: Id<'museums'>): Promise<boolean> {
  if (object.reverted || object.mergedInto) return false;
  if (await ctx.db.query('takedowns').withIndex('by_artworkId', q => q.eq('artworkId', object.artworkId)).first() ||
    await ctx.db.query('takedowns').withIndex('by_objectId', q => q.eq('objectId', object._id)).first()) return false;
  if (object.sourceProposalId) {
    const proposal = await ctx.db.get(object.sourceProposalId);
    if (!proposal || proposal.revertedAt !== undefined) return false;
    for (const deviceId of proposal.deviceIds) {
      const device = await ctx.db.get(deviceId);
      if (!device || device.banned) return false;
    }
  }
  if (object.identityStatus === 'established') return true;
  if (!venueId || object.ownerId !== venueId || !object.sourceContributionId) return false;
  return eligibleContribution(ctx, await ctx.db.get(object.sourceContributionId));
}

export async function eligibleVector(ctx: QueryCtx, vector: Doc<'vectors'>): Promise<boolean> {
  if (vector.source === 'user' && !vector.contributionId) return false;
  if (vector.source === 'user_scan' && !vector.scanId) return false;
  if (vector.contributionId && !await eligibleContribution(ctx, await ctx.db.get(vector.contributionId))) return false;
  if (vector.scanId) {
    const scan = await ctx.db.get(vector.scanId);
    const device = scan ? await ctx.db.get(scan.deviceId) : null;
    if (!device || device.banned) return false;
  }
  if (vector.feedbackId) {
    const feedback = await ctx.db.get(vector.feedbackId);
    if (!feedback?.multiViewAgreement || feedback.resolution.kind !== 'runner_up') return false;
    for (const id of [feedback.multiViewAgreement.firstDeviceId, feedback.multiViewAgreement.secondDeviceId]) {
      const device = await ctx.db.get(id);
      if (!device || device.banned) return false;
    }
  }
  return true;
}
