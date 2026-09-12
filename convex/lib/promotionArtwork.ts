import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { bumpCounter } from '../ingest';
import { verifiedAccession, workKey } from './agreement';
import { museumIdentityKeys } from './museumWorkIdentity';

async function identityKeys(candidate: Doc<'contributions'>): Promise<{ key: string; specific: boolean }[]> {
  return museumIdentityKeys({
    accession: verifiedAccession(candidate), pageUrl: candidate.sourceUrl, names: workKey(candidate.fields),
  });
}

export async function findOrCreateArtwork(
  ctx: MutationCtx,
  candidate: Doc<'contributions'>,
  partners: Doc<'contributions'>[],
  expectedArtworkId?: Id<'artworks'>,
): Promise<Id<'artworks'> | null> {
  const contributions = [candidate, ...partners];
  const allKeys = (await Promise.all(contributions.map(identityKeys))).flat();
  const keys = [...new Map(allKeys.map((identity) => [identity.key, identity])).values()];
  const identities = await Promise.all(keys.map(({ key }) => ctx.db.query('museumWorkIdentities')
    .withIndex('by_venue_identity', (q) => q.eq('venueId', candidate.venueId).eq('identity', key)).unique()));
  const existingIds = new Set(identities.flatMap((identity) => identity ? [identity.artworkId] : []));
  const wikidataIds = new Set(contributions.flatMap((row) => row.wikidataId ? [row.wikidataId] : []));
  if (wikidataIds.size > 1) return null;
  const wikidataId = [...wikidataIds][0];
  const verified = wikidataId ? await ctx.db.query('artworks')
    .withIndex('by_wikidataId', (q) => q.eq('wikidataId', wikidataId)).first() : null;
  if (verified) existingIds.add(verified._id);
  if (expectedArtworkId) existingIds.add(expectedArtworkId);
  for (const artworkId of existingIds) {
    const takedown = await ctx.db.query('takedowns').withIndex('by_artworkId', (q) => q.eq('artworkId', artworkId)).first();
    if (takedown) return null;
  }
  let artworkId = verified?._id ?? identities.find((identity, i) => identity && keys[i].specific)?.artworkId ??
    identities.find((identity) => identity)?.artworkId ?? expectedArtworkId;
  const existingArtwork = artworkId ? await ctx.db.get(artworkId) : null;
  if (wikidataId && existingArtwork?.wikidataId && existingArtwork.wikidataId !== wikidataId) artworkId = undefined;
  // Appended batches may add evidence, but cannot silently move an already published object.
  if (expectedArtworkId && artworkId !== expectedArtworkId) return null;
  if (!artworkId) {
    artworkId = await ctx.db.insert('artworks', {
      key: `user:${candidate._id}`, wikidataId,
      title: candidate.fields.title.value, artist: candidate.fields.artist.value, date: candidate.fields.date?.value,
      rightsStatus: 'unknown', multiplicity: 'unknown',
    });
    await bumpCounter(ctx, 'artworks', 1);
  } else if (wikidataId && !existingArtwork?.wikidataId) {
    await ctx.db.patch(artworkId, { wikidataId });
  }
  // These bindings outlive object/vector cleanup, including artwork takedowns.
  for (let i = 0; i < keys.length; i++) {
    if (!identities[i]) await ctx.db.insert('museumWorkIdentities', { venueId: candidate.venueId, identity: keys[i].key, artworkId });
  }
  return artworkId;
}
