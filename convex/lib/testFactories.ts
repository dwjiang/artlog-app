import model from '../../shared/model/model-version.json';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import type { Harness, SignedIn } from '../test.helpers';
import { encodeOrbFeatures, type OrbFeatures } from '../../shared/orb/features';
import { registerMuseumObject } from './museumWorkIdentity';
import { storeOrb } from './orbStorage';

type TestCtx = MutationCtx & Pick<ActionCtx, 'storage'>;

export function testVector(similarity = 1): number[] {
  const vector = Array<number>(model.embeddingDim).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

export async function seedDevice(t: Harness): Promise<SignedIn & { deviceId: Id<'devices'>; scope: string }> {
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
  return { ...user, deviceId, scope: `device:${deviceId}:0` };
}


export async function seedMuseum(
  ctx: MutationCtx,
  overrides: Partial<Omit<Doc<'museums'>, '_id' | '_creationTime'>> = {},
): Promise<Id<'museums'>> {
  return ctx.db.insert('museums', {
    key: crypto.randomUUID(), name: 'Test Museum', lat: 0, lng: 0,
    seedSource: 'manual', region: 'US', optOut: false,
    ...overrides,
  });
}

export async function seedArtworkWithObject(ctx: TestCtx, options: {
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
  await registerMuseumObject(ctx, { artworkId, ownerId: options.placement?.venueId, ...options.object });
  const vectorId = await ctx.db.insert('vectors', {
    objectId, modelVersion: options.modelVersion ?? model.modelVersion,
    source: 'corpus', vector: options.vector ?? testVector(),
  });
  if (options.descriptors) {
    const encoded = encodeOrbFeatures(options.descriptors);
    await ctx.db.insert('descriptors', {
      objectId, ...await storeOrb(ctx, encoded.descriptors, encoded.keypoints),
      inputSize: model.inputSize, extractedFrom: 'synthetic fixture',
    });
  }
  if (options.placement) await ctx.db.insert('placements', { objectId, ...options.placement });
  return { artworkId, objectId, vectorId };
}

export async function seedScan(
  ctx: MutationCtx,
  overrides: Partial<Omit<Doc<'scans'>, '_id' | '_creationTime'>> & { deviceId: Id<'devices'> },
): Promise<Id<'scans'>> {
  const now = Date.now();
  return ctx.db.insert('scans', {
    localId: crypto.randomUUID(), generation: 0, modelVersion: model.modelVersion, vector: testVector(),
    capturedAt: now, status: 'identified', outcome: 'miss', calibratorVersion: 'lr-v1', createdAt: now, updatedAt: now,
    ...overrides,
  });
}

export async function seedContribution(
  ctx: TestCtx,
  overrides: Partial<Omit<Doc<'contributions'>, '_id' | '_creationTime'>> & {
    deviceId: Id<'devices'>; venueId: Id<'museums'>; descriptors?: ArrayBuffer; keypoints?: ArrayBuffer;
  },
): Promise<Id<'contributions'>> {
  const { descriptors = new ArrayBuffer((overrides.keypointCount ?? 0) * 32),
    keypoints = new ArrayBuffer((overrides.keypointCount ?? 0) * 16), ...fields } = overrides;
  const orb = await storeOrb(ctx, descriptors, keypoints);
  return ctx.db.insert('contributions', {
    vector: testVector(), modelVersion: model.modelVersion, orbStorageId: orb.storageId, orbSha256: orb.sha256,
    keypointCount: 0, evidence: ['wikidata'], status: 'private', createdAt: Date.now(),
    fields: {
      title: { value: 'Water Lilies', edited: false, evidence: 'wikidata' },
      artist: { value: 'Claude Monet', edited: false, evidence: 'wikidata' },
    },
    ...fields,
  });
}

export async function seedJournalVisit(ctx: MutationCtx, deviceId: Id<'devices'>, venueId: Id<'museums'>, overrides: Partial<Omit<Doc<'visits'>, '_id' | '_creationTime'>> = {}) {
  return ctx.db.insert('visits', { owner: { kind: 'device', deviceId }, localId: crypto.randomUUID(),
    venueId, venueName: 'Test Museum', visitedOn: '2026-09-01', timeZone: 'UTC',
    updatedAt: 1, updatedBy: deviceId, changeVersion: 1, ...overrides });
}
