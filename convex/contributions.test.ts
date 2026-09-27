import { getFunctionName, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { contribute as contributeAction, DUPLICATE_COSINE } from "./contributions";
import { AGREEMENT_MIN_COSINE } from "./lib/agreement";
import { fileStorage } from "./lib/fileStorage";
import { labelField } from "./lib/labelVerify";
import { readObjectDetails } from "./lib/objectDetails";
import { loadOrb, storeOrb } from "./lib/orbStorage";
import { r2 } from "./lib/r2";
import {
  readTestOrb,
  readTestEmbedding,
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedPublishedContribution,
  seedScan,
  testVector,
} from "./lib/testFactories";
import type { LabelFlow } from "./lib/validators";
import * as vectorSearch from "./lib/vectorSearch";
import { packVector, VECTOR_CONTENT_TYPE } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { harness, signIn, type Harness } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// Wrap the actual handler to observe expensive work while retaining convex-test's auth and transactions.
const runContribute = (
  contributeAction as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: FunctionArgs<typeof api.contributions.contribute>,
    ) => Promise<FunctionReturnType<typeof api.contributions.contribute>>;
  }
)._handler;

const pair = makeSyntheticPair({ count: 120 });
const features = encodeOrbFeatures(pair.query);
const fields = {
  title: { value: "Water Lilies", edited: false },
  artist: { value: "Claude Monet", edited: false },
  date: { value: "1916", edited: false },
};

function verifiedFlow(overrides: Partial<LabelFlow> = {}): LabelFlow {
  return {
    stage: "verified",
    fields: {
      title: labelField("Water Lilies", "wikidata"),
      artist: labelField("Claude Monet", "wikidata"),
      date: labelField("1916", "ocr"),
    },
    evidence: ["wikidata"],
    warnings: [],
    moderation: "clear",
    wikidataId: "Q3374376",
    rawOcr: {
      title: "Water Lilies",
      artist: null,
      artist_dates: null,
      work_date: null,
      medium: null,
      accession: null,
      credit_line: null,
      confidence: { title: 1, artist: 0, work_date: 0, medium: 0, accession: 0 },
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function storeCrop(
  t: Harness,
  { size = 1000, type = "image/jpeg", ownerId = undefined as Id<"devices"> | undefined } = {},
): Promise<Id<"files">> {
  return t.run(async (ctx) => {
    const id = await fileStorage.store(ctx, new Blob([new Uint8Array(size)], { type }));
    const owner = await ctx.db.query("devices").order("desc").first();
    await ctx.db.patch("files", (await fileStorage.getMetadata(ctx, id))!._id, { uploadOwner: ownerId ?? owner!._id });
    return id;
  });
}

async function fixture(flow: LabelFlow | null = verifiedFlow(), withVenue = true, t = harness()) {
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      venueId: withVenue ? venueId : undefined,
      labelFlow: flow ?? undefined,
    }),
  );
  const cropStorageId = await storeCrop(t);
  const sign = async (as = user.as) => ({
    nonce: (await as.mutation(api.devices.createChallenge, { purpose: "assert" })).nonce,
    assertionBase64: "AAAA",
  });
  const args = { scanId, ...features, fields, cropStorageId };
  const contribute = async (overrides: Partial<typeof args> = {}) =>
    user.as.action(api.contributions.contribute, {
      ...args,
      ...overrides,
      ...(await sign()),
    });
  const rows = () => t.run((ctx) => ctx.db.query("contributions").collect());
  return {
    t,
    user,
    venueId,
    scanId,
    cropStorageId,
    args,
    sign,
    contribute,
    rows,
  };
}

describe("contribute", () => {
  it("reuses the scan archive for contribution evidence and shared search without another embedding upload", async () => {
    const { t, contribute, scanId } = await fixture();
    const evidence = await t.run(async (ctx) =>
      ctx.db.get("scanEmbeddings", (await ctx.db.get("scans", scanId))!.embeddingId!),
    );
    const put = vi.mocked(r2.put).getMockImplementation()!;
    await vi.mocked(r2.put).withImplementation(
      async (key, blob) => {
        if (blob.type === "application/vnd.artlog.embedding") throw new Error("Unexpected embedding upload");
        return put(key, blob);
      },
      async () => {
        await contribute();
      },
    );
    const vector = await t.run((ctx) => ctx.db.query("vectors").unique());
    const row = await t.run((ctx) => ctx.db.query("contributions").unique());
    expect(vector?.archiveId).toBe(evidence!.archiveId);
    expect(await t.run((ctx) => ctx.db.get("scanEmbeddings", row!.embeddingId))).toMatchObject({
      archiveId: evidence!.archiveId,
    });
    expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").unique())).not.toHaveProperty("pendingVector");
  });

  it("leaves no contribution or searchable vector when its R2 evidence cannot be read", async () => {
    const { t, contribute } = await fixture();
    await vi.mocked(r2.get).withImplementation(
      async () => {
        throw new Error("R2 unavailable");
      },
      async () => {
        await expect(contribute()).rejects.toThrow("R2 unavailable");
      },
    );
    expect(await t.run((ctx) => ctx.db.query("contributions").first())).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vectors").first())).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").first())).toBeNull();
  });

  it.each(["challenge_invalid", "device_not_attested", "rate_limited", "label_unverified"] as const)(
    "does no duplicate search when authorization fails with %s",
    async (code) => {
      vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
      const { t, user, scanId, args, sign } = await fixture();
      const signed = await sign();
      if (code === "challenge_invalid") signed.nonce = "not-a-challenge";
      if (code === "device_not_attested") {
        vi.stubEnv("APP_ATTEST_REQUIRED", "true");
      }
      if (code === "label_unverified") {
        await t.run((ctx) => ctx.db.patch("scans", scanId, { labelFlow: undefined }));
      }
      if (code === "rate_limited") {
        for (let i = 0; i < 20; i++) {
          await user.as.mutation(api.contributions.requestCropUpload, { size: 1000 });
        }
      }
      const work: string[] = [];
      await expect(
        user.as.action(async (ctx) => {
          const search = vi.spyOn(vectorSearch, "searchVectorIndex");
          const queries = vi.spyOn(ctx, "runQuery");
          try {
            return await runContribute(ctx, { ...args, ...signed });
          } finally {
            work.push(...queries.mock.calls.map(([fn]) => getFunctionName(fn)));
            if (search.mock.calls.length > 0) work.push("vectorSearch");
          }
        }),
      ).rejects.toMatchObject({ data: { code } });
      expect(work).not.toContain("vectorSearch");
      expect(work).not.toContain("contributions:checkDuplicatePage");
    },
  );

  it("charges failed searches before they run and refuses them after the budget is spent", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const { user, args, sign } = await fixture();
    let searches = 0;
    const contributeWithFailingSearch = async () => {
      const signed = await sign();
      return user.as.action(async (ctx) => {
        vi.spyOn(vectorSearch, "searchVectorIndex").mockImplementation(async () => {
          searches++;
          throw new Error("search unavailable");
        });
        return runContribute(ctx, { ...args, ...signed });
      });
    };
    for (let i = 0; i < 20; i++) {
      await expect(contributeWithFailingSearch()).rejects.toThrow("search unavailable");
    }
    await expect(contributeWithFailingSearch()).rejects.toMatchObject({
      data: { code: "rate_limited" },
    });
    expect(searches).toBe(20);
  });

  it("publishes a tentative contribution with the scan vector, the verified evidence and the consented crop", async () => {
    const { t, user, venueId, scanId, cropStorageId, contribute, rows } = await fixture();
    const result = await contribute();
    expect(result).toEqual({
      contributionId: expect.any(String),
      status: "tentative",
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      _id: result.contributionId,
      deviceId: user.deviceId,
      venueId,
      scanId,
      keypointCount: pair.query.count,
      cropStorageId,
      status: "tentative",
      wikidataId: "Q3374376",
      rawOcr: {
        title: "Water Lilies",
        artist: null,
        artist_dates: null,
        work_date: null,
        medium: null,
        accession: null,
        credit_line: null,
        confidence: { title: 1, artist: 0, work_date: 0, medium: 0, accession: 0 },
      },
      evidence: ["wikidata", "ocr"],
      fields: {
        title: { value: "Water Lilies", edited: false, evidence: "wikidata" },
        artist: { value: "Claude Monet", edited: false, evidence: "wikidata" },
        date: { value: "1916", edited: false, evidence: "ocr" },
      },
    });
    expect(row).not.toHaveProperty("vector");
    expect(await t.run((ctx) => readTestEmbedding(ctx, row.embeddingId))).toEqual(testVector());
    expect(row).not.toHaveProperty("descriptors");
    expect(row).not.toHaveProperty("keypoints");
    expect(await t.run((ctx) => loadOrb(ctx, row.orbStorageId!, row.keypointCount))).toEqual(features);
    expect(row.rejectedReason).toBeUndefined();
  });

  it("keeps the verified museum page identity after the scan label flow changes", async () => {
    const sourceUrl = "https://museum.example/works/water-lilies";
    const { t, scanId, contribute, rows } = await fixture(verifiedFlow({ sourceUrl, wikidataId: undefined }));
    await contribute();
    await t.run((ctx) =>
      ctx.db.patch("scans", scanId, {
        labelFlow: verifiedFlow({
          sourceUrl: "https://museum.example/works/haystacks",
        }),
      }),
    );
    expect((await rows())[0].sourceUrl).toBe(sourceUrl);
  });

  it.each([
    {
      name: "date",
      edited: { date: { value: "1916", edited: true } },
      wikidataId: "Q3374376",
    },
    {
      name: "title",
      edited: { title: { value: "Water Lilies", edited: true } },
      wikidataId: undefined,
    },
    {
      name: "artist",
      edited: { artist: { value: "Claude Monet", edited: true } },
      wikidataId: undefined,
    },
  ])(
    "marks an edited $name user_edited and keeps the Wikidata binding only while the pair is untouched",
    async ({ name, edited, wikidataId }) => {
      const { contribute, rows } = await fixture();
      await contribute({ fields: { ...fields, ...edited } });
      const [row] = await rows();
      expect(row.fields[name as keyof typeof fields]).toMatchObject({
        edited: true,
        evidence: "user_edited",
      });
      expect(row.wikidataId).toBe(wikidataId);
      expect(row.evidence).toContain("user_edited");
    },
  );

  it.each([
    ["a value that differs from the verified one", { title: { value: "Water Lily Pond", edited: false } }],
    ["an edited value the label flow never verified", { title: { value: "Water Lily Pond", edited: true } }],
    ["a field the label flow does not hold", { medium: { value: "Oil on canvas", edited: false } }],
  ])("rejects %s", async (_name, override) => {
    const { contribute, rows } = await fixture();
    await expect(contribute({ fields: { ...fields, ...override } })).rejects.toMatchObject({
      data: { code: "field_mismatch" },
    });
    expect(await rows()).toEqual([]);
  });

  it.each([
    ["a label that was only read", verifiedFlow({ stage: "read" })],
    ["a moderated label", verifiedFlow({ moderation: "flagged", fields: {} })],
    ["no label flow", null],
  ])("refuses %s", async (_name, flow) => {
    const { contribute, rows } = await fixture(flow);
    await expect(contribute()).rejects.toMatchObject({
      data: { code: "label_unverified" },
    });
    expect(await rows()).toEqual([]);
  });

  it("requires the device’s own venue-resolved scan", async () => {
    const unresolved = await fixture(verifiedFlow(), false);
    await expect(unresolved.contribute()).rejects.toMatchObject({
      data: { code: "invalid_scan" },
    });
    const { t, args, sign, rows } = await fixture();
    const stranger = await seedDevice(t);
    await expect(
      stranger.as.action(api.contributions.contribute, {
        ...args,
        ...(await sign(stranger.as)),
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_scan" } });
    expect(await unresolved.rows()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("rejects a vector that near-duplicates an indexed work and discards its crop", async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    const original = await t.run((ctx) => seedArtworkWithObject(ctx, { vector: testVector() }));
    const result = await contribute();
    expect(result).toMatchObject({ status: "rejected", reason: "duplicate" });
    const [row] = await rows();
    expect(row).toMatchObject({
      _id: result.contributionId,
      status: "rejected",
      rejectedReason: "duplicate",
    });
    expect(row.cropStorageId).toBeUndefined();
    expect(row.orbStorageId).toBeUndefined();
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, cropStorageId))).toBeNull();
    const archives = await t.run((ctx) =>
      ctx.db
        .query("files")
        .collect()
        .then((files) => files.filter((file) => file.state === "ready")),
    );
    const evidence = await t.run((ctx) => ctx.db.get("scanEmbeddings", row.embeddingId));
    expect(archives.map((file) => file._id).sort()).toEqual(
      [evidence!.archiveId, (await t.run((ctx) => ctx.db.get("vectors", original.vectorId)))!.archiveId].sort(),
    );
    expect(
      archives.every(
        (file) => file.contentType === VECTOR_CONTENT_TYPE && !file.publicDownload && file.expiresAt === undefined,
      ),
    ).toBe(true);
  });

  it("ignores indexed vectors below the duplicate threshold or from another model version", async () => {
    const { t, contribute } = await fixture();
    await t.run(async (ctx) => {
      await seedArtworkWithObject(ctx, { vector: testVector(DUPLICATE_COSINE - 0.01) });
      await seedArtworkWithObject(ctx, {
        vector: testVector(),
        modelVersion: "other-model",
      });
    });
    expect(await contribute()).toMatchObject({ status: "tentative" });
  });

  it("returns the accepted contribution on retry and keeps its crop", async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    const accepted = await contribute();
    expect(await contribute()).toEqual(accepted);
    expect(await rows()).toHaveLength(1);
    expect(await t.run((ctx) => fileStorage.getUrl(ctx, cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get("contributions", accepted.contributionId))).toMatchObject({
      cropStorageId,
    });
  });

  it("discards only the unused replacement upload on retry", async () => {
    const { t, cropStorageId, contribute } = await fixture();
    const accepted = await contribute();
    const replacement = await storeCrop(t);
    expect(await contribute({ cropStorageId: replacement })).toEqual(accepted);
    expect(await t.run((ctx) => fileStorage.getUrl(ctx, cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => fileStorage.getUrl(ctx, replacement))).toBeNull();
  });

  it("does not let a retry delete storage files that are not contribution crops", async () => {
    const { t, contribute } = await fixture();
    const accepted = await contribute();
    const unrelated = await storeCrop(t, { type: "application/vnd.sqlite3" });
    expect(await contribute({ cropStorageId: unrelated })).toEqual(accepted);
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, unrelated))).not.toBeNull();
  });

  it.each(["tentative", "rejected"] as const)(
    "returns the existing %s status when a contribution has advanced before retry",
    async (status) => {
      const { t, contribute } = await fixture();
      const accepted = await contribute();
      await t.run((ctx) => ctx.db.patch("contributions", accepted.contributionId, { status }));
      expect(await contribute()).toEqual({ ...accepted, status });
    },
  );

  it("retries a rejected submission even after its crop was discarded", async () => {
    const { t, contribute, rows } = await fixture();
    await t.run((ctx) => seedArtworkWithObject(ctx));
    const rejected = await contribute();
    expect(rejected.status).toBe("rejected");
    expect(await contribute()).toEqual(rejected);
    expect(await rows()).toHaveLength(1);
  });

  it("does not delete an accepted crop reused by another scan", async () => {
    const { t, user, venueId, cropStorageId, contribute } = await fixture();
    const accepted = await contribute();
    const scanId = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        labelFlow: verifiedFlow(),
      }),
    );
    expect(await contribute({ scanId })).toMatchObject({
      status: "rejected",
      reason: "duplicate",
    });
    expect(await t.run((ctx) => fileStorage.getUrl(ctx, cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get("contributions", accepted.contributionId))).toMatchObject({
      cropStorageId,
    });
  });

  it.each(["same", "different"] as const)(
    "accepts new works after a large contribution history at the %s venue",
    async (scope) => {
      const t = harness({ transactionLimits: true });
      const { user, venueId, contribute } = await fixture(verifiedFlow(), true, t);
      const historyVenue = scope === "same" ? venueId : await t.run((ctx) => seedMuseum(ctx));
      // Distinct, mutually dissimilar history: one-hot off axis 0 (the fresh scan's), then two-hot
      // once the axes run out.
      const vectorAt = (index: number) => {
        const vector = Array<number>(model.embeddingDim).fill(0);
        const axes = model.embeddingDim - 1;
        vector[1 + (index % axes)] = 1;
        if (index >= axes) vector[1 + ((index + 1) % axes)] = 1;
        return vector;
      };
      for (let batch = 0; batch < 12; batch++) {
        await t.run(async (ctx) => {
          for (let index = 1; index <= 50; index++) {
            await seedContribution(ctx, {
              deviceId: user.deviceId,
              venueId: historyVenue,
              vector: vectorAt(batch * 50 + index),
              modelVersion: model.modelVersion,
              descriptors: new ArrayBuffer(16_000),
              keypoints: new ArrayBuffer(8_000),
              keypointCount: 500,
              fields: {
                title: { ...fields.title, evidence: "wikidata" },
                artist: { ...fields.artist, evidence: "wikidata" },
              },
              evidence: ["wikidata"],
              status: "tentative",
              createdAt: Date.now(),
            });
          }
        });
      }
      expect(await contribute()).toMatchObject({ status: "tentative" });
      const scanId = await t.run((ctx) =>
        seedScan(ctx, {
          deviceId: user.deviceId,
          venueId,
          vector: vectorAt(600),
          labelFlow: verifiedFlow(),
        }),
      );
      expect(await contribute({ scanId, cropStorageId: await storeCrop(t) })).toMatchObject({
        status: scope === "same" ? "rejected" : "tentative",
      });
    },
    30_000,
  );

  it("accepts only one of two concurrent duplicate scans", async () => {
    const { t, user, venueId, args, sign, rows } = await fixture();
    const scanId = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        labelFlow: verifiedFlow(),
      }),
    );
    const cropStorageId = await storeCrop(t);
    const contribute = async (overrides: Partial<typeof args>) => {
      const signed = await sign();
      return user.as.action((ctx) => runContribute(ctx, { ...args, ...overrides, ...signed }));
    };
    const results = await Promise.all([contribute({}), contribute({ scanId, cropStorageId })]);
    expect(results.map((result) => result.status).sort()).toEqual(["rejected", "tentative"]);
    expect((await rows()).filter((row) => row.status === "tentative")).toHaveLength(1);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("files")
          .collect()
          .then((files) => files.filter((file) => file.state === "ready")),
      ),
    ).toHaveLength(4);
  });

  it("refuses a stale duplicate check and retries the commit without another authorization", async () => {
    const { t, user, venueId, args, sign, contribute, rows } = await fixture();
    const scanId = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        labelFlow: verifiedFlow(),
      }),
    );
    const cropStorageId = await storeCrop(t);
    const signed = await sign();
    await user.as.mutation(internal.contributions.authorize, {
      scanId,
      cropStorageId,
      fields,
      ...signed,
    });
    const first = await contribute();
    const { descriptors, keypoints, ...submission } = args;
    const orb = await t.run((ctx) => storeOrb(ctx, descriptors, keypoints));
    const rest = {
      ...submission,
      archiveId: await t.run(
        async (ctx) =>
          (await ctx.db.get("scanEmbeddings", (await ctx.db.get("scans", scanId))!.embeddingId!))!.archiveId,
      ),
      orbStorageId: orb.storageId,
      orbSha256: orb.sha256,
    };
    await expect(
      user.as.mutation(internal.contributions.commit, {
        ...rest,
        scanId,
        cropStorageId,
        generation: 0,
        venueRevision: 1,
        keypointCount: pair.query.count,
        duplicate: false,
        previousContributionId: null,
      }),
    ).rejects.toMatchObject({ data: { code: "contributions_changed" } });
    expect(await rows()).toHaveLength(1);
    expect(
      await user.as.mutation(internal.contributions.commit, {
        ...rest,
        scanId,
        cropStorageId,
        generation: 0,
        venueRevision: 1,
        keypointCount: pair.query.count,
        duplicate: true,
        previousContributionId: first.contributionId,
      }),
    ).toMatchObject({ status: "rejected", reason: "duplicate" });
    await expect(
      user.as.action(api.contributions.contribute, {
        ...args,
        ...signed,
        scanId,
        cropStorageId,
      }),
    ).rejects.toMatchObject({ data: { code: "challenge_invalid" } });
  });

  it("rejects a repeat of the device’s own contribution at the venue, not a different work or another device", async () => {
    const { t, user, venueId, contribute, rows } = await fixture();
    expect(await contribute()).toMatchObject({ status: "tentative" });
    const repeat = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        labelFlow: verifiedFlow(),
      }),
    );
    expect(await contribute({ scanId: repeat, cropStorageId: await storeCrop(t) })).toMatchObject({
      status: "rejected",
      reason: "duplicate",
    });
    const different = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        vector: testVector(AGREEMENT_MIN_COSINE - 0.05),
        labelFlow: verifiedFlow(),
      }),
    );
    expect(
      await contribute({
        scanId: different,
        cropStorageId: await storeCrop(t),
      }),
    ).toMatchObject({ status: "tentative" });
    const other = await seedDevice(t);
    const otherScan = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: other.deviceId,
        venueId,
        vector: testVector(0.95),
        labelFlow: verifiedFlow(),
      }),
    );
    const { nonce } = await other.as.mutation(api.devices.createChallenge, {
      purpose: "assert",
    });
    expect(
      await other.as.action(api.contributions.contribute, {
        scanId: otherScan,
        ...features,
        fields,
        cropStorageId: await storeCrop(t),
        nonce,
        assertionBase64: "AAAA",
      }),
    ).toMatchObject({ status: "tentative" });
    expect((await rows()).map((row) => row.status)).toEqual(["tentative", "rejected", "tentative", "tentative"]);
  });

  it.each([
    ["a non-JPEG file", { type: "image/png" }],
    ["an oversized file", { size: 200 * 1024 + 1 }],
  ])("rejects %s as the crop", async (_name, crop) => {
    const { t, contribute, rows } = await fixture();
    await expect(contribute({ cropStorageId: await storeCrop(t, crop) })).rejects.toMatchObject({
      data: { code: "bad_crop" },
    });
    expect(await rows()).toEqual([]);
  });

  it("rejects a crop that is no longer in storage", async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    await t.run((ctx) => fileStorage.delete(ctx, cropStorageId));
    await expect(contribute()).rejects.toMatchObject({
      data: { code: "bad_crop" },
    });
    expect(await rows()).toEqual([]);
  });

  it("rejects malformed features before spending the challenge, and never accepts a spent one", async () => {
    const { user, args, sign } = await fixture();
    const signed = await sign();
    await expect(
      user.as.action(api.contributions.contribute, {
        ...args,
        ...signed,
        descriptors: new ArrayBuffer(1),
      }),
    ).rejects.toMatchObject({ data: { code: "bad_features" } });
    expect(
      await user.as.action(api.contributions.contribute, {
        ...args,
        ...signed,
      }),
    ).toMatchObject({ status: "tentative" });
    await expect(user.as.action(api.contributions.contribute, { ...args, ...signed })).rejects.toMatchObject({
      data: { code: "challenge_invalid" },
    });
  });

  it("ignores a contribution whose scan was restarted meanwhile", async () => {
    const { t, user, args, sign, rows } = await fixture();
    await user.as.mutation(internal.contributions.authorize, {
      scanId: args.scanId,
      cropStorageId: args.cropStorageId,
      fields,
      ...(await sign()),
    });
    const { descriptors, keypoints, ...submission } = args;
    const orb = await t.run((ctx) => storeOrb(ctx, descriptors, keypoints));
    const rest = {
      ...submission,
      archiveId: await t.run((ctx) => fileStorage.store(ctx, packVector(testVector()))),
      orbStorageId: orb.storageId,
      orbSha256: orb.sha256,
    };
    await expect(
      user.as.mutation(internal.contributions.commit, {
        ...rest,
        generation: 1,
        venueRevision: 0,
        keypointCount: pair.query.count,
        duplicate: false,
        previousContributionId: null,
      }),
    ).rejects.toMatchObject({ data: { code: "scan_restarted" } });
    expect(await rows()).toEqual([]);
  });

  it("requires an attested device when attestation is enforced", async () => {
    vi.stubEnv("APP_ATTEST_REQUIRED", "true");
    const t = harness();
    const user = await signIn(t);
    const { deviceId } = await user.as.mutation(api.devices.registerDevice, {
      platform: "ios",
    });
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId, venueId, labelFlow: verifiedFlow() }));
    const { nonce } = await user.as.mutation(api.devices.createChallenge, {
      purpose: "assert",
    });
    await expect(
      user.as.action(api.contributions.contribute, {
        scanId,
        ...features,
        fields,
        cropStorageId: await storeCrop(t),
        nonce,
        assertionBase64: "AAAA",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_attested" } });
    expect(await t.run((ctx) => ctx.db.query("contributions").collect())).toEqual([]);
  });

  it("shares one hourly budget between crop uploads and contributions", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const { user, contribute } = await fixture();
    for (let i = 0; i < 20; i++) {
      expect((await user.as.mutation(api.contributions.requestCropUpload, { size: 1000 })).uploadUrl).toMatch(
        /^https:/,
      );
    }
    await expect(contribute()).rejects.toMatchObject({
      data: { code: "rate_limited", name: "contribute" },
    });
  });

  it("requires a registered device throughout", async () => {
    const { t, args } = await fixture();
    await expect(t.mutation(api.contributions.requestCropUpload, { size: 1000 })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    const unregistered = await signIn(t);
    await expect(
      unregistered.as.action(api.contributions.contribute, {
        ...args,
        nonce: "n",
        assertionBase64: "a",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_registered" } });
  });
});

async function shareAs(
  t: Harness,
  venueId: Id<"museums">,
  options: {
    user?: Awaited<ReturnType<typeof seedDevice>>;
    vector?: number[];
    flow?: LabelFlow;
    modelVersion?: string;
  } = {},
) {
  const user = options.user ?? (await seedDevice(t));
  const flow = options.flow ?? verifiedFlow();
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      venueId,
      vector: options.vector ?? testVector(0.95),
      modelVersion: options.modelVersion ?? model.modelVersion,
      labelFlow: flow,
    }),
  );
  const cropStorageId = await storeCrop(t, { ownerId: user.deviceId });
  const { nonce } = await user.as.mutation(api.devices.createChallenge, {
    purpose: "assert",
  });
  const submitted = Object.fromEntries(
    Object.entries(flow.fields).map(([name, field]) => [name, { value: field!.value, edited: false }]),
  ) as typeof fields;
  const result = await user.as.action(api.contributions.contribute, {
    scanId,
    ...features,
    fields: submitted,
    cropStorageId,
    nonce,
    assertionBase64: "AAAA",
  });
  const row = (await t.run((ctx) => ctx.db.get("contributions", result.contributionId)))!;
  return { ...result, row, user, scanId, cropStorageId };
}

describe("immediate tentative recognition", () => {
  it("finds early and late matches among 64 same-label works within transaction limits", async () => {
    const t = harness({ transactionLimits: true });
    const contributor = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const objectIds = [];
    for (let index = 0; index < 64; index++) {
      const cropStorageId = await storeCrop(t, { ownerId: contributor.deviceId });
      objectIds.push(
        await t.run(async (ctx) => {
          const vector = Array<number>(model.embeddingDim).fill(0);
          vector[index] = 1;
          const id = await seedContribution(ctx, {
            deviceId: contributor.deviceId,
            venueId,
            vector,
            cropStorageId,
          });
          return seedPublishedContribution(ctx, (await ctx.db.get("contributions", id))!);
        }),
      );
    }
    vi.mocked(vectorSearch.searchVectorIndex).mockResolvedValue([]);
    for (const index of [0, 63]) {
      const vector = Array<number>(model.embeddingDim).fill(0);
      vector[index] = 0.92;
      vector[128] = Math.sqrt(1 - 0.92 ** 2);
      const shared = await shareAs(t, venueId, { vector });
      expect(shared.status).toBe("tentative");
      expect(shared.row.indexedObjectId).toBe(objectIds[index]);
    }
    expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(64);
  });

  it("rechecks a grouping anchor that was banned during an R2 comparison", async () => {
    const { t, venueId, contribute, user } = await fixture();
    const first = await contribute();
    const row = (await t.run((ctx) => ctx.db.get("contributions", first.contributionId)))!;
    const archive = (await t.run((ctx) => ctx.db.get("scanEmbeddings", row.embeddingId)))!;
    const get = vi.mocked(r2.get).getMockImplementation()!;
    let banned = false;
    vi.mocked(vectorSearch.searchVectorIndex).mockResolvedValue([]);
    await vi.mocked(r2.get).withImplementation(
      async (id) => {
        if (id === archive.archiveId && !banned) {
          banned = true;
          await t.run((ctx) => ctx.db.patch("devices", user.deviceId, { banned: true }));
        }
        return get(id);
      },
      async () => {
        const second = await shareAs(t, venueId, { vector: testVector(0.92) });
        expect(second.status).toBe("tentative");
        expect(second.row.indexedObjectId).not.toBe(row.indexedObjectId);
      },
    );
    expect(banned).toBe(true);
  });

  it.each(["ocr", "qr", "tavily+image"] as const)(
    "publishes %s evidence immediately without certifying it or changing trust",
    async (evidence) => {
      const { t, venueId, user } = await fixture();
      const shared = await shareAs(t, venueId, {
        user,
        flow: verifiedFlow({
          fields: {
            title: labelField("Water Lilies", evidence),
            artist: labelField("Claude Monet", evidence),
          },
          evidence: [evidence],
        }),
      });
      expect(shared.status).toBe("tentative");
      const object = (await t.run((ctx) => ctx.db.get("objects", shared.row.indexedObjectId!)))!;
      expect(object).toMatchObject({
        identityStatus: "tentative",
        source: "user",
        sourceContributionId: shared.contributionId,
      });
      expect(await t.run((ctx) => ctx.db.get("devices", user.deviceId))).toMatchObject({
        trustWeight: 0.5,
      });
      const visitor = await seedDevice(t);
      const identify = async (museum?: Id<"museums">) =>
        visitor.as.action(api.identify.identify, {
          scope: visitor.scope,
          localId: crypto.randomUUID(),
          venueId: museum,
          capturedAt: Date.now(),
          vector: await t.run((ctx) => readTestEmbedding(ctx, shared.row.embeddingId)),
          ...features,
          modelVersion: model.modelVersion,
        });
      expect(await identify(venueId)).toMatchObject({
        outcome: "soft",
        best: { objectId: object._id, identityStatus: "tentative" },
      });
      expect((await identify()).best).toBeUndefined();
      const elsewhere = await t.run((ctx) => seedMuseum(ctx));
      expect((await identify(elsewhere)).best).toBeUndefined();
      expect(
        await t.mutation(internal.docent.claim, {
          artworkId: object.artworkId,
        }),
      ).toBeNull();
      expect(await t.query(internal.docent.load, { artworkId: object.artworkId })).toBeNull();
      expect(
        (
          await t.action(internal.ingest.exportVectors, {
            modelVersion: model.modelVersion,
          })
        ).page,
      ).toEqual([]);
      expect((await t.query(internal.ingest.exportDescriptorReferences, {})).page).toEqual([]);
      expect((await t.query(internal.enrich.previewBatch, { limit: 100 })).artworks).toEqual([]);
    },
  );

  it("attaches independent compatible views, retains the oldest complete reference, and permits only one active backer per device", async () => {
    const { t, contribute, user, venueId } = await fixture();
    const first = await contribute();
    const own = (await t.run((ctx) => ctx.db.get("contributions", first.contributionId)))!;
    const second = await shareAs(t, venueId, {
      flow: verifiedFlow({
        fields: {
          title: labelField("Water Lilies", "ocr"),
          artist: labelField("Claude Monet", "ocr"),
          date: labelField("1917", "ocr"),
        },
      }),
    });
    expect(second.row.indexedObjectId).toBe(own.indexedObjectId);
    const object = (await t.run((ctx) => ctx.db.get("objects", own.indexedObjectId!)))!;
    expect(object.sourceContributionId).toBe(first.contributionId);
    expect(await t.run((ctx) => ctx.db.get("artworks", object.artworkId))).toMatchObject({
      date: "1916",
      identityStatus: "tentative",
    });
    const duplicate = await shareAs(t, venueId, {
      user,
      vector: testVector(0.91),
    });
    expect(duplicate).toMatchObject({
      status: "rejected",
      reason: "duplicate",
    });
    // Another device replaying the second backer’s photo is the same view, not a third one.
    const replay = await shareAs(t, venueId, {
      vector: await t.run((ctx) => readTestEmbedding(ctx, second.row.embeddingId)),
    });
    expect(replay).toMatchObject({ status: "rejected", reason: "duplicate" });
    expect(await t.run((ctx) => fileStorage.get(ctx, replay.cropStorageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vectors").collect())).toHaveLength(2);
  });

  it("keeps conflicting verified accessions, names, and model versions separate and rejects a replayed view", async () => {
    const { t, venueId } = await fixture();
    const accessionFlow = (accession: string) =>
      verifiedFlow({
        fields: {
          title: labelField("Water Lilies", "qr"),
          artist: labelField("Claude Monet", "qr"),
          accession: labelField(accession, "qr"),
        },
      });
    const first = await shareAs(t, venueId, {
      vector: testVector(),
      flow: accessionFlow("123"),
    });
    const conflict = await shareAs(t, venueId, { flow: accessionFlow("456") });
    const renamed = await shareAs(t, venueId, {
      flow: verifiedFlow({
        fields: {
          title: labelField("Haystacks", "ocr"),
          artist: labelField("Claude Monet", "ocr"),
        },
      }),
    });
    const otherModel = await shareAs(t, venueId, {
      modelVersion: "other-model",
      flow: accessionFlow("123"),
    });
    expect(new Set([first, conflict, renamed, otherModel].map((result) => result.row.indexedObjectId)).size).toBe(4);
    const replay = await shareAs(t, venueId, {
      vector: testVector(),
      flow: accessionFlow("123"),
    });
    expect(replay).toMatchObject({ status: "rejected", reason: "duplicate" });
    expect(replay.row.indexedObjectId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(4);
  });

  it("preserves canonical artwork metadata and mappings when a visitor claims its Wikidata identity", async () => {
    const { t, venueId } = await fixture();
    const corpus = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        vector: testVector(0),
        artwork: { wikidataId: "Q3374376", title: "Canonical title" },
        object: { ownerId: venueId, accession: "123" },
      }),
    );
    const before = await t.run((ctx) => ctx.db.query("museumWorkIdentities").collect());
    const shared = await shareAs(t, venueId);
    const object = (await t.run((ctx) => ctx.db.get("objects", shared.row.indexedObjectId!)))!;
    expect(object.artworkId).not.toBe(corpus.artworkId);
    expect(await t.run((ctx) => ctx.db.get("artworks", corpus.artworkId))).toMatchObject({
      title: "Canonical title",
    });
    expect(await t.run((ctx) => ctx.db.query("museumWorkIdentities").collect())).toEqual(before);
    expect(await t.run((ctx) => ctx.db.get("artworks", object.artworkId))).not.toHaveProperty("wikidataId");
  });

  it("rechecks venue and artwork rights at the commit boundary", async () => {
    const { t, venueId, contribute } = await fixture();
    await t.run((ctx) => ctx.db.patch("museums", venueId, { optOut: true }));
    await expect(contribute()).rejects.toMatchObject({
      data: { code: "invalid_venue" },
    });
    await t.run((ctx) => ctx.db.patch("museums", venueId, { optOut: false }));
    const corpus = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        vector: testVector(0),
        artwork: { wikidataId: "Q3374376" },
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("takedowns", {
        target: { kind: "artwork", artworkId: corpus.artworkId },
        requester: "museum",
        receivedAt: Date.now(),
      }),
    );
    await expect(contribute()).rejects.toMatchObject({
      data: { code: "artwork_taken_down" },
    });
    expect(await t.run((ctx) => ctx.db.query("contributions").collect())).toEqual([]);
  });

  it("keeps a taken-down visitor label off the venue across devices, model versions, and sibling entries", async () => {
    vi.useFakeTimers();
    const { t, venueId } = await fixture();
    const accessionFlow = (accession: string) =>
      verifiedFlow({
        fields: {
          title: labelField("Water Lilies", "qr"),
          artist: labelField("Claude Monet", "qr"),
          accession: labelField(accession, "qr"),
        },
      });
    const shared = await shareAs(t, venueId, { flow: accessionFlow("123") });
    // Same label, kept as a separate entry by a conflicting verified accession.
    const sibling = await shareAs(t, venueId, {
      vector: testVector(0.9),
      flow: accessionFlow("456"),
    });
    expect(sibling.row.indexedObjectId).not.toBe(shared.row.indexedObjectId);
    const eligible = async (objectId: Id<"objects">) => {
      const vectors = await t.run((ctx) =>
        ctx.db
          .query("vectors")
          .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
          .collect(),
      );
      const candidates = await t.query(internal.identify.loadCandidates, {
        recordIds: vectors.map(searchRecordId),
        scores: vectors.map(() => 1),
        venueId,
        now: Date.now(),
      });
      return candidates.some((candidate) => candidate.object._id === objectId);
    };
    expect(await eligible(sibling.row.indexedObjectId!)).toBe(true);
    await t.mutation(internal.revert.applyTakedown, {
      target: { kind: "object", objectId: shared.row.indexedObjectId! },
      requester: "museum",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await eligible(sibling.row.indexedObjectId!)).toBe(false);
    await expect(shareAs(t, venueId)).rejects.toMatchObject({
      data: { code: "artwork_taken_down" },
    });
    await expect(shareAs(t, venueId, { modelVersion: "other-model" })).rejects.toMatchObject({
      data: { code: "artwork_taken_down" },
    });
    const other = await shareAs(t, venueId, {
      flow: verifiedFlow({
        fields: {
          title: labelField("Haystacks", "ocr"),
          artist: labelField("Claude Monet", "ocr"),
        },
      }),
    });
    expect(other.status).toBe("tentative");
  });

  it("hides an existing visitor entry once the canonical artwork it claims is taken down", async () => {
    vi.useFakeTimers();
    const { t, venueId } = await fixture();
    const corpus = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        vector: testVector(0),
        artwork: { wikidataId: "Q3374376" },
      }),
    );
    const shared = await shareAs(t, venueId);
    const objectId = shared.row.indexedObjectId!;
    const vector = await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_contributionId", (q) => q.eq("contributionId", shared.contributionId))
        .unique(),
    );
    const candidates = () =>
      t.query(internal.identify.loadCandidates, {
        recordIds: [searchRecordId(vector!)],
        scores: [1],
        venueId,
        now: Date.now(),
      });
    expect((await candidates()).map((candidate) => candidate.object._id)).toEqual([objectId]);
    await t.mutation(internal.revert.applyTakedown, {
      target: { kind: "artwork", artworkId: corpus.artworkId },
      requester: "museum",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await candidates()).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
      reverted: false,
    });
  });
});

describe("precise contribution removal", () => {
  it.each([false, true])(
    "revokes a withdrawn photo before the entry rebuild runs (surviving contribution: %s)",
    async (survivingContribution) => {
      vi.useFakeTimers();
      const { t, user, contribute, venueId, cropStorageId } = await fixture();
      const { contributionId } = await contribute();
      const bob = survivingContribution ? await shareAs(t, venueId) : null;
      const path = `/file?id=${cropStorageId}`;
      const remainingPath = `/file?id=${bob?.cropStorageId ?? cropStorageId}`;
      const remainingStatus = survivingContribution ? 302 : 404;
      expect((await t.fetch(path)).status).toBe(302);

      await user.as.mutation(api.contributions.withdraw, { contributionId });

      // The old thumbnail still holds a reference until the scheduled rebuild completes.
      expect(await r2.get(cropStorageId)).not.toBeNull();
      const response = await t.fetch(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
      expect(await t.run((ctx) => fileStorage.getUrl(ctx, cropStorageId))).toBeNull();
      expect((await t.fetch(remainingPath)).status).toBe(remainingStatus);

      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await r2.get(cropStorageId)).toBeNull();
      expect((await t.fetch(path)).status).toBe(404);
      expect((await t.fetch(remainingPath)).status).toBe(remainingStatus);
    },
  );

  it.each(["withdraw", "ban"] as const)(
    "%s removes Alice’s exact material and rebuilds the entry from Bob’s complete reference",
    async (kind) => {
      vi.useFakeTimers();
      const { t, user: alice, contribute, venueId, cropStorageId } = await fixture();
      const first = await contribute();
      const own = (await t.run((ctx) => ctx.db.get("contributions", first.contributionId)))!;
      const bob = await shareAs(t, venueId, {
        flow: verifiedFlow({
          fields: {
            title: labelField("Water Lilies", "ocr"),
            artist: labelField("Claude Monet", "ocr"),
            date: labelField("1917", "ocr"),
            medium: labelField("Oil", "ocr"),
          },
        }),
      });
      await t.run((ctx) => ctx.db.patch("scans", bob.scanId, { gallery: "Bob gallery" }));
      const corpus = await t.run((ctx) =>
        seedArtworkWithObject(ctx, {
          vector: testVector(0),
          descriptors: pair.ref,
        }),
      );
      const objectId = own.indexedObjectId!;
      const before = await t.run((ctx) => ctx.db.get("objects", objectId));
      if (kind === "withdraw") {
        await alice.as.mutation(api.contributions.withdraw, {
          contributionId: first.contributionId,
        });
      } else {
        await t.mutation(internal.revert.revertDevice, {
          deviceId: alice.deviceId,
          reason: "abuse",
        });
      }
      const vectors = await t.run((ctx) => ctx.db.query("vectors").collect());
      const during = await t.query(internal.identify.loadCandidates, {
        recordIds: vectors.map(searchRecordId),
        scores: vectors.map(() => 1),
        venueId,
        now: Date.now(),
      });
      expect(during.some((candidate) => candidate.object._id === objectId)).toBe(false);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
        reverted: false,
        sourceContributionId: bob.contributionId,
      });
      expect(
        await t.run(async (ctx) => readObjectDetails(ctx, (await ctx.db.get("objects", objectId))!)),
      ).toMatchObject({
        thumbnailStorageId: bob.cropStorageId,
        medium: "Oil",
      });
      expect(await t.run((ctx) => ctx.db.get("artworks", before!.artworkId))).toMatchObject({
        date: "1917",
        identityStatus: "tentative",
      });
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("placements")
            .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
            .unique(),
        ),
      ).toMatchObject({ gallery: "Bob gallery" });
      expect(await t.run((ctx) => readTestOrb(ctx, objectId))).toMatchObject({
        contributionId: bob.contributionId,
        storageId: bob.row.orbStorageId,
      });
      expect(await t.run((ctx) => fileStorage.get(ctx, cropStorageId))).toBeNull();
      expect(await t.run((ctx) => fileStorage.get(ctx, own.orbStorageId!))).toBeNull();
      expect(await t.run((ctx) => ctx.db.get("objects", corpus.objectId))).toMatchObject({
        reverted: false,
        identityStatus: "established",
      });
      expect(await t.run((ctx) => ctx.db.get("vectors", corpus.vectorId))).not.toBeNull();
      expect(await t.run((ctx) => ctx.db.get("contributions", bob.contributionId))).toMatchObject({
        status: "tentative",
      });
      const removal = await t.query(internal.revert.removalProgress, {
        deviceId: alice.deviceId,
      });
      expect(removal?.phase).toBe(kind === "ban" ? "complete" : undefined);
      await bob.user.as.mutation(api.contributions.withdraw, {
        contributionId: bob.contributionId,
      });
      await bob.user.as.mutation(api.contributions.withdraw, {
        contributionId: bob.contributionId,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
        reverted: true,
      });
      expect(await t.run((ctx) => ctx.db.get("artworks", before!.artworkId))).toHaveProperty("retiredAt");
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("vectors")
            .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
            .collect(),
        ),
      ).toEqual([]);
    },
  );

  it.each(["withdraw", "ban"] as const)(
    "joins the surviving entry when a share lands between Alice’s %s and its rebuild",
    async (kind) => {
      vi.useFakeTimers();
      const { t, user: alice, contribute, venueId } = await fixture();
      const first = await contribute();
      const objectId = (await t.run((ctx) => ctx.db.get("contributions", first.contributionId)))!.indexedObjectId!;
      const bob = await shareAs(t, venueId);
      if (kind === "withdraw") {
        await alice.as.mutation(api.contributions.withdraw, {
          contributionId: first.contributionId,
        });
      } else {
        await t.mutation(internal.revert.revertDevice, {
          deviceId: alice.deviceId,
          reason: "abuse",
        });
      }
      // Nothing scheduled has run yet: the recorded reference is still Alice’s ineligible contribution.
      const carol = await shareAs(t, venueId, { vector: testVector(0.91) });
      expect(carol.row.indexedObjectId).toBe(objectId);
      expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
        sourceContributionId: bob.contributionId,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const live = (await t.run((ctx) => ctx.db.query("objects").collect())).filter((object) => !object.reverted);
      expect(live.map((object) => object._id)).toEqual([objectId]);
      expect(live[0]).toMatchObject({
        sourceContributionId: bob.contributionId,
      });
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("vectors")
            .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
            .collect(),
        ),
      ).toHaveLength(2);
      const removal = await t.query(internal.revert.removalProgress, {
        deviceId: alice.deviceId,
      });
      expect(removal?.phase).toBe(kind === "ban" ? "complete" : undefined);
    },
  );

  it("blocks other devices from withdrawing a contribution", async () => {
    const { t, contribute } = await fixture();
    const result = await contribute();
    const stranger = await seedDevice(t);
    await expect(
      stranger.as.mutation(api.contributions.withdraw, {
        contributionId: result.contributionId,
      }),
    ).rejects.toMatchObject({ data: { code: "contribution_not_found" } });
  });
});

it("finishes a multi-page ban, tolerates a restarted worker, and keeps another device’s entries", async () => {
  vi.useFakeTimers();
  const { seedPublishedContribution: publishContribution } = await import("./lib/testFactories");
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const own: Id<"contributions">[] = [];
  for (let i = 0; i < 30; i++) {
    own.push(
      await t.run(async (ctx) => {
        const cropStorageId = await fileStorage.store(ctx, new Blob(["crop"], { type: "image/jpeg" }));
        const id = await seedContribution(ctx, {
          deviceId: alice.deviceId,
          venueId,
          cropStorageId,
          fields: {
            title: { value: `Study ${i}`, evidence: "ocr", edited: false },
            artist: { value: "Visitor", evidence: "ocr", edited: false },
          },
        });
        await publishContribution(ctx, (await ctx.db.get("contributions", id))!);
        return id;
      }),
    );
  }
  const theirs = await shareAs(t, venueId, { user: bob });
  const jobId = await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "abuse",
  });
  await t.mutation(internal.revert.cleanupDevicePage, { jobId });
  const partial = await t.query(internal.revert.removalProgress, {
    deviceId: alice.deviceId,
  });
  expect(partial).toMatchObject({ phase: "contributions", processed: 25 });
  expect(
    await t.mutation(internal.revert.revertDevice, {
      deviceId: alice.deviceId,
      reason: "abuse",
    }),
  ).toBe(jobId);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({
    phase: "complete",
    processed: 30,
    settled: 30,
    completedAt: expect.any(Number),
  });
  for (const id of own) {
    const row = await t.run((ctx) => ctx.db.get("contributions", id));
    expect(row).toMatchObject({
      status: "rejected",
      rejectedReason: "device_reverted",
    });
    expect(row?.cropStorageId).toBeUndefined();
    expect(row?.orbStorageId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("objects", row!.indexedObjectId!))).toMatchObject({
      reverted: true,
    });
  }
  expect(await t.run((ctx) => ctx.db.get("objects", theirs.row.indexedObjectId!))).toMatchObject({
    reverted: false,
  });
});

it("groups a second view with a published contribution, rejects its replay, and deletes a withdrawn view's payloads", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ALLOW_SIMULATOR_DEVICES", "true");
  const t = harness();
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const first = await shareAs(t, venueId, { vector: testVector(0.9) });
  const second = await shareAs(t, venueId, { vector: testVector(0.95) });
  expect(second.status).toBe("tentative");
  expect(second.row.indexedObjectId).toBe(first.row.indexedObjectId);
  const replay = await shareAs(t, venueId, { vector: testVector(0.9) });
  expect(replay).toMatchObject({ status: "rejected", reason: "duplicate" });
  await second.user.as.mutation(api.contributions.withdraw, { contributionId: second.contributionId });
  expect(await t.run((ctx) => ctx.db.get("scanEmbeddings", second.row.embeddingId))).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const remaining = await t.run((ctx) => ctx.db.query("vectors").collect());
  expect(remaining).toHaveLength(1);
  expect(remaining[0].contributionId).toBe(first.contributionId);
});

describe("R2 contribution uploads", () => {
  it("verifies the uploaded bytes before accepting a pending crop and retains the file on commit", async () => {
    const { t, user, contribute } = await fixture();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { storageId, uploadUrl } = await user.as.mutation(api.contributions.requestCropUpload, {
      size: bytes.length,
    });
    const file = (await t.query(internal.files.metadata, { id: storageId }))!;
    expect(file).toMatchObject({ _id: storageId, state: "pending" });
    expect(uploadUrl).toBe(`https://r2.test/upload/${storageId}`);
    await r2.put(file._id, new Blob([bytes], { type: "image/jpeg" }));
    expect(await contribute({ cropStorageId: storageId })).toMatchObject({ status: "tentative" });
    expect(await t.query(internal.files.metadata, { id: storageId })).toMatchObject({
      state: "ready",
      publicDownload: true,
    });
    expect((await t.query(internal.files.metadata, { id: storageId }))?.expiresAt).toBeUndefined();
  });

  it("rejects another device's upload without consuming or deleting it", async () => {
    const { t, contribute } = await fixture();
    const other = await seedDevice(t);
    const { storageId } = await other.as.mutation(api.contributions.requestCropUpload, { size: 4 });
    await expect(contribute({ cropStorageId: storageId })).rejects.toMatchObject({ data: { code: "bad_crop" } });
    expect((await t.query(internal.files.metadata, { id: storageId }))?.state).toBe("pending");
  });

  it.each(["wrong-size", "not-jpeg", "missing"])(
    "refuses a %s upload even when it has a valid reservation",
    async (kind) => {
      const { t, user, contribute } = await fixture();
      const { storageId } = await user.as.mutation(api.contributions.requestCropUpload, { size: 4 });
      const file = (await t.query(internal.files.metadata, { id: storageId }))!;
      if (kind !== "missing") {
        await r2.put(
          file._id,
          new Blob([kind === "wrong-size" ? new Uint8Array([0xff, 0xd8, 0xff]) : new Uint8Array(4)], {
            type: "image/jpeg",
          }),
        );
      }
      await expect(contribute({ cropStorageId: storageId })).rejects.toMatchObject({ data: { code: "bad_crop" } });
      expect((await t.query(internal.files.metadata, { id: storageId }))?.state).toBe("pending");
    },
  );
});
