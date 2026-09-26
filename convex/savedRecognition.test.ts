import { afterEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { r2 } from "./lib/r2";
import { limitDevice, type RateLimitName } from "./lib/rateLimits";
import { socialUser } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import { readVector } from "./lib/vectorStore";
import { harness } from "./test.helpers";

afterEach(() => vi.unstubAllEnvs());
const pair = makeSyntheticPair({ count: 120 });

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const localId = crypto.randomUUID();
  const saved = await user.as.mutation(api.collections.saveToCollection, {
    scope: user.scope,
    localId,
    venueId,
    snapshot: { title: "Unidentified artwork", artist: "" },
    suggested: null,
    savedAt: Date.now(),
  });
  const payload = {
    scope: user.scope,
    localId,
    sourceLocalId: crypto.randomUUID(),
    vector: testVector(),
    ...encodeOrbFeatures(pair.query),
    modelVersion: model.modelVersion,
  };
  return { t, user, venueId, localId, saved, payload };
}

it("recognizes a saved miss from its uploaded data, and applies the chosen match without changing its photo or notes", async () => {
  const { t, user, venueId, localId, saved, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  await user.as.action(api.savedRecognition.upload, payload);
  expect(await t.run((ctx) => ctx.db.query("savedRecognition").collect())).toHaveLength(1);
  const data = (await t.run((ctx) => ctx.db.query("savedRecognition").unique()))!;
  expect(data).not.toHaveProperty("vector");
  expect(await t.action((ctx) => readVector(ctx, data))).toEqual(payload.vector);
  expect((await t.run((ctx) => fileStorage.getMetadata(ctx, data.archiveId)))?.publicDownload).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").first())).toBeNull();
  expect(await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId })).toMatchObject({
    outcome: "miss",
    candidates: [],
  });
  const cropStorageId = await t.run((ctx) => fileStorage.store(ctx, new Blob(["photo"])));
  await t.run((ctx) => ctx.db.patch("collections", saved.collectionId, { cropStorageId, note: "My own note" }));
  const work = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      descriptors: pair.ref,
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
    }),
  );
  const result = await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId });
  expect(result.candidates[0]).toMatchObject({ objectId: work.objectId, title: "Water Lilies" });
  expect((await t.run((ctx) => ctx.db.get("collections", saved.collectionId)))?.snapshot.title).toBe(
    "Unidentified artwork",
  );
  const applied = await user.as.mutation(api.savedRecognition.accept, {
    scope: user.scope,
    localId,
    attempt: result.attempt,
    objectId: work.objectId,
  });
  expect(applied).toMatchObject({
    objectId: work.objectId,
    cropStorageId,
    note: "My own note",
    snapshot: { title: "Water Lilies", artist: "Claude Monet" },
  });
});

it("refuses other owners, missing data, unsupported models and choices that were not returned", async () => {
  const { t, user, localId, payload } = await fixture();
  const other = await seedDevice(t);
  await expect(other.as.action(api.savedRecognition.upload, { ...payload, scope: other.scope })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await expect(user.as.action(api.savedRecognition.identify, { scope: user.scope, localId })).rejects.toMatchObject({
    data: { code: "recognition_unavailable" },
  });
  await user.as.action(api.savedRecognition.upload, payload);
  await expect(other.as.action(api.savedRecognition.identify, { scope: other.scope, localId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  const result = await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(
    user.as.mutation(api.savedRecognition.accept, {
      scope: user.scope,
      localId,
      attempt: result.attempt,
      objectId: work.objectId,
    }),
  ).rejects.toMatchObject({ data: { code: "unknown_candidate" } });
  vi.stubEnv("SUPPORTED_MODEL_VERSIONS", "a-different-model");
  await expect(user.as.action(api.savedRecognition.identify, { scope: user.scope, localId })).rejects.toMatchObject({
    data: { code: "recognition_model_retired" },
  });
});

it("removes private recognition data and verification files when the saved artwork is deleted", async () => {
  const { t, user, localId, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  const row = (await t.run((ctx) => ctx.db.query("savedRecognition").unique()))!;
  await user.as.mutation(api.collections.remove, { scope: user.scope, localId });
  expect(await t.run((ctx) => ctx.db.get("savedRecognition", row._id))).toBeNull();
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, row.archiveId))).toHaveProperty("expiresAt");
  expect(await t.run((ctx) => fileStorage.get(ctx, row.orbStorageId))).toBeNull();
  await expect(user.as.action(api.savedRecognition.identify, { scope: user.scope, localId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});

it.each(["upload", "deleted save"] as const)(
  "cleans up unused archives when %s prevents attaching saved recognition",
  async (failure) => {
    const { t, user, localId, payload } = await fixture();
    const put = vi.mocked(r2.put).getMockImplementation()!;
    await vi.mocked(r2.put).withImplementation(
      async (id, blob) => {
        if (blob.type === "application/vnd.artlog.embedding") {
          if (failure === "upload") throw new Error("R2 unavailable");
          await user.as.mutation(api.collections.remove, { scope: user.scope, localId });
        }
        return put(id, blob);
      },
      async () => {
        await expect(user.as.action(api.savedRecognition.upload, payload)).rejects.toThrow(
          failure === "upload" ? "R2 unavailable" : "not_found",
        );
      },
    );
    expect(await t.run((ctx) => ctx.db.query("savedRecognition").first())).toBeNull();
    const files = await t.run((ctx) => ctx.db.query("files").collect());
    expect(files.every((row) => row.expiresAt !== undefined)).toBe(true);
  },
);

it("rejects damaged embedding bytes rather than recognizing a saved artwork with them", async () => {
  const { t, user, localId, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  const row = (await t.run((ctx) => ctx.db.query("savedRecognition").unique()))!;
  const get = vi.mocked(r2.get).getMockImplementation()!;
  await vi.mocked(r2.get).withImplementation(
    async (id) => (id === row.archiveId ? new Blob(["damaged"]) : get(id)),
    async () => {
      await expect(user.as.action(api.savedRecognition.identify, { scope: user.scope, localId })).rejects.toThrow(
        "vector_archive_invalid",
      );
    },
  );
});

it("lets another device on the same account retry a saved scan without the capturing phone", async () => {
  const { t, user, localId, saved, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  const second = await seedDevice(t);
  const accountId = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("accounts", {
      appleUserId: "same-owner",
      deviceIds: [user.deviceId, second.deviceId],
      createdAt: Date.now(),
    });
    await ctx.db.patch("devices", user.deviceId, { accountId });
    await ctx.db.patch("devices", second.deviceId, { accountId });
    await ctx.db.patch("collections", saved.collectionId, { owner: { kind: "account", accountId } });
    return accountId;
  });
  expect(
    await second.as.action(api.savedRecognition.identify, { scope: `account:${accountId}:0`, localId }),
  ).toMatchObject({ outcome: "miss" });
});

it("preserves recognition through merging and deletes it through ordinary journal sync", async () => {
  const { t, user, localId, saved, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  const targetLocalId = crypto.randomUUID();
  const target = await user.as.mutation(api.collections.saveToCollection, {
    scope: user.scope,
    localId: targetLocalId,
    snapshot: { title: "My painting", artist: "" },
    suggested: null,
    savedAt: Date.now(),
  });
  await user.as.mutation(api.artworkAlbums.merge, { scope: user.scope, sourceLocalId: localId, targetLocalId });
  const retained = (await t.run((ctx) => ctx.db.query("savedRecognition").unique()))!;
  expect(retained.saveId).toBe(target.collectionId);
  expect(await t.run((ctx) => ctx.db.get("collections", saved.collectionId))).toHaveProperty("deletedAt");
  expect(
    await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId: targetLocalId }),
  ).toMatchObject({ outcome: "miss" });
  const current = (await t.run((ctx) => ctx.db.get("collections", target.collectionId)))!;
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [{ localId: targetLocalId, savedAt: current.savedAt, snapshot: current.snapshot, deletedAt: Date.now() }],
  });
  expect(await t.run((ctx) => ctx.db.get("savedRecognition", retained._id))).toBeNull();
});

it("refuses outdated suggestions after a later search or an edit to the saved artwork", async () => {
  const { t, user, localId, saved, payload } = await fixture();
  await user.as.action(api.savedRecognition.upload, payload);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, { descriptors: pair.ref }));
  const first = await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId });
  const second = await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId });
  await expect(
    user.as.mutation(api.savedRecognition.accept, {
      scope: user.scope,
      localId,
      attempt: first.attempt,
      objectId: work.objectId,
    }),
  ).rejects.toMatchObject({ data: { code: "unknown_candidate" } });
  await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", saved.collectionId))!;
    await ctx.db.patch("collections", save._id, {
      snapshot: { title: "My edited title", artist: "" },
      updatedAt: save.updatedAt + 1,
    });
  });
  await expect(
    user.as.mutation(api.savedRecognition.accept, {
      scope: user.scope,
      localId,
      attempt: second.attempt,
      objectId: work.objectId,
    }),
  ).rejects.toMatchObject({ data: { code: "saved_artwork_changed" } });
});

it("scores an accepted match as the matched artwork on the leaderboard", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      descriptors: pair.ref,
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
    }),
  );
  const earlierLocalId = crypto.randomUUID();
  await user.as.mutation(api.collections.saveToCollection, {
    scope: user.scope,
    localId: earlierLocalId,
    objectId: work.objectId,
    artworkId: work.artworkId,
    snapshot: { title: "Water Lilies", artist: "Claude Monet" },
    suggested: null,
    savedAt: Date.now(),
  });
  const localId = crypto.randomUUID();
  await user.as.mutation(api.collections.saveToCollection, {
    scope: user.scope,
    localId,
    venueId,
    snapshot: { title: "Unidentified artwork", artist: "" },
    suggested: null,
    savedAt: Date.now(),
  });
  const score = async () =>
    (await user.as.query(api.leaderboards.list, { audience: "global", period: "all", metric: "artworks" })).rows[0]
      ?.score;
  expect(await score()).toBe(2);
  await user.as.action(api.savedRecognition.upload, {
    scope: user.scope,
    localId,
    sourceLocalId: crypto.randomUUID(),
    vector: testVector(),
    ...encodeOrbFeatures(pair.query),
    modelVersion: model.modelVersion,
  });
  const result = await user.as.action(api.savedRecognition.identify, { scope: user.scope, localId });
  await user.as.mutation(api.savedRecognition.accept, {
    scope: user.scope,
    localId,
    attempt: result.attempt,
    objectId: work.objectId,
  });
  expect(await score()).toBe(1);
  await user.as.mutation(api.collections.remove, { scope: user.scope, localId: earlierLocalId });
  expect(await score()).toBe(1);
});

async function drain(t: ReturnType<typeof harness>, name: RateLimitName, deviceId: Id<"devices">) {
  for (;;) {
    try {
      await t.run((ctx) => limitDevice(ctx, name, deviceId));
    } catch {
      return;
    }
  }
}

it("uploads saved-scan data from its own rate limit, leaving journal sync untouched", async () => {
  const { t, user, payload } = await fixture();
  await drain(t, "sync", user.deviceId);
  await expect(user.as.action(api.savedRecognition.upload, payload)).resolves.toBeNull();
  const other = await fixture();
  await drain(other.t, "recognitionUpload", other.user.deviceId);
  await expect(other.user.as.action(api.savedRecognition.upload, other.payload)).rejects.toMatchObject({
    data: { code: "rate_limited", name: "recognitionUpload" },
  });
});
