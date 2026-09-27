import { afterEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { r2 } from "./lib/r2";
import {
  readTestEmbedding,
  seedEmbedding,
  seedContribution,
  seedDevice,
  seedMuseum,
  testVector,
} from "./lib/testFactories";
import { VECTOR_ARCHIVE_GRACE_MS } from "./lib/vectorStore";
import { deleteEmbedding, insertEmbedding, requireEmbedding } from "./scanEmbeddings";
import { harness, type Harness } from "./test.helpers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-25T12:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

const stored = (t: Harness, id: Id<"scanEmbeddings"> | undefined) =>
  t.run(async (ctx) => (id ? ctx.db.get("scanEmbeddings", id) : null));

it("stores a scan's embedding separately and reuses it on an idempotent retry", async () => {
  const t = harness();
  const user = await seedDevice(t);
  const args = {
    deviceId: user.deviceId,
    localId: "capture",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: Date.now(),
  };
  const first = await t.action(internal.scans.create, args);
  const retry = await t.action(internal.scans.create, args);
  expect(first.scan).not.toHaveProperty("vector");
  expect(retry.scan.embeddingId).toBe(first.scan.embeddingId);
  expect(await t.run((ctx) => readTestEmbedding(ctx, first.scan.embeddingId))).toEqual(args.vector);
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").collect())).toHaveLength(1);
  expect(await stored(t, first.scan.embeddingId)).not.toHaveProperty("vector");
  expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").first())).toBeNull();
  await vi.mocked(r2.put).withImplementation(
    async () => {
      throw new Error("R2 unavailable");
    },
    async () => {
      expect(await t.action(internal.scans.create, args)).toMatchObject({
        scan: { _id: first.scan._id },
        existing: true,
      });
    },
  );
});

it.each(["upload", "ban"] as const)("does not commit a scan when %s interrupts its R2 upload", async (failure) => {
  const t = harness();
  const user = await seedDevice(t);
  const put = vi.mocked(r2.put).getMockImplementation()!;
  await vi.mocked(r2.put).withImplementation(
    async (id, blob) => {
      expect(await t.run((ctx) => ctx.db.query("scans").first())).toBeNull();
      if (failure === "upload") throw new Error("R2 unavailable");
      await t.run((ctx) => ctx.db.patch("devices", user.deviceId, { banned: true }));
      return put(id, blob);
    },
    async () => {
      await expect(
        t.action(internal.scans.create, {
          deviceId: user.deviceId,
          localId: "failed",
          modelVersion: model.modelVersion,
          vector: testVector(),
          capturedAt: Date.now(),
        }),
      ).rejects.toThrow(failure === "upload" ? "R2 unavailable" : "not_found");
    },
  );
  expect(await t.run((ctx) => ctx.db.query("scans").first())).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").first())).toBeNull();
  const files = await t.run((ctx) => ctx.db.query("files").collect());
  expect(files.every((file) => file.expiresAt !== undefined)).toBe(true);
});

it("keeps an archive until the last independent evidence reference expires or is removed", async () => {
  vi.useFakeTimers();
  try {
    const t = harness();
    const expiring = await t.run((ctx) => seedEmbedding(ctx, { vector: testVector(), expiresAt: Date.now() }));
    const archive = await t.run((ctx) => requireEmbedding(ctx, expiring));
    const retained = await t.run((ctx) => insertEmbedding(ctx, archive));
    await t.action(internal.scanEmbeddings.expire, {});
    expect(await stored(t, expiring)).toBeNull();
    expect(await stored(t, retained)).not.toBeNull();
    expect((await t.run((ctx) => fileStorage.getMetadata(ctx, archive.archiveId)))?.expiresAt).toBeUndefined();
    await t.run((ctx) => deleteEmbedding(ctx, retained));
    expect(await r2.get(archive.archiveId)).not.toBeNull();
    vi.setSystemTime(Date.now() + VECTOR_ARCHIVE_GRACE_MS);
    await t.mutation(internal.files.expire, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await r2.get(archive.archiveId)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("deletes a scan's vector 180 days after it is stored and keeps contribution vectors", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness();
  const user = await seedDevice(t);
  const { scan } = await t.action(internal.scans.create, {
    deviceId: user.deviceId,
    localId: "capture",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: NOW,
  });
  const contributionEmbeddingId = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const contributionId = await seedContribution(ctx, { deviceId: user.deviceId, venueId });
    return (await ctx.db.get("contributions", contributionId))!.embeddingId;
  });
  clock.mockReturnValue(NOW + 180 * DAY - 1);
  await t.action(internal.scanEmbeddings.expire, {});
  expect(await stored(t, scan.embeddingId)).not.toBeNull();
  clock.mockReturnValue(NOW + 180 * DAY);
  await t.action(internal.scanEmbeddings.expire, {});
  expect(await stored(t, scan.embeddingId)).toBeNull();
  expect(await stored(t, contributionEmbeddingId)).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("scans", scan._id))).toMatchObject({ status: "pending" });
});

it("clears a backlog larger than one transaction can delete", async () => {
  const t = harness({ transactionLimits: true });
  for (let chunk = 0; chunk < 4; chunk++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        await seedEmbedding(ctx, { vector: testVector(), expiresAt: Date.now() - 1 });
      }
    });
  }
  await t.action(internal.scanEmbeddings.expire, {});
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").collect())).toEqual([]);
});

it.each([false, true])("resumes an interrupted scan on retry (expired=%s)", async (expired) => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness({ transactionLimits: true });
  const user = await seedDevice(t);
  const args = {
    localId: "interrupted",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: NOW,
  };
  const { scan } = await t.action(internal.scans.create, { ...args, deviceId: user.deviceId });
  if (expired) {
    clock.mockReturnValue(NOW + 180 * DAY);
    await t.action(internal.scanEmbeddings.expire, {});
  }
  await expect(
    user.as.action(api.identify.identify, {
      ...args,
      scope: user.scope,
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
    }),
  ).resolves.toMatchObject({ scanId: scan._id, status: "identified" });
  const retried = (await t.run((ctx) => ctx.db.get("scans", scan._id)))!;
  expect(retried).toMatchObject({ capturedAt: NOW, _creationTime: scan._creationTime });
  expect(await t.run((ctx) => readTestEmbedding(ctx, retried.embeddingId))).toEqual(args.vector);
});

it("keeps an identified result on retry after its vector expires", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness();
  const user = await seedDevice(t);
  const args = {
    localId: "identified",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: NOW,
    scope: user.scope,
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
  };
  const result = await user.as.action(api.identify.identify, args);
  clock.mockReturnValue(NOW + 180 * DAY);
  await t.action(internal.scanEmbeddings.expire, {});
  expect(await user.as.action(api.identify.identify, args)).toEqual(result);
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").collect())).toEqual([]);
});

it("does not retain embedding payloads from unsupported clients", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness({ transactionLimits: true });
  const user = await seedDevice(t);
  for (let i = 0; i < 256; i++) {
    clock.mockReturnValue(NOW + i * 2000);
    const result = await user.as.action(api.identify.identify, {
      localId: String(i),
      modelVersion: "unsupported-model",
      vector: Array<number>(8192).fill(1 / Math.sqrt(8192)),
      capturedAt: NOW + i * 2000,
      scope: user.scope,
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
    });
    expect(result.status).toBe("unsupported_version");
    expect((await t.run((ctx) => ctx.db.get("scans", result.scanId)))?.embeddingId).toBeUndefined();
  }
  clock.mockReturnValue(NOW + 180 * DAY + 256 * 2000);
  await t.action(internal.scanEmbeddings.expire, {});
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").collect())).toEqual([]);
});
