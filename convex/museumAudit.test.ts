import { afterEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import { MAX_BATCH_ROWS } from "./ingest";
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => vi.restoreAllMocks());

it("preserves museum IDs, private state, reviews and corpus references, and emits no changes on replay", async () => {
  const t = harness();
  const { kept, removed, review, work } = await t.run(async (ctx) => {
    const kept = await seedMuseum(ctx, { key: "keep" });
    const removed = await seedMuseum(ctx, {
      key: "remove",
      optOut: true,
      contributionRevision: 7,
      collectionSiteUrl: "https://museum.example/collection",
      platform: "emuseum",
    });
    const review = await seedMuseum(ctx, { key: "review" });
    const work = await seedArtworkWithObject(ctx, {
      placement: { venueId: removed, onView: true, source: "feed", confidence: 1 },
    });
    return { kept, removed, review, work };
  });
  const before = await t.query(internal.museumAudit.byKeys, { keys: ["keep", "remove", "review"] });
  const records = [
    { key: "keep", excludedFromDiscovery: false },
    { key: "remove", excludedFromDiscovery: true },
  ];
  const result = await t.action(internal.museumAudit.applyBatch, { records });
  expect(result).toEqual({ changed: 1, unchanged: 1, ids: { keep: kept, remove: removed } });
  const after = await t.query(internal.museumAudit.byKeys, { keys: ["keep", "remove", "review"] });
  expect(after).toEqual([before[0], { ...before[1], excludedFromDiscovery: true }, before[2]]);
  expect(after[2]?._id).toBe(review);
  expect(await t.run((ctx) => ctx.db.get("objects", work.objectId))).toMatchObject({ ownerId: removed });
  expect(await t.run((ctx) => ctx.db.query("placements").unique())).toMatchObject({ venueId: removed });
  const changes = await t.query(api.venueChanges.list, { since: 0 });
  expect(changes.venues).toEqual([expect.objectContaining({ id: removed, excludedFromDiscovery: true })]);
  expect(await t.action(internal.museumAudit.applyBatch, { records })).toEqual({
    changed: 0,
    unchanged: 2,
    ids: result.ids,
  });
  expect(await t.query(api.venueChanges.list, { since: changes.checkpoint })).toMatchObject({ venues: [] });
  expect((await t.query(internal.ingest.counts, {})).museums).toBe(0);
});

it("retains alias documents and permits excluded survivors without changing history or collection ownership", async () => {
  const t = harness();
  const { survivor, alias, work } = await t.run(async (ctx) => {
    const survivor = await seedMuseum(ctx, { key: "survivor" });
    const alias = await seedMuseum(ctx, { key: "alias" });
    const work = await seedArtworkWithObject(ctx, { object: { ownerId: alias } });
    return { survivor, alias, work };
  });
  const records = [
    { key: "alias", excludedFromDiscovery: true, duplicateOf: "survivor" },
    { key: "survivor", excludedFromDiscovery: true },
  ];
  expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({ changed: 2 });
  const [storedAlias, storedSurvivor] = await t.query(internal.museumAudit.byKeys, { keys: ["alias", "survivor"] });
  expect(storedAlias).toMatchObject({ _id: alias, excludedFromDiscovery: true, mergedInto: survivor });
  expect(storedSurvivor).toMatchObject({ _id: survivor, excludedFromDiscovery: true });
  expect(await t.run((ctx) => ctx.db.get("objects", work.objectId))).toMatchObject({ ownerId: alias });
  expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({ changed: 0, unchanged: 2 });
  expect((await t.query(internal.ingest.exportVenues, {})).page).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ _id: alias, excludedFromDiscovery: true, mergedInto: survivor }),
    ]),
  );
  expect((await t.query(api.venueChanges.snapshot, { cursor: null })).venues).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: alias, excludedFromDiscovery: true, mergedInto: survivor })]),
  );
  await t.action(internal.museumAudit.applyBatch, { records: [{ key: "alias", excludedFromDiscovery: false }] });
  expect(await t.run((ctx) => ctx.db.get("museums", alias))).toMatchObject({ excludedFromDiscovery: false });
  expect((await t.run((ctx) => ctx.db.get("museums", alias)))?.mergedInto).toBeUndefined();
});

it("accepts queued visits, saves and captures for an excluded alias and preserves ownership boundaries", async () => {
  const t = harness();
  const user = await seedDevice(t);
  const other = await seedDevice(t);
  const alias = await t.run((ctx) => seedMuseum(ctx, { key: "alias" }));
  await t.run((ctx) => seedMuseum(ctx, { key: "survivor" }));
  await t.action(internal.museumAudit.applyBatch, {
    records: [{ key: "alias", excludedFromDiscovery: true, duplicateOf: "survivor" }],
  });
  const visit = {
    visibility: "public" as const,
    localId: crypto.randomUUID(),
    venueId: alias,
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  };
  const result = await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [visit],
    saves: [
      {
        localId: crypto.randomUUID(),
        visitLocalId: visit.localId,
        savedAt: 1,
        snapshot: { title: "Artwork", artist: "Artist" },
      },
    ],
  });
  expect(result.visits[0]).toMatchObject({ venueId: alias });
  expect(result.saves[0]).toMatchObject({ venueId: alias, visitId: result.visits[0]._id });
  expect(result.venues[0]).toMatchObject({ id: alias, excludedFromDiscovery: true });
  expect(await user.as.query(api.visits.detail, { scope: user.scope, localId: visit.localId })).toMatchObject({
    venueId: alias,
  });
  const capture = {
    deviceId: user.deviceId,
    localId: crypto.randomUUID(),
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: Date.now(),
    venueId: alias,
    visitId: result.visits[0]._id,
  };
  expect(await t.action(internal.scans.create, capture)).toMatchObject({ scan: { venueId: alias } });
  await expect(t.action(internal.scans.create, { ...capture, deviceId: other.deviceId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});

it("rejects merging a survivor with a preserved incoming alias without changing any records", async () => {
  const t = harness();
  const keys = ["alias", "survivor", "destination"];
  await t.run(async (ctx) => {
    for (const key of keys) await seedMuseum(ctx, { key });
  });
  await t.action(internal.museumAudit.applyBatch, {
    records: [{ key: "alias", excludedFromDiscovery: true, duplicateOf: "survivor" }],
  });
  const before = await t.query(internal.museumAudit.byKeys, { keys });
  const checkpoint = await t.query(internal.venueChanges.latestVersion, {});

  await expect(
    t.action(internal.museumAudit.applyBatch, {
      records: [{ key: "survivor", excludedFromDiscovery: true, duplicateOf: "destination" }],
    }),
  ).rejects.toThrow("museum_alias_chain");
  expect(await t.query(internal.museumAudit.byKeys, { keys })).toEqual(before);
  expect(await t.query(api.venueChanges.list, { since: checkpoint })).toMatchObject({ venues: [] });
});

it.each([false, true])(
  "permits a survivor merge when its incoming alias changes in the same batch (restore: %s)",
  async (restore) => {
    const t = harness();
    await t.run(async (ctx) => {
      for (const key of ["alias", "survivor", "destination"]) await seedMuseum(ctx, { key });
    });
    await t.action(internal.museumAudit.applyBatch, {
      records: [{ key: "alias", excludedFromDiscovery: true, duplicateOf: "survivor" }],
    });
    const records = [
      { key: "survivor", excludedFromDiscovery: true, duplicateOf: "destination" },
      { key: "alias", excludedFromDiscovery: !restore, ...(restore ? {} : { duplicateOf: "destination" }) },
    ];
    expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({ changed: 2 });
    const [alias, survivor, destination] = await t.query(internal.museumAudit.byKeys, {
      keys: ["alias", "survivor", "destination"],
    });
    expect(alias?.mergedInto).toBe(restore ? undefined : destination?._id);
    expect(survivor?.mergedInto).toBe(destination?._id);
    expect(destination?.mergedInto).toBeUndefined();
    expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({ changed: 0, unchanged: 2 });
  },
);

it.each([
  {
    records: [
      { key: "first", excludedFromDiscovery: true },
      { key: "missing", excludedFromDiscovery: true },
    ],
    code: "unknown_key",
  },
  {
    records: [
      { key: "first", excludedFromDiscovery: true },
      { key: "first", excludedFromDiscovery: false },
    ],
    code: "duplicate_entry",
  },
  {
    records: [{ key: "first", excludedFromDiscovery: false, duplicateOf: "second" }],
    code: "museum_alias",
  },
  {
    records: [{ key: "first", excludedFromDiscovery: true, duplicateOf: "first" }],
    code: "museum_alias",
  },
  {
    records: [
      { key: "first", excludedFromDiscovery: true, duplicateOf: "second" },
      { key: "second", excludedFromDiscovery: true, duplicateOf: "first" },
    ],
    code: "museum_alias_chain",
  },
])("rejects invalid imports atomically: $code $records", async ({ records, code }) => {
  const t = harness();
  await t.run(async (ctx) => {
    await seedMuseum(ctx, { key: "first" });
    await seedMuseum(ctx, { key: "second" });
  });
  const before = await t.query(internal.museumAudit.byKeys, { keys: ["first", "second"] });
  await expect(t.action(internal.museumAudit.applyBatch, { records })).rejects.toThrow(code);
  expect(await t.query(internal.museumAudit.byKeys, { keys: ["first", "second"] })).toEqual(before);
  expect(await t.query(internal.venueChanges.latestVersion, {})).toBe(0);
});

it("bounds imports and preserves requested lookup order with nulls for missing keys", async () => {
  const t = harness();
  const first = await t.run((ctx) => seedMuseum(ctx, { key: "first" }));
  const second = await t.run((ctx) => seedMuseum(ctx, { key: "second" }));
  expect(await t.query(internal.museumAudit.byKeys, { keys: ["second", "missing", "first"] })).toEqual([
    expect.objectContaining({ _id: second }),
    null,
    expect.objectContaining({ _id: first }),
  ]);
  await expect(
    t.action(internal.museumAudit.applyBatch, {
      records: Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => ({ key: `key:${i}`, excludedFromDiscovery: true })),
    }),
  ).rejects.toThrow("batch_too_large");
  await expect(
    t.query(internal.museumAudit.byKeys, { keys: Array.from({ length: 101 }, (_, i) => `key:${i}`) }),
  ).rejects.toThrow("batch_too_large");
});

it("exports complete museum documents in bounded pages for backup and readback", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    for (let i = 0; i <= MAX_BATCH_ROWS; i++) {
      await seedMuseum(ctx, { key: `venue:${String(i).padStart(3, "0")}`, optOut: true, contributionRevision: i });
    }
  });
  const first = await t.query(internal.museumAudit.exportPage, {});
  expect(first.isDone).toBe(false);
  expect(first.page).toHaveLength(MAX_BATCH_ROWS);
  expect(first.page[0]).toMatchObject({ key: "venue:000", optOut: true, contributionRevision: 0 });
  const next = await t.query(internal.museumAudit.exportPage, { cursor: first.continueCursor });
  expect(next.isDone).toBe(true);
  expect(next.page).toHaveLength(1);
  expect(next.page[0]).toMatchObject({
    key: `venue:${MAX_BATCH_ROWS}`,
    optOut: true,
    contributionRevision: MAX_BATCH_ROWS,
  });
  expect(new Set([...first.page, ...next.page].map((row) => row._id)).size).toBe(MAX_BATCH_ROWS + 1);
});

it("applies a full batch within production transaction limits", async () => {
  const t = harness({ transactionLimits: true });
  await t.run(async (ctx) => {
    await seedMuseum(ctx, { key: "survivor" });
    for (let i = 0; i < MAX_BATCH_ROWS; i++) await seedMuseum(ctx, { key: `alias:${i}` });
  });
  const records = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => ({
    key: `alias:${i}`,
    excludedFromDiscovery: true,
    duplicateOf: "survivor",
  }));
  expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({ changed: MAX_BATCH_ROWS });
  expect(await t.action(internal.museumAudit.applyBatch, { records })).toMatchObject({
    changed: 0,
    unchanged: MAX_BATCH_ROWS,
  });
});
