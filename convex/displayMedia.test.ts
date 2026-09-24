// @vitest-environment node
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { harness } from "./test.helpers";
import { wallFixture } from "./lib/wallFixtures";
import { seedArtworkWithObject, seedContribution, seedMuseum, seedScan } from "./lib/testFactories";
import { projectSharedVisitCard } from "./lib/projections";
import { resolveDisplayAsset } from "./lib/displayMedia";
import { download } from "./displayMedia";
import type { ActionCtx } from "./_generated/server";

async function fixture(width = 600, height = 300, orientation = 6) {
  const t = harness(),
    a = await wallFixture(t, "a");
  const original = await sharp({
    create: { width, height, channels: 3, background: "#a03020" },
  })
    .jpeg()
    .withMetadata({
      orientation,
      exif: { IFD0: { Artist: "PRIVATE CAMERA OWNER" } },
    })
    .toBuffer();
  const source = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const scanId = await seedScan(ctx, { deviceId: a.deviceId, venueId });
    const cropStorageId = await ctx.storage.store(new Blob([new Uint8Array(original)], { type: "image/jpeg" }));
    const contributionId = await seedContribution(ctx, {
      deviceId: a.deviceId,
      venueId,
      scanId,
      cropStorageId,
    });
    await ctx.db.patch(a.saveId, { scanId });
    return { venueId, scanId, cropStorageId, contributionId };
  });
  const wall = await a.as.mutation(api.walls.setLayout, a.input);
  const itemId = wall.items[0].itemId;
  const path = `/display-media?kind=wallItem&itemId=${itemId}`;
  return { t, a, original, ...source, itemId, path };
}

it("reports unexpected download failures while keeping the private 404 response", async () => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/555");
  const sentry = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", sentry);
  const run = (
    download as unknown as {
      _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
    }
  )._handler;
  try {
    const t = harness();
    const response = await t.action(async (ctx) => {
      const result = await run(
        {
          ...ctx,
          runQuery: async () => {
            throw new Error("storage failed with private token");
          },
        },
        new Request("https://example.com/display-media?kind=wallItem&itemId=example"),
      );
      return {
        status: result.status,
        body: await result.text(),
        cache: result.headers.get("Cache-Control"),
      };
    });
    expect(response.status).toBe(404);
    expect(response.body).toBe("Image unavailable");
    expect(response.cache).toBe("private, no-store");
    expect(sentry).toHaveBeenCalledTimes(1);
    const event = String(sentry.mock.calls[0][1]?.body);
    expect(event).toContain("displayMedia.download");
    expect(event).not.toContain("private token");
    sentry.mockClear();
    expect((await t.fetch("/display-media?kind=invalid")).status).toBe(404);
    expect(sentry).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it("decodes, orients, strips metadata and stores a separate measured derivative; retries do not duplicate", async () => {
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const asset = (await f.t.run((ctx) => ctx.db.query("mediaAssets").collect()))[0];
  expect(asset.storageId).not.toBe(f.cropStorageId);
  expect(asset.source).toEqual({
    kind: "derivative",
    rights: "contributor_consent",
    width: 128,
    height: 256,
  });
  const response = await f.t.fetch(f.path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const bytes = Buffer.from(await response.arrayBuffer()),
    metadata = await sharp(bytes).metadata();
  expect(metadata).toMatchObject({ width: 128, height: 256, format: "jpeg" });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(await sharp(bytes).raw().toBuffer()).toHaveLength(128 * 256 * 3);
  const before = await f.t.run((ctx) => ctx.db.system.query("_storage").collect());
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual(before);
  const projected = await f.t.query(api.walls.getArtwork, { itemId: f.itemId });
  expect(projected?.artwork.media).toEqual({
    kind: "derivative",
    rights: "contributor_consent",
    width: 128,
    height: 256,
    reference: { kind: "wallItem", itemId: f.itemId },
  });
  for (const secret of [f.cropStorageId, asset.storageId!, f.contributionId]) {
    expect(JSON.stringify(projected)).not.toContain(secret);
  }
});

it("never enlarges smaller JPEGs", async () => {
  const f = await fixture(40, 20, 1);
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork.media).toMatchObject({
    width: 40,
    height: 20,
  });
});

it("keeps serving derivatives after the scanning device signs out of the account", async () => {
  const f = await fixture();
  await f.a.as.mutation(api.accounts.unlink, {});
  expect(await f.t.run((ctx) => ctx.db.get(f.a.deviceId))).not.toHaveProperty("accountId");
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork.media.kind).toBe("derivative");
  expect((await f.t.fetch(f.path)).status).toBe(200);
});

it("remembers revocation even before the first preparation starts", async () => {
  const f = await fixture();
  await f.t.mutation(internal.displayMedia.revokeContribution, {
    contributionId: f.contributionId,
  });
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect(await f.t.run((ctx) => ctx.db.query("mediaAssets").collect())).toEqual([]);
  expect((await f.t.fetch(f.path)).status).toBe(404);
});

it("concurrent preparations leave one asset and one derivative file", async () => {
  const f = await fixture();
  await Promise.all([1, 2, 3].map(() => f.t.action(internal.displayMediaPrepare.prepare, { saveId: f.a.saveId })));
  expect(await f.t.run((ctx) => ctx.db.query("mediaAssets").collect())).toHaveLength(1);
  expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(3); // crop, ORB, derivative
});

it.each(["withdrawn", "source-deleted", "source-replaced", "save-deleted", "revoked"] as const)(
  "rechecks consent during attachment: %s",
  async (change) => {
    const f = await fixture();
    const asset = (await f.t.mutation(internal.displayMedia.beginPreparation, {
      saveId: f.a.saveId,
    }))!;
    const storageId = await f.t.run(async (ctx) => {
      if (change === "withdrawn") {
        await ctx.db.patch(f.contributionId, {
          status: "rejected",
          rejectedReason: "withdrawn",
        });
      }
      if (change === "source-deleted") await ctx.storage.delete(f.cropStorageId);
      if (change === "source-replaced") {
        await ctx.db.patch(f.contributionId, {
          cropStorageId: await ctx.storage.store(new Blob(["replacement"])),
        });
      }
      if (change === "save-deleted") {
        await ctx.db.patch(f.a.saveId, { deletedAt: 1 });
      }
      return ctx.storage.store(new Blob(["derivative"]));
    });
    if (change === "revoked") {
      await f.t.mutation(internal.displayMedia.revokeSave, {
        saveId: f.a.saveId,
      });
    }
    expect(
      await f.t.mutation(internal.displayMedia.attach, {
        assetId: asset._id,
        storageId,
        width: 100,
        height: 100,
      }),
    ).toBe(false);
    await f.t.mutation(internal.displayMedia.discard, { storageId });
    await f.t.action(internal.displayMediaPrepare.prepare, {
      saveId: f.a.saveId,
    });
    expect((await f.t.fetch(f.path)).status).toBe(404);
  },
);

it.each(["removed", "save-deleted", "inactive-profile", "withdrawn", "missing-source", "missing-derivative"] as const)(
  "rechecks every media read before cleanup: %s",
  async (change) => {
    const f = await fixture();
    await f.t.action(internal.displayMediaPrepare.prepare, {
      saveId: f.a.saveId,
    });
    await f.t.run(async (ctx) => {
      if (change === "removed") await ctx.db.patch(f.itemId, { active: false });
      if (change === "save-deleted") {
        await ctx.db.patch(f.a.saveId, { deletedAt: 1 });
      }
      if (change === "inactive-profile") {
        await ctx.db.patch(f.a.profile.profileId, { active: false });
      }
      if (change === "withdrawn") {
        await ctx.db.patch(f.contributionId, {
          status: "rejected",
          rejectedReason: "withdrawn",
        });
      }
      if (change === "missing-source") await ctx.storage.delete(f.cropStorageId);
      if (change === "missing-derivative") {
        const asset = await resolveDisplayAsset(ctx, (await ctx.db.get(f.a.saveId))!);
        await ctx.storage.delete(asset!.storageId!);
      }
    });
    const response = await f.t.fetch(f.path);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  },
);

it("revokes derivatives idempotently, removes storage references and never revives revoked assets", async () => {
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const asset = (await f.t.run((ctx) => ctx.db.query("mediaAssets").collect()))[0];
  await f.t.mutation(internal.displayMedia.revokeContribution, {
    contributionId: f.contributionId,
  });
  await f.t.mutation(internal.displayMedia.revokeContribution, {
    contributionId: f.contributionId,
  });
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect(await f.t.run((ctx) => ctx.db.system.get(asset.storageId!))).toBeNull();
  expect(await f.t.run((ctx) => ctx.db.get(asset._id))).toMatchObject({
    revokedAt: expect.any(Number),
  });
  expect((await f.t.run((ctx) => ctx.db.get(asset._id)))?.storageId).toBeUndefined();
  expect((await f.t.fetch(f.path)).status).toBe(404);
});

it("withdrawing the contribution revokes its derivative and deletes the file", async () => {
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const asset = (await f.t.run((ctx) => ctx.db.query("mediaAssets").collect()))[0];
  await f.a.as.mutation(api.contributions.withdraw, {
    contributionId: f.contributionId,
  });
  expect(await f.t.run((ctx) => ctx.db.get(asset._id))).toMatchObject({
    revokedAt: expect.any(Number),
  });
  expect(await f.t.run((ctx) => ctx.db.system.get(asset.storageId!))).toBeNull();
  expect((await f.t.fetch(f.path)).status).toBe(404);
  const files = await f.t.run((ctx) => ctx.db.system.query("_storage").collect());
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual(files);
});

it("reverting the scanning device revokes its derivatives and deletes the file", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const asset = (await f.t.run((ctx) => ctx.db.query("mediaAssets").collect()))[0];
  await f.t.mutation(internal.revert.revertDevice, {
    deviceId: f.a.deviceId,
    reason: "flooding",
  });
  expect((await f.t.fetch(f.path)).status).toBe(404);
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  expect(await f.t.run((ctx) => ctx.db.get(f.contributionId))).toMatchObject({
    status: "rejected",
    rejectedReason: "device_reverted",
    displayMediaRevokedAt: expect.any(Number),
  });
  expect(await f.t.run((ctx) => ctx.db.get(asset._id))).toMatchObject({
    revokedAt: expect.any(Number),
  });
  expect(await f.t.run((ctx) => ctx.db.system.get(asset.storageId!))).toBeNull();
  expect((await f.t.fetch(f.path)).status).toBe(404);
});

it("purging a deleted account deletes its derivatives and their files", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const asset = (await f.t.run((ctx) => ctx.db.query("mediaAssets").collect()))[0];
  await f.a.as.mutation(api.accounts.deleteAccount, {});
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.run((ctx) => ctx.db.get(asset._id))).toBeNull();
  expect(await f.t.run((ctx) => ctx.db.system.get(asset.storageId!))).toBeNull();
  expect((await f.t.fetch(f.path)).status).toBe(404);
  vi.useRealTimers();
});

it("schedules preparation only for selected items with a consented source and no current media", async () => {
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const scheduled = () => f.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);
  const before = await scheduled();
  await f.a.as.mutation(api.walls.setLayout, {
    ...f.a.input,
    revision: 1,
    color: "#123456",
  });
  expect(await scheduled()).toBe(before);
  const [unscanned, scanned] = await f.t.run(async (ctx) => {
    const { _id, _creationTime, ...fields } = (await ctx.db.get(f.a.saveId))!;
    const localIds = [crypto.randomUUID(), crypto.randomUUID()];
    await ctx.db.insert("collections", {
      ...fields,
      localId: localIds[0],
      scanId: undefined,
    });
    await ctx.db.insert("collections", { ...fields, localId: localIds[1] });
    return localIds;
  });
  const items = [
    f.a.selection,
    {
      placementId: unscanned,
      saveLocalId: unscanned,
      layout: { ...f.a.layout, layer: 1 },
    },
  ];
  await f.a.as.mutation(api.walls.setLayout, {
    ...f.a.input,
    revision: 2,
    items,
  });
  expect(await scheduled()).toBe(before);
  await f.a.as.mutation(api.walls.setLayout, {
    ...f.a.input,
    revision: 3,
    items: [
      ...items,
      {
        placementId: scanned,
        saveLocalId: scanned,
        layout: { ...f.a.layout, layer: 2 },
      },
    ],
  });
  expect(await scheduled()).toBe(before + 1);
});

it("uses trusted catalog registration first and falls back when catalog identity becomes unavailable", async () => {
  const f = await fixture();
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const { objectId } = await f.t.run(async (ctx) => {
    const catalog = await seedArtworkWithObject(ctx);
    await ctx.db.patch(f.a.saveId, {
      objectId: catalog.objectId,
      artworkId: catalog.artworkId,
    });
    return catalog;
  });
  const source = {
    kind: "catalog" as const,
    url: "https://museum.example/image.jpg",
    sourceUrl: "https://museum.example/rights",
    rights: "licensed" as const,
    credit: "Museum",
    width: 600,
    height: 400,
  };
  await expect(
    f.t.mutation(internal.displayMedia.registerCatalog, {
      saveId: f.a.saveId,
      objectId,
      source,
      imageRightsEvidence: "",
    }),
  ).rejects.toThrow();
  const evidence = "Verified image license from museum record";
  const assetId = await f.t.mutation(internal.displayMedia.registerCatalog, {
    saveId: f.a.saveId,
    objectId,
    source,
    imageRightsEvidence: evidence,
  });
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork.media).toEqual(source);
  const registered = await f.t.run((ctx) => ctx.db.get(assetId));
  expect(
    await f.t.mutation(internal.displayMedia.registerCatalog, {
      saveId: f.a.saveId,
      objectId,
      source,
      imageRightsEvidence: evidence,
    }),
  ).toBe(assetId);
  expect(await f.t.run((ctx) => ctx.db.get(assetId))).toEqual(registered);
  const replaced = {
    ...source,
    url: "https://museum.example/replacement.jpg",
    width: 300,
  };
  expect(
    await f.t.mutation(internal.displayMedia.registerCatalog, {
      saveId: f.a.saveId,
      objectId,
      source: replaced,
      imageRightsEvidence: evidence,
    }),
  ).toBe(assetId);
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork.media).toEqual(replaced);
  expect(await f.t.run((ctx) => ctx.db.query("mediaAssets").collect())).toHaveLength(2); // derivative + one catalog row
  await f.t.run((ctx) => ctx.db.delete(objectId));
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork).toMatchObject({
    title: "Saved title",
    media: { kind: "derivative" },
  });
});

it("leaves placeholders for unconsented owner photos and corrupt contribution images", async () => {
  const t = harness(),
    a = await wallFixture(t, "a");
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["photo"]));
    await ctx.db.patch(a.saveId, { cropStorageId: storageId });
  });
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  await t.action(internal.displayMediaPrepare.prepare, { saveId: a.saveId });
  expect((await t.query(api.walls.getArtwork, { itemId: item.itemId }))?.artwork.media.kind).toBe("placeholder");
  const f = await fixture();
  await f.t.run(async (ctx) =>
    ctx.db.patch(f.contributionId, {
      cropStorageId: await ctx.storage.store(new Blob(["not an image"])),
    }),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await f.t.action(internal.displayMediaPrepare.prepare, {
      saveId: f.a.saveId,
    });
  } finally {
    warning.mockRestore();
  }
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.artwork.media.kind).toBe("placeholder");
});

it("delegates shared access to the social guard, never falls back to wall access and never puts notes in shared cards", async () => {
  const f = await fixture(),
    viewer = await wallFixture(f.t, "b");
  await f.t.action(internal.displayMediaPrepare.prepare, {
    saveId: f.a.saveId,
  });
  const postId = crypto.randomUUID();
  const shared = await f.t.run(async (ctx) => {
    const visitLocalId = crypto.randomUUID();
    const visitId = await ctx.db.insert("visits", {
      visibility: "public" as const,
      localId: visitLocalId,
      owner: { kind: "account", accountId: f.a.accountId },
      venueId: f.venueId,
      venueName: "Museum",
      visitedOn: "2026-09-01",
      timeZone: "UTC",
      updatedAt: 1,
      updatedBy: f.a.deviceId,
      changeVersion: 1,
    });
    await ctx.db.patch(f.a.saveId, {
      visitLocalId,
      visitId,
      venueId: f.venueId,
    });
    const publicationId = await ctx.db.insert("sharedVisits", {
      audience: "public",
      postId,
      profileId: f.a.profile.profileId,
      visitId,
      visitLocalId,
      visitedOn: "2026-09-01",
      status: "private",
      reflection: "",
      publishedAt: 1,
      updatedAt: 1,
      publicationRevision: 0,
    });
    return ctx.db.insert("sharedVisitItems", {
      publicationId,
      saveId: f.a.saveId,
      saveLocalId: f.a.saveLocalId,
      position: 0,
    });
  });
  const path = `/display-media?kind=sharedVisit&itemId=${shared}&postId=${postId}`;
  expect((await viewer.as.fetch(path)).status).toBe(404);
  expect((await f.t.fetch(f.path)).status).toBe(200);
  await f.t.run(async (ctx) => {
    await ctx.db.patch((await ctx.db.get(shared))!.publicationId, {
      status: "active",
    });
    await ctx.db.patch(f.itemId, { noteVisible: true });
  });
  expect((await viewer.as.fetch(path)).status).toBe(200);
  expect(
    await f.t.run(async (ctx) =>
      projectSharedVisitCard((await ctx.db.get(shared))!, (await ctx.db.get(f.a.saveId))!, null, postId),
    ),
  ).not.toHaveProperty("note");
  await f.t.run((ctx) =>
    ctx.db.insert("blocks", {
      blockerId: f.a.profile.profileId,
      blockedId: viewer.profile.profileId,
      revision: 1,
      active: true,
    }),
  );
  expect((await viewer.as.fetch(path)).status).toBe(404);
  expect((await viewer.as.fetch(f.path)).status).toBe(200);
  for (const invalid of [
    "/display-media",
    "/display-media?kind=wallItem&itemId=bad",
    `${path}&saveId=${f.a.saveId}`,
    `${f.path}&postId=${postId}`,
  ]) {
    const response = await f.t.fetch(invalid);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
});
