import { ConvexError } from 'convex/values';
import model from '../../shared/model/model-version.json';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { bumpCounter } from '../ingest';
import { AGREEMENT_MIN_COSINE, contributionGroup, REPLAY_COSINE, verifiedAccession } from './agreement';
import { cosine } from './cosine';
import { recordContributionScore } from './leaderboard';
import { contributionRightsIssue, eligibleContribution, eligibleObjectRecord, recognitionPartition } from './recognitionEligibility';

const ANCHOR_PAGE = 25;
const REPLAY_CHECK_VECTORS = 32;

export function earlier(a: Doc<'contributions'>, b: Doc<'contributions'> | null): boolean {
  return !b || a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a._id < b._id);
}

// The displayed reference can be withdrawn or banned before its rebuild runs. The oldest surviving
// backer anchors the group meanwhile, so a concurrent submission joins the entry instead of forking it.
async function eligibleAnchor(ctx: QueryCtx, object: Doc<'objects'>): Promise<Doc<'contributions'> | null> {
  const source = object.sourceContributionId ? await ctx.db.get(object.sourceContributionId) : null;
  if (await eligibleContribution(ctx, source)) return source;
  const rows = await ctx.db.query('contributions').withIndex('by_object_status_created', q =>
    q.eq('indexedObjectId', object._id).eq('status', 'tentative')).take(ANCHOR_PAGE);
  for (const row of rows) if (await eligibleContribution(ctx, row)) return row;
  return null;
}

// A vector already on the entry this close to the submission is the same photo, not a second view.
export async function replaysEntry(ctx: QueryCtx, row: Pick<Doc<'contributions'>, 'modelVersion' | 'vector'>, object: Doc<'objects'>): Promise<boolean> {
  const vectors = await ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', q =>
    q.eq('objectId', object._id).eq('modelVersion', row.modelVersion).eq('source', 'user')).take(REPLAY_CHECK_VECTORS);
  return vectors.some(vector => cosine(row.vector, vector.vector) >= REPLAY_COSINE);
}

// The eligible backer a compatible submission is measured against, or null when the entry is not its group.
export async function compatibleAnchor(ctx: QueryCtx, row: Pick<Doc<'contributions'>, 'venueId' | 'modelVersion' | 'fields' | 'vector'>,
  object: Doc<'objects'>): Promise<Doc<'contributions'> | null> {
  if (object.identityStatus !== 'tentative' || object.ownerId !== row.venueId || object.groupKey !== contributionGroup(row) ||
    !await eligibleObjectRecord(ctx, object)) return null;
  const anchor = await eligibleAnchor(ctx, object);
  if (!anchor || anchor.modelVersion !== row.modelVersion) return null;
  const accession = verifiedAccession(row);
  if (accession && object.provenance?.verifiedAccession && accession !== object.provenance.verifiedAccession) return null;
  const similarity = cosine(row.vector, anchor.vector);
  return similarity >= AGREEMENT_MIN_COSINE && similarity < REPLAY_COSINE ? anchor : null;
}

export async function applyReference(ctx: MutationCtx, object: Doc<'objects'>, source: Doc<'contributions'>,
  accession?: string): Promise<void> {
  if (!source.orbStorageId || !source.orbSha256 || !source.cropStorageId || !await eligibleContribution(ctx, source)) {
    throw new ConvexError({ code: 'reference_descriptors_required' });
  }
  await ctx.db.patch(object.artworkId, {
    title: source.fields.title.value, artist: source.fields.artist.value, date: source.fields.date?.value,
    retiredAt: undefined,
  });
  await ctx.db.patch(object._id, {
    sourceContributionId: source._id, sourceId: source._id, thumbnailStorageId: source.cropStorageId,
    imageRef: `storage:${source.cropStorageId}`, accession: source.fields.accession?.value, medium: source.fields.medium?.value,
    // Claims remain on contributions, including URLs and Wikidata IDs.
    provenance: { contributionIds: [], deviceIds: [], verifiedAccession: accession },
  });
  const scan = source.scanId ? await ctx.db.get(source.scanId) : null;
  const placement = await ctx.db.query('placements').withIndex('by_object_venue_source', q =>
    q.eq('objectId', object._id).eq('venueId', source.venueId).eq('source', 'contribution')).unique();
  if (placement) await ctx.db.patch(placement._id, { gallery: scan?.gallery });
  const reference = await ctx.db.query('descriptors').withIndex('by_objectId', q => q.eq('objectId', object._id)).unique();
  const fields = { objectId: object._id, contributionId: source._id, storageId: source.orbStorageId,
    sha256: source.orbSha256, keypointCount: source.keypointCount, inputSize: model.inputSize,
    extractedFrom: `contribution:${source._id}` };
  if (reference) await ctx.db.replace(reference._id, fields);
  else { await ctx.db.insert('descriptors', fields); await bumpCounter(ctx, 'descriptors', 1); }
}

export async function publishContribution(ctx: MutationCtx, row: Doc<'contributions'>, groupObjectId?: Id<'objects'>): Promise<Id<'objects'>> {
  const issue = await contributionRightsIssue(ctx, row);
  if (issue) throw new ConvexError({ code: issue });
  let object = groupObjectId ? await ctx.db.get(groupObjectId) : null;
  const anchor = object ? await compatibleAnchor(ctx, row, object) : null;
  if (object && !anchor) throw new ConvexError({ code: 'contributions_changed' });
  if (object) {
    const own = await ctx.db.query('contributions').withIndex('by_object_device', q =>
      q.eq('indexedObjectId', object!._id).eq('deviceId', row.deviceId).eq('status', 'tentative')).first();
    if (own) throw new ConvexError({ code: 'duplicate_entry' });
  } else {
    const artworkId = await ctx.db.insert('artworks', {
      key: `community:${row._id}`, identityStatus: 'tentative', title: row.fields.title.value,
      artist: row.fields.artist.value, date: row.fields.date?.value, rightsStatus: 'unknown', multiplicity: 'unknown',
    });
    const objectId = await ctx.db.insert('objects', {
      key: `user:${row._id}`, identityStatus: 'tentative', groupKey: contributionGroup(row), artworkId, ownerId: row.venueId,
      source: 'user', sourceId: row._id, confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false,
    });
    object = (await ctx.db.get(objectId))!;
    const scan = row.scanId ? await ctx.db.get(row.scanId) : null;
    await ctx.db.insert('placements', { identityStatus: 'tentative', objectId, venueId: row.venueId, gallery: scan?.gallery,
      onView: true, source: 'contribution', confidence: 0.7 });
    await bumpCounter(ctx, 'artworks', 1); await bumpCounter(ctx, 'objects', 1); await bumpCounter(ctx, 'placements', 1);
  }
  // Sharing is the accepted contribution this release; the leaderboard credits it once per entry.
  const acceptedAt = row.acceptedAt ?? Date.now();
  await ctx.db.patch(row._id, { indexedObjectId: object._id, acceptedAt });
  await recordContributionScore(ctx, { ...row, acceptedAt }, object._id, acceptedAt);
  await ctx.db.insert('vectors', { objectId: object._id, modelVersion: row.modelVersion, source: 'user',
    partition: recognitionPartition(row.modelVersion, row.venueId), contributionId: row._id, vector: row.vector });
  await bumpCounter(ctx, 'vectors', 1);
  const source = anchor && earlier(anchor, row) ? anchor : row;
  await applyReference(ctx, object, source, object.provenance?.verifiedAccession ?? verifiedAccession(row));
  await ctx.db.patch(object._id, { supportRevision: (object.supportRevision ?? 0) + 1 });
  return object._id;
}
