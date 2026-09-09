import model from '../../shared/model-version.json';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { Harness, SignedIn } from '../test.helpers';
import { encodeOrbFeatures, type OrbFeatures } from './orb';

export function testVector(similarity = 1): number[] {
  const vector = Array<number>(model.embeddingDim).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

export async function seedDevice(t: Harness): Promise<SignedIn & { deviceId: Id<'devices'> }> {
  const userId = await t.run((ctx) => ctx.db.insert('users', { isAnonymous: true }));
  const sessionId = await t.run((ctx) => ctx.db.insert('authSessions', {
    userId, expirationTime: Date.now() + 60 * 60 * 1000,
  }));
  const user = { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
  const deviceId = await t.run((ctx) => ctx.db.insert('devices', {
    authUserId: user.userId,
    firstSeenAt: Date.now(),
    trustWeight: 0.5,
    banned: false,
    platform: 'simulator',
    attestCounter: 0,
  }));
  return { ...user, deviceId };
}

export const asDevice = seedDevice;

export async function seedMuseum(
  ctx: MutationCtx,
  overrides: Partial<Omit<Doc<'museums'>, '_id' | '_creationTime'>> = {},
): Promise<Id<'museums'>> {
  return ctx.db.insert('museums', {
    key: crypto.randomUUID(), name: 'Test Museum', lat: 0, lng: 0,
    seedSource: 'manual', region: 'US', optOut: false, useTavilyCrawl: false,
    queuePriority: 0,
    indexStatus: { status: 'complete', pagesMapped: 20, worksIndexed: 20, updatedAt: Date.now() },
    ...overrides,
  });
}

export async function seedArtworkWithObject(ctx: MutationCtx, options: {
  vector?: number[];
  modelVersion?: string;
  descriptors?: OrbFeatures;
  placement?: Omit<Doc<'placements'>, '_id' | '_creationTime' | 'objectId'>;
  artwork?: Partial<Omit<Doc<'artworks'>, '_id' | '_creationTime'>>;
  object?: Partial<Omit<Doc<'objects'>, '_id' | '_creationTime' | 'artworkId'>>;
} = {}) {
  const key = crypto.randomUUID();
  const artworkId = await ctx.db.insert('artworks', {
    key, title: 'Water Lilies', artist: 'Claude Monet', date: '1916',
    rightsStatus: 'public_domain', multiplicity: 'unique', ...options.artwork,
  });
  const objectId = await ctx.db.insert('objects', {
    key, artworkId, ownerId: options.placement?.venueId, medium: 'Oil on canvas',
    source: 'corpus', sourceId: key, thumbnailUrl: 'https://museum.example/work.jpg',
    confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false,
    ...options.object,
  });
  const vectorId = await ctx.db.insert('vectors', {
    objectId, modelVersion: options.modelVersion ?? model.modelVersion,
    source: 'corpus', vector: options.vector ?? testVector(),
  });
  if (options.descriptors) await ctx.db.insert('descriptors', {
    objectId, ...encodeOrbFeatures(options.descriptors), keypointCount: options.descriptors.count,
    inputSize: model.inputSize, extractedFrom: 'synthetic fixture',
  });
  if (options.placement) await ctx.db.insert('placements', { objectId, ...options.placement });
  return { artworkId, objectId, vectorId };
}
