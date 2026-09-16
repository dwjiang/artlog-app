import { ConvexError } from 'convex/values';
import model from '../../shared/model/model-version.json';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { bumpCounter } from '../ingest';
import { AGREEMENT_MIN_COSINE, REPLAY_COSINE, verifiedAccession, workKey } from './agreement';
import { cosine } from './cosine';
import { museumIdentityKeys } from './museumWorkIdentity';
import { eligibleContribution, eligibleObject, recognitionPartition } from './recognitionEligibility';
import { isVenueOptedOut } from './venueOptOut';

export function contributionGroup(row: Pick<Doc<'contributions'>, 'venueId' | 'modelVersion' | 'fields'>): string {
  return JSON.stringify([row.venueId, row.modelVersion, workKey(row.fields)]);
}

export async function assertContributionRights(ctx: QueryCtx, row: Pick<Doc<'contributions'>,
  'venueId' | 'fields' | 'sourceUrl' | 'identityImageUrl' | 'wikidataId' | 'deviceId' | 'modelVersion' | 'vector' | 'evidence' | '_id' | 'createdAt'>) {
  const venue = await ctx.db.get(row.venueId);
  if (!venue || await isVenueOptedOut(ctx, venue)) throw new ConvexError({ code: 'invalid_venue' });
  const keys = await museumIdentityKeys({ accession: verifiedAccession(row), pageUrl: row.sourceUrl,
    imageUrl: row.identityImageUrl, names: workKey(row.fields) });
  const artworkIds = new Set<Id<'artworks'>>();
  for (const { key } of keys) {
    const identity = await ctx.db.query('museumWorkIdentities').withIndex('by_venue_identity', q =>
      q.eq('venueId', row.venueId).eq('identity', key)).unique();
    if (identity) artworkIds.add(identity.artworkId);
  }
  if (row.wikidataId) {
    const artwork = await ctx.db.query('artworks').withIndex('by_wikidataId', q => q.eq('wikidataId', row.wikidataId)).first();
    if (artwork) artworkIds.add(artwork._id);
  }
  for (const artworkId of artworkIds) {
    if (await ctx.db.query('takedowns').withIndex('by_artworkId', q => q.eq('artworkId', artworkId)).first()) {
      throw new ConvexError({ code: 'artwork_taken_down' });
    }
    if (await ctx.db.query('takedowns').withIndex('by_identity_artwork_venue', q =>
      q.eq('identityArtworkId', artworkId).eq('venueId', row.venueId)).first()) {
      throw new ConvexError({ code: 'artwork_taken_down' });
    }
  }
}

export async function compatibleEntry(ctx: QueryCtx, row: Pick<Doc<'contributions'>, 'venueId' | 'modelVersion' | 'fields' | 'vector'>, object: Doc<'objects'>): Promise<boolean> {
  if (object.identityStatus !== 'tentative' || object.reverted || object.mergedInto ||
    object.groupKey !== contributionGroup(row) || !object.sourceContributionId) return false;
  if (!await eligibleObject(ctx, object, row.venueId)) return false;
  const source = await ctx.db.get(object.sourceContributionId);
  if (!source || !await eligibleContribution(ctx, source)) return false;
  const accession = verifiedAccession(row);
  if (accession && object.provenance?.verifiedAccession && accession !== object.provenance.verifiedAccession) return false;
  const similarity = cosine(row.vector, source.vector);
  return similarity >= AGREEMENT_MIN_COSINE && similarity < REPLAY_COSINE;
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
  await assertContributionRights(ctx, row);
  let object = groupObjectId ? await ctx.db.get(groupObjectId) : null;
  if (object && !await compatibleEntry(ctx, row, object)) throw new ConvexError({ code: 'contributions_changed' });
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
  await ctx.db.patch(row._id, { indexedObjectId: object._id });
  await ctx.db.insert('vectors', { objectId: object._id, modelVersion: row.modelVersion, source: 'user',
    partition: recognitionPartition(row.modelVersion, row.venueId), contributionId: row._id, vector: row.vector });
  await bumpCounter(ctx, 'vectors', 1);
  const previous = object.sourceContributionId ? await ctx.db.get(object.sourceContributionId) : null;
  const source = previous && (previous.createdAt < row.createdAt ||
    (previous.createdAt === row.createdAt && previous._id < row._id)) ? previous : row;
  await applyReference(ctx, object, source, object.provenance?.verifiedAccession ?? verifiedAccession(row));
  await ctx.db.patch(object._id, { supportRevision: (object.supportRevision ?? 0) + 1 });
  return object._id;
}
