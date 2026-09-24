import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  seedArtworkWithObject,
  seedDevice,
  seedMuseum,
  seedScan,
  seedJournalVisit,
} from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const snapshot = {
  title: "Water Lilies",
  artist: "Claude Monet",
  date: "1916",
  medium: "Oil on canvas",
  institution: "Test Museum",
};
const suggested = { title: "Water Lilies", artist: "Claude Monet" };
const page = { limit: 10, cursor: null };

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      venueId,
      best: {
        objectId: work.objectId,
        artworkId: work.artworkId,
        probability: 0.95,
        identityStatus: "established",
      },
    }),
  );
  const visitId = await t.run((ctx) =>
    seedJournalVisit(ctx, user.deviceId, venueId),
  );
  await t.run((ctx) => ctx.db.patch(scanId, { visitId }));
  const args: {
    localId: string;
    scanId?: Id<"scans">;
    objectId?: Id<"objects">;
    artworkId?: Id<"artworks">;
    venueId?: Id<"museums">;
    scope: string;
    visitLocalId?: string;
    gallery?: string;
    savedAt: number;
    snapshot: typeof snapshot;
    suggested: typeof suggested | null;
  } = {
    scope: user.scope,
    localId: crypto.randomUUID(),
    savedAt: Date.now(),
    scanId,
    objectId: work.objectId,
    artworkId: work.artworkId,
    venueId,
    visitLocalId: (await t.run((ctx) => ctx.db.get(visitId)))!.localId,
    gallery: "4",
    snapshot,
    suggested,
  };
  const save = (overrides: Partial<typeof args> = {}, as = user.as) =>
    as.mutation(api.collections.saveToCollection, { ...args, ...overrides });
  const object = () => t.run((ctx) => ctx.db.get(work.objectId));
  const list = (as = user.as) =>
    as
      .query(api.accounts.me, {})
      .then(({ scope }) =>
        as.query(api.collections.listMine, { ...page, scope }),
      );
  const rows = () => t.run((ctx) => ctx.db.query("collections").collect());
  return { t, user, venueId, work, args, save, object, list, rows };
}

it("saves a snapshot once per local id and confirms an untouched suggestion exactly once", async () => {
  const { user, args, save, object, list, rows } = await fixture();
  const { collectionId } = await save({
    snapshot: { ...snapshot, title: " Water Lilies " },
  });
  expect(await save()).toMatchObject({ collectionId });
  const saved = await rows();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    _id: collectionId,
    owner: { kind: "device", deviceId: user.deviceId },
    localId: args.localId,
    scanId: args.scanId,
    objectId: args.objectId,
    artworkId: args.artworkId,
    venueId: args.venueId,
    visitLocalId: args.visitLocalId,
    gallery: "4",
    snapshot,
    savedAt: expect.any(Number),
  });
  expect(saved[0]).not.toHaveProperty("suggested");
  expect(await object()).toMatchObject({ confirmCount: 1 });
  expect((await list()).page).toMatchObject([{ _id: collectionId }]);
});

it.each([
  [
    "an edited title",
    { snapshot: { ...snapshot, title: "Water Lilies (Nymphéas)" } },
  ],
  ["an edited artist", { snapshot: { ...snapshot, artist: "Monet" } }],
  ["a save without a suggestion", { suggested: null }],
  [
    "a suggestion that is not the object’s artwork",
    {
      suggested: { title: "Haystacks", artist: "Claude Monet" },
      snapshot: { ...snapshot, title: "Haystacks" },
    },
  ],
  ["a save without an object", { objectId: undefined }],
])("does not count %s as a confirm", async (_name, overrides) => {
  const { save, object, rows } = await fixture();
  await save(overrides);
  expect(await rows()).toHaveLength(1);
  expect(await object()).toMatchObject({ confirmCount: 0 });
});

it("lists the caller’s saved works newest first and hides removed ones", async () => {
  const now = vi.spyOn(Date, "now");
  const { t, user, save, list } = await fixture();
  now.mockReturnValue(1_800_000_000_000);
  await save({
    scope: user.scope,
    localId: "10000000-0000-4000-8000-000000000001",
  });
  now.mockReturnValue(1_800_000_001_000);
  await save({
    scope: user.scope,
    localId: "10000000-0000-4000-8000-000000000002",
    savedAt: Date.now(),
  });
  expect((await list()).page.map((row) => row.localId)).toEqual([
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000001",
  ]);
  const other = await seedDevice(t);
  expect((await list(other.as)).page).toEqual([]);
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: "10000000-0000-4000-8000-000000000001",
  });
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: "10000000-0000-4000-8000-000000000001",
  });
  expect((await list()).page.map((row) => row.localId)).toEqual([
    "10000000-0000-4000-8000-000000000002",
  ]);
  const removed = await t.run((ctx) =>
    ctx.db
      .query("collections")
      .withIndex("by_owner_localId", (q) =>
        q
          .eq("owner", { kind: "device", deviceId: user.deviceId })
          .eq("localId", "10000000-0000-4000-8000-000000000001"),
      )
      .unique(),
  );
  expect(removed).toMatchObject({ deletedAt: 1_800_000_001_000 });
  await expect(
    other.as.mutation(api.collections.remove, {
      scope: other.scope,
      localId: "10000000-0000-4000-8000-000000000002",
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  await expect(
    t.query(api.collections.listMine, { ...page, scope: user.scope }),
  ).rejects.toMatchObject({ data: { code: "unauthenticated" } });
});

it("refuses another device’s scan or visit, a missing object and a blank title or id", async () => {
  const { t, venueId, save, rows } = await fixture();
  const other = await seedDevice(t);
  const foreignScan = await t.run((ctx) =>
    seedScan(ctx, { deviceId: other.deviceId }),
  );
  await expect(save({ scanId: foreignScan })).rejects.toMatchObject({
    data: { code: "invalid_scan" },
  });
  const foreignVisit = await t.run((ctx) =>
    seedJournalVisit(ctx, other.deviceId, venueId),
  );
  await expect(
    save({
      visitLocalId: (await t.run((ctx) => ctx.db.get(foreignVisit)))!.localId,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  const missing = await t.run(async (ctx) => {
    const work = await seedArtworkWithObject(ctx);
    await ctx.db.delete(work.objectId);
    return work.objectId;
  });
  await expect(save({ objectId: missing })).rejects.toMatchObject({
    data: { code: "invalid_object" },
  });
  await expect(
    save({ snapshot: { ...snapshot, title: "  " } }),
  ).rejects.toMatchObject({
    data: { code: "invalid_save" },
  });
  await expect(save({ localId: " " })).rejects.toMatchObject({
    data: { code: "invalid_save" },
  });
  expect(await rows()).toEqual([]);
});

it("rate-limits a burst of saves", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const { save } = await fixture();
  for (let i = 0; i < 10; i++) await save({ localId: crypto.randomUUID() });
  await expect(save({ localId: crypto.randomUUID() })).rejects.toMatchObject({
    data: { code: "rate_limited", name: "sync" },
  });
});

it("records the save confirmation once when background sync inserted the snapshot first", async () => {
  const { user, args, save, object } = await fixture();
  const { scope } = await user.as.query(api.accounts.me, {});
  await user.as.mutation(api.sync.syncJournal, {
    scope,
    since: 0,
    visits: [],
    saves: [
      {
        localId: args.localId,
        snapshot,
        objectId: args.objectId,
        savedAt: args.savedAt,
        venueId: args.venueId,
        visitLocalId: args.visitLocalId,
      },
    ],
  });
  await save();
  await save();
  expect(await object()).toMatchObject({ confirmCount: 1 });
});
it("rejects changed or foreign visit associations even when the save UUID is retried", async () => {
  const { t, args, save } = await fixture();
  await save();
  const other = await seedDevice(t);
  const foreign = await t.run((ctx) =>
    seedJournalVisit(ctx, other.deviceId, args.venueId!),
  );
  const foreignVisit = (await t.run((ctx) => ctx.db.get(foreign)))!;
  await expect(
    save({ visitLocalId: foreignVisit.localId }),
  ).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await expect(save({ visitLocalId: undefined })).rejects.toMatchObject({
    data: { code: "invalid_save" },
  });
  const venueId = await t.run(seedMuseum);
  await expect(save({ venueId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});

it("deduplicates attributable confirmation events by save and refuses a work outside the actual scan candidates", async () => {
  const { t, user, args, save } = await fixture();
  const first = await save();
  await save();
  expect(
    await t.run((ctx) => ctx.db.query("feedbackEvents").collect()),
  ).toMatchObject([
    {
      kind: "confirmation",
      deviceId: user.deviceId,
      scanId: args.scanId,
      objectId: args.objectId,
      saveId: first.collectionId,
    },
  ]);
  const other = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(
    save({
      localId: crypto.randomUUID(),
      objectId: other.objectId,
      artworkId: other.artworkId,
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_object" } });
  expect(await t.run((ctx) => ctx.db.get(other.objectId))).toMatchObject({
    confirmCount: 0,
  });
});

it("replays confirmations after a device ban without altering private journal snapshots", async () => {
  vi.useFakeTimers();
  const { t, user, save, object, rows } = await fixture();
  await save();
  const before = await rows();
  await t.mutation(internal.revert.revertDevice, {
    deviceId: user.deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await object()).toMatchObject({ confirmCount: 0 });
  expect(await rows()).toEqual(before);
  vi.useRealTimers();
});

it("saves a scan identified before its museum visit existed into that visit and still confirms it, but not a scan from elsewhere", async () => {
  const { t, user, venueId, work, save, object, rows } = await fixture();
  const best = {
    objectId: work.objectId,
    artworkId: work.artworkId,
    probability: 0.95,
    identityStatus: "established" as const,
  };
  const visitless = await t.run((ctx) =>
    seedScan(ctx, { deviceId: user.deviceId, venueId, best }),
  );
  const { collectionId } = await save({
    scanId: visitless,
    localId: crypto.randomUUID(),
  });
  expect((await rows()).find((row) => row._id === collectionId)).toMatchObject({
    scanId: visitless,
    venueId,
    visitLocalId: expect.any(String),
    confirmationRecorded: true,
  });
  expect(await object()).toMatchObject({ confirmCount: 1 });
  const elsewhere = await t.run((ctx) =>
    seedScan(ctx, { deviceId: user.deviceId, best }),
  );
  await expect(
    save({ scanId: elsewhere, localId: crypto.randomUUID() }),
  ).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});
