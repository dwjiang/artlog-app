import model from "../../shared/model/model-version.json";
import { encodeOrbFeatures, type OrbFeatures } from "../../shared/orb/features";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { insertEmbedding, requireEmbedding } from "../scanEmbeddings";
import type { Harness, SignedIn } from "../test.helpers";
import { patchArtworkContent, type ArtworkContentFields } from "./artworkContent";
import { fileStorage } from "./fileStorage";
import { registerMuseumObject } from "./museumWorkIdentity";
import { patchContributionState } from "./objectContributionState";
import { newObjectCounters } from "./objectCounters";
import { readObjectDetails, patchObjectDetails, type ObjectDetailsFields } from "./objectDetails";
import { storeOrb } from "./orbStorage";
import { evidenceDeviceIds, loadProposalEvidence } from "./proposalEvidence";
import { groupAnchor, publishContribution } from "./tentativeEntries";
import { insertVector, packVector, readVector, vectorHash } from "./vectorStore";
import { searchRecordId } from "./vectorSyncQueue";

type TestCtx = MutationCtx & Pick<ActionCtx, "storage">;

export function testVector(similarity = 1): number[] {
  const vector = Array<number>(model.embeddingDim).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

export async function seedVector(
  ctx: MutationCtx,
  input: Omit<Parameters<typeof insertVector>[1], "archiveId"> & { archiveId?: Id<"files"> },
) {
  const archiveId = input.archiveId ?? (await fileStorage.store(ctx, packVector(input.vector)));
  return insertVector(ctx, { ...input, archiveId });
}

export async function seedPublishedContribution(
  ctx: MutationCtx,
  row: Doc<"contributions">,
  groupObjectId?: Id<"objects">,
) {
  const object = groupObjectId ? await ctx.db.get("objects", groupObjectId) : null;
  const anchor = object ? await groupAnchor(ctx, row, object) : null;
  return publishContribution(
    ctx,
    row,
    object && anchor
      ? { objectId: object._id, anchorId: anchor._id, ...(await requireEmbedding(ctx, anchor.embeddingId)) }
      : undefined,
  );
}

export async function seedEmbedding(ctx: MutationCtx, { vector, expiresAt }: { vector: number[]; expiresAt?: number }) {
  const archiveId = await fileStorage.store(ctx, packVector(vector));
  return insertEmbedding(ctx, { archiveId, contentHash: await vectorHash(vector) }, expiresAt);
}

export async function readTestEmbedding(ctx: MutationCtx, id: Id<"scanEmbeddings"> | undefined) {
  return readVector(ctx, await requireEmbedding(ctx, id));
}

export async function seedDevice(t: Harness): Promise<SignedIn & { deviceId: Id<"devices">; scope: string }> {
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60 * 60 * 1000,
    }),
  );
  const user = {
    userId,
    as: t.withIdentity({ subject: `${userId}|${sessionId}` }),
  };
  const deviceId = await t.run((ctx) =>
    ctx.db.insert("devices", {
      authUserId: user.userId,
      firstSeenAt: Date.now(),
      trustWeight: 0.5,
      banned: false,
      platform: "simulator",
      attestCounter: 0,
      scopeRevision: 0,
    }),
  );
  return { ...user, deviceId, scope: `device:${deviceId}:0` };
}

export async function seedMuseum(
  ctx: MutationCtx,
  overrides: Partial<Omit<Doc<"museums">, "_id" | "_creationTime">> = {},
): Promise<Id<"museums">> {
  return ctx.db.insert("museums", {
    key: crypto.randomUUID(),
    name: "Test Museum",
    lat: 0,
    lng: 0,
    seedSource: "manual",
    region: "US",
    optOut: false,
    contributionRevision: 0,
    ...overrides,
  });
}

export async function seedArtworkWithObject(
  ctx: TestCtx,
  options: {
    vector?: number[];
    modelVersion?: string;
    descriptors?: OrbFeatures;
    placement?: Omit<Doc<"placements">, "_id" | "_creationTime" | "objectId" | "identityStatus">;
    artworkContent?: ArtworkContentFields;
    objectDetails?: ObjectDetailsFields;
    artwork?: Partial<Omit<Doc<"artworks">, "_id" | "_creationTime">>;
    object?: Partial<Omit<Doc<"objects">, "_id" | "_creationTime" | "artworkId">>;
  } = {},
) {
  const key = crypto.randomUUID();
  const artworkId = await ctx.db.insert("artworks", {
    identityStatus: "established" as const,
    key,
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1916",
    rightsStatus: "public_domain",
    multiplicity: "unique",
    enrichGeneration: 0,
    ...options.artwork,
  });
  const objectId = await ctx.db.insert("objects", {
    identityStatus: "established" as const,
    key,
    artworkId,
    ownerId: options.placement?.venueId,
    source: "corpus",
    sourceId: key,
    ...newObjectCounters,
    reverted: false,
    ...options.object,
  });
  if (options.object?.source === "user") await patchContributionState(ctx, objectId, {});
  if (options.artworkContent) await patchArtworkContent(ctx, { _id: artworkId }, options.artworkContent);
  await patchObjectDetails(
    ctx,
    { _id: objectId },
    {
      medium: "Oil on canvas",
      thumbnailUrl: "https://museum.example/work.jpg",
      ...options.objectDetails,
    },
  );
  await registerMuseumObject(ctx, {
    artworkId,
    ownerId: options.placement?.venueId,
    ...options.object,
    pageUrl: options.objectDetails?.pageUrl,
  });
  const vectorId = await seedVector(ctx, {
    partition: JSON.stringify([options.modelVersion ?? model.modelVersion, "established"]),
    objectId,
    modelVersion: options.modelVersion ?? model.modelVersion,
    source: "corpus",
    vector: options.vector ?? testVector(),
  });
  if (options.descriptors) {
    const encoded = encodeOrbFeatures(options.descriptors);
    await patchObjectDetails(
      ctx,
      { _id: objectId },
      {
        orb: {
          ...(await storeOrb(ctx, encoded.descriptors, encoded.keypoints)),
          inputSize: model.inputSize,
          extractedFrom: "synthetic fixture",
        },
      },
    );
  }
  if (options.placement) {
    await ctx.db.insert("placements", {
      identityStatus: options.object?.identityStatus ?? "established",
      objectId,
      ...options.placement,
    });
  }
  const row = (await ctx.db.get("vectors", vectorId))!;
  return { artworkId, objectId, vectorId, recordId: searchRecordId(row) };
}

export async function seedScan(
  ctx: MutationCtx,
  overrides: Partial<Omit<Doc<"scans">, "_id" | "_creationTime">> & {
    deviceId: Id<"devices">;
    vector?: number[];
  },
): Promise<Id<"scans">> {
  const now = Date.now();
  const { vector = testVector(), embeddingId, ...fields } = overrides;
  return ctx.db.insert("scans", {
    localId: crypto.randomUUID(),
    generation: 0,
    modelVersion: model.modelVersion,
    embeddingId: embeddingId ?? (await seedEmbedding(ctx, { vector })),
    capturedAt: now,
    status: "identified",
    outcome: "miss",
    calibratorVersion: "lr-v1",
    updatedAt: now,
    ...fields,
  });
}

export async function seedContribution(
  ctx: TestCtx,
  overrides: Partial<Omit<Doc<"contributions">, "_id" | "_creationTime">> & {
    deviceId: Id<"devices">;
    venueId: Id<"museums">;
    vector?: number[];
    descriptors?: ArrayBuffer;
    keypoints?: ArrayBuffer;
  },
): Promise<Id<"contributions">> {
  const {
    descriptors = new ArrayBuffer((overrides.keypointCount ?? 0) * 32),
    keypoints = new ArrayBuffer((overrides.keypointCount ?? 0) * 16),
    vector = testVector(),
    embeddingId,
    ...fields
  } = overrides;
  const orb = await storeOrb(ctx, descriptors, keypoints);
  return ctx.db.insert("contributions", {
    embeddingId: embeddingId ?? (await seedEmbedding(ctx, { vector })),
    modelVersion: model.modelVersion,
    orbStorageId: orb.storageId,
    orbSha256: orb.sha256,
    keypointCount: 0,
    evidence: ["wikidata"],
    status: "tentative",
    fields: {
      title: { value: "Water Lilies", edited: false, evidence: "wikidata" },
      artist: { value: "Claude Monet", edited: false, evidence: "wikidata" },
    },
    ...fields,
  });
}

export async function seedJournalVisit(
  ctx: MutationCtx,
  deviceId: Id<"devices">,
  venueId: Id<"museums">,
  overrides: Partial<Omit<Doc<"visits">, "_id" | "_creationTime">> = {},
) {
  return ctx.db.insert("visits", {
    owner: { kind: "device", deviceId },
    localId: crypto.randomUUID(),
    visibility: "public",
    venueId,
    venueName: "Test Museum",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
    updatedAt: 1,
    updatedBy: deviceId,
    changeVersion: 1,
    ...overrides,
  });
}

// A proposal with the scans and devices its evidence links currently name, in link order.
export async function proposalWithEvidence(ctx: MutationCtx, proposal: Doc<"placementProposals">) {
  const links = await loadProposalEvidence(ctx, proposal._id);
  return { ...proposal, scanIds: links.map((link) => link.scanId), deviceIds: evidenceDeviceIds(links) };
}

// Today's spend summed over its shards, or undefined when nothing was recorded.
export async function readSpend(t: Harness) {
  const rows = await t.run((ctx) => ctx.db.query("dailySpend").collect());
  if (rows.length === 0) return undefined;
  return rows.reduce(
    (sum, row) => ({
      tokenFactoryCalls: sum.tokenFactoryCalls + row.tokenFactoryCalls,
      tavilyCredits: sum.tavilyCredits + row.tavilyCredits,
    }),
    { tokenFactoryCalls: 0, tavilyCredits: 0 },
  );
}

export async function readTestOrb(ctx: MutationCtx, objectId: Id<"objects">) {
  const object = await ctx.db.get("objects", objectId);
  return object ? ((await readObjectDetails(ctx, object))?.orb ?? null) : null;
}
