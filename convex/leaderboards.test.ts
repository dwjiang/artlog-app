import { afterEach, expect, it, vi } from "vitest";

import type { JournalSave } from "../shared/journal/contracts";
import { rankScores } from "../shared/social/leaderboard";
import { api } from "./_generated/api";
import { fileStorage } from "./lib/fileStorage";
import { socialUser, befriend } from "./lib/socialTestFixtures";
import {
  seedPublishedContribution,
  seedMuseum,
  seedContribution,
  seedDevice,
  seedArtworkWithObject,
} from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

it("keeps lifetime scores and zero-score participants across months and years", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  const t = harness();
  const ada = await socialUser(t, "Ada");
  await socialUser(t, "Ben");
  await ada.as.mutation(api.sync.syncJournal, {
    scope: ada.scope,
    since: 0,
    visits: [],
    saves: [artworkSave(Date.UTC(2020, 0, 1)), artworkSave()],
  });
  for (const date of ["2026-09-26T12:00:00Z", "2026-10-01T12:00:00Z", "2027-01-01T12:00:00Z"]) {
    vi.setSystemTime(new Date(date));
    const board = await t.query(api.leaderboards.list, { audience: "global", metric: "artworks" });
    expect(board.rows.map(({ profile, score }) => [profile.name, score])).toEqual([
      ["Ada", 2],
      ["Ben", 0],
    ]);
    const visits = await t.query(api.leaderboards.list, { audience: "global", metric: "visits" });
    expect(visits.rows.map(({ profile, score }) => [profile.name, score])).toEqual([
      ["Ada", 0],
      ["Ben", 0],
    ]);
  }
});

const artworkQuery = {
  audience: "global",
  metric: "artworks",
} as const;
const artworkSave = (savedAt = Date.now()) => ({
  localId: crypto.randomUUID(),
  savedAt,
  snapshot: { title: "PRIVATE title", artist: "PRIVATE artist" },
  note: "PRIVATE note",
});

it("counts a catalog artwork once per person across entries, objects, and save paths", async () => {
  const t = harness();
  const ada = await socialUser(t, "Ada");
  const ben = await socialUser(t, "Ben");
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const alternateObjectId = await t.run(async (ctx) => {
    const { _id, _creationTime, ...object } = (await ctx.db.get("objects", work.objectId))!;
    return ctx.db.insert("objects", { ...object, key: crypto.randomUUID() });
  });
  const saved = artworkSave();
  await ada.as.mutation(api.collections.saveToCollection, {
    localId: saved.localId,
    savedAt: saved.savedAt,
    snapshot: saved.snapshot,
    scope: ada.scope,
    objectId: work.objectId,
    artworkId: work.artworkId,
    suggested: null,
  });
  await ada.as.mutation(api.sync.syncJournal, {
    scope: ada.scope,
    since: 0,
    visits: [],
    saves: [
      { ...artworkSave(), artworkId: work.artworkId },
      { ...artworkSave(), objectId: alternateObjectId },
    ],
  });
  await ben.as.mutation(api.sync.syncJournal, {
    scope: ben.scope,
    since: 0,
    visits: [],
    saves: [{ ...artworkSave(), artworkId: work.artworkId }],
  });
  const board = await ada.as.query(api.leaderboards.list, artworkQuery);
  expect(board.rows.map(({ profile, score }) => [profile.name, score])).toEqual([
    ["Ada", 1],
    ["Ben", 1],
  ]);
  expect((await ada.as.query(api.collections.listMine, { scope: ada.scope })).page).toHaveLength(3);
});

it("keeps different catalog artworks and unidentified entries separate despite identical labels", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const first = await t.run((ctx) => seedArtworkWithObject(ctx));
  const second = await t.run((ctx) => seedArtworkWithObject(ctx));
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [
      { ...artworkSave(), artworkId: first.artworkId },
      { ...artworkSave(), artworkId: second.artworkId },
      artworkSave(),
      artworkSave(),
    ],
  });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(4);
});

it("counts each artwork once across out-of-order saves and duplicate deletions", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const current = { ...artworkSave(), artworkId };
  const older = { ...artworkSave(Date.UTC(2020, 0, 1)), artworkId };
  const duplicate = { ...current, localId: crypto.randomUUID() };
  const sync = (saves: JournalSave[]) =>
    user.as.mutation(api.sync.syncJournal, {
      scope: user.scope,
      since: 0,
      visits: [],
      saves,
    });
  const total = async () => (await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score;
  await sync([current, duplicate]);
  expect(await total()).toBe(1);
  await sync([older]);
  expect(await total()).toBe(1);
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: duplicate.localId,
  });
  expect(await total()).toBe(1);
  await sync([{ ...older, deletedAt: Date.now() }]);
  expect(await total()).toBe(1);
  await sync([older]);
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: current.localId,
  });
  expect(await total()).toBe(0);
});

it("keeps the artwork point when duplicate entries are merged and removes it with the last entry", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const first = { ...artworkSave(), artworkId };
  const second = { ...artworkSave(), artworkId };
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [first, second],
  });
  const merge = {
    scope: user.scope,
    sourceLocalId: second.localId,
    targetLocalId: first.localId,
  };
  await user.as.mutation(api.artworkAlbums.merge, merge);
  await user.as.mutation(api.artworkAlbums.merge, merge);
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: first.localId,
  });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(0);
});

it("deduplicates guest saves against the account journal when claiming another device", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const device = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [{ ...artworkSave(), artworkId }],
  });
  await device.as.mutation(api.sync.syncJournal, {
    scope: device.scope,
    since: 0,
    visits: [],
    saves: [
      { ...artworkSave(Date.UTC(2020, 0, 1)), artworkId },
      { ...artworkSave(), artworkId },
    ],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("devices", device.deviceId, { accountId: user.accountId });
    await ctx.db.insert("journalClaims", {
      deviceId: device.deviceId,
      accountId: user.accountId,
      phase: "saves",
    });
  });
  const scope = `account:${user.accountId}:0`;
  while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}
  await device.as.mutation(api.journalClaims.resume, { scope });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
});

it("rejects an artwork identity that conflicts with the saved object", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const first = await t.run((ctx) => seedArtworkWithObject(ctx));
  const second = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(
    user.as.mutation(api.sync.syncJournal, {
      scope: user.scope,
      since: 0,
      visits: [],
      saves: [
        {
          ...artworkSave(),
          objectId: first.objectId,
          artworkId: second.artworkId,
        },
      ],
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_artwork" } });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(0);
});

it("counts lifetime saved artworks once across retries and edits", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const current = artworkSave();
  const older = artworkSave(Date.UTC(2020, 0, 1));
  const sync = (saves: ReturnType<typeof artworkSave>[]) =>
    user.as.mutation(api.sync.syncJournal, {
      scope: user.scope,
      since: 0,
      visits: [],
      saves,
    });
  await sync([current, older]);
  await sync([current]);
  await sync([{ ...current, note: "Edited private note" }]);
  const board = await user.as.query(api.leaderboards.list, artworkQuery);
  expect(board.rows[0].score).toBe(2);
  expect(JSON.stringify(board)).not.toMatch(/PRIVATE|snapshot|savedAt|note|localId/);
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: current.localId,
  });
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: current.localId,
  });
  await sync([current]);
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
});

it("updates artwork totals for sync deletions and album merges without counting extra photos", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const first = artworkSave();
  const second = artworkSave();
  const deleted = { ...artworkSave(), deletedAt: Date.now() };
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [first, second, deleted],
  });
  await user.as.mutation(api.artworkAlbums.sync, {
    scope: user.scope,
    since: 0,
    encounters: [],
    photos: ["full", "detail"].map((kind) => ({
      localId: crypto.randomUUID(),
      savedLocalId: first.localId,
      kind: kind as "full" | "detail",
      capturedAt: Date.now(),
    })),
  });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(2);
  const merge = {
    scope: user.scope,
    sourceLocalId: second.localId,
    targetLocalId: first.localId,
  };
  await user.as.mutation(api.artworkAlbums.merge, merge);
  await user.as.mutation(api.artworkAlbums.merge, merge);
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
  await user.as.mutation(api.sync.syncJournal, {
    scope: user.scope,
    since: 0,
    visits: [],
    saves: [{ ...first, deletedAt: Date.now() }],
  });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(0);
});

it("counts device artworks once when claimed, excluding deleted entries and respecting opt-out", async () => {
  const t = harness();
  const user = await socialUser(t, "Ada");
  const device = await seedDevice(t);
  await device.as.mutation(api.sync.syncJournal, {
    scope: device.scope,
    since: 0,
    visits: [],
    saves: [artworkSave(), { ...artworkSave(), deletedAt: Date.now() }],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("devices", device.deviceId, { accountId: user.accountId });
    await ctx.db.insert("journalClaims", {
      deviceId: device.deviceId,
      accountId: user.accountId,
      phase: "visits",
    });
  });
  const scope = `account:${user.accountId}:0`;
  while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}
  await device.as.mutation(api.journalClaims.resume, { scope });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
  await user.as.mutation(api.leaderboards.setPreference, { visibility: "off" });
  expect((await t.query(api.leaderboards.list, artworkQuery)).rows).toEqual([]);
  await user.as.mutation(api.leaderboards.setPreference, {
    visibility: "global",
  });
  expect((await user.as.query(api.leaderboards.list, artworkQuery)).rows[0].score).toBe(1);
});

it("ranks equal totals together, skips following positions, and sorts ties by name", () => {
  expect(
    rankScores([
      { score: 4, name: "Zoe", username: "z" },
      { score: 8, name: "Ada", username: "a" },
      { score: 4, name: "Ben", username: "b" },
      { score: 1, name: "Cam", username: "c" },
    ]).map(({ name, rank }) => [name, rank]),
  ).toEqual([
    ["Ada", 1],
    ["Ben", 2],
    ["Zoe", 2],
    ["Cam", 4],
  ]);
});

it("joins both boards by default and enforces opt-out, friends-only, and block visibility", async () => {
  const t = harness();
  const a = await socialUser(t, "Ada");
  const b = await socialUser(t, "Ben");
  const c = await socialUser(t, "Cam");
  const query = {
    metric: "visits" as const,
    audience: "friends" as const,
  };
  expect(await a.as.query(api.leaderboards.preference, {})).toBe("global");
  await befriend(a, b);
  await b.as.mutation(api.leaderboards.setPreference, {
    visibility: "friends",
  });
  await c.as.mutation(api.leaderboards.setPreference, { visibility: "global" });
  expect((await a.as.query(api.leaderboards.list, query)).rows.map((row) => row.profile.name)).toEqual(["Ada", "Ben"]);
  expect(
    (await a.as.query(api.leaderboards.list, { ...query, audience: "global" })).rows.map((row) => row.profile.name),
  ).toEqual(["Ada", "Cam"]);
  await a.as.mutation(api.leaderboards.setPreference, { visibility: "off" });
  expect(await a.as.query(api.leaderboards.preference, {})).toBe("off");
  await a.as.mutation(api.friendships.block, {
    profileId: b.profileId,
    revision: 2,
    blockRevision: 0,
  });
  expect((await a.as.query(api.leaderboards.list, query)).rows).toEqual([]);
});

it("lets guests browse only opted-in Global profiles without exposing private activity", async () => {
  const t = harness();
  const global = await socialUser(t, "Global");
  const friends = await socialUser(t, "Friends");
  const off = await socialUser(t, "Off");
  await off.as.mutation(api.leaderboards.setPreference, { visibility: "off" });
  await global.as.mutation(api.leaderboards.setPreference, {
    visibility: "global",
  });
  await friends.as.mutation(api.leaderboards.setPreference, {
    visibility: "friends",
  });
  const query = {
    metric: "visits" as const,
    audience: "global" as const,
  };
  const board = await t.query(api.leaderboards.list, query);
  expect(board.visibility).toBe("off");
  expect(board.rows.map((row) => row.profile.name)).toEqual(["Global"]);
  expect(JSON.stringify(board)).not.toMatch(/accountId|deviceId|visitedOn|reflection|venueId/);
  const guest = await seedDevice(t);
  expect(await guest.as.query(api.leaderboards.list, query)).toEqual(board);
  await expect(t.query(api.leaderboards.list, { ...query, audience: "friends" })).rejects.toThrow("unauthenticated");
  await expect(guest.as.query(api.leaderboards.list, { ...query, audience: "friends" })).rejects.toThrow(
    "apple_sign_in_required",
  );
});

it("continues to hide blocked, inactive, and removed profiles from Global", async () => {
  const t = harness();
  const viewer = await socialUser(t, "Viewer");
  const blocked = await socialUser(t, "Blocked");
  const inactive = await socialUser(t, "Inactive");
  for (const person of [viewer, blocked, inactive]) {
    await person.as.mutation(api.leaderboards.setPreference, {
      visibility: "global",
    });
  }
  await viewer.as.mutation(api.friendships.block, {
    profileId: blocked.profileId,
    revision: 0,
    blockRevision: 0,
  });
  await t.run((ctx) => ctx.db.patch("profiles", inactive.profileId, { active: false }));
  const query = {
    metric: "visits" as const,
    audience: "global" as const,
  };
  expect((await viewer.as.query(api.leaderboards.list, query)).rows.map((row) => row.profile.name)).toEqual(["Viewer"]);
  await t.run((ctx) => ctx.db.delete("accounts", blocked.accountId));
  expect((await t.query(api.leaderboards.list, query)).rows.map((row) => row.profile.name)).toEqual(["Viewer"]);
});

it("deduplicates museum days across backdated visits and venue changes", async () => {
  const t = harness();
  const a = await socialUser(t, "Ada");
  const venueId = await t.run(seedMuseum);
  await a.as.mutation(api.leaderboards.setPreference, { visibility: "global" });
  const day = "2026-09-01";
  const first = {
    visibility: "public" as const,
    localId: crypto.randomUUID(),
    venueId,
    visitedOn: day,
    timeZone: "UTC",
    reflection: "PRIVATE reflection",
  };
  const second = { ...first, localId: crypto.randomUUID() };
  const upsert = (visit: typeof first) => a.as.mutation(api.visits.upsertJournal, { scope: a.scope, visit });
  await upsert(first);
  await upsert(second);
  await upsert(first);
  const query = {
    metric: "visits" as const,
    audience: "global" as const,
  };
  const board = await a.as.query(api.leaderboards.list, query);
  expect(board.rows[0].score).toBe(1);
  expect(JSON.stringify(board)).not.toMatch(/PRIVATE|venueId|visitedOn/);
  await upsert({ ...first, visitedOn: "2020-01-01" });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(2);
  await upsert({ ...second, visitedOn: "2020-01-01" });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(1);
  const otherVenue = await t.run(seedMuseum);
  await upsert({ ...second, venueId: otherVenue, visitedOn: "2020-01-01" });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(2);
  await upsert({ ...first, venueId: otherVenue, visitedOn: "2020-01-01" });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(1);
});

it("keeps shared index activity separate from artwork totals", async () => {
  const t = harness();
  const a = await socialUser(t, "Ada");
  await a.as.mutation(api.leaderboards.setPreference, { visibility: "global" });
  await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const cropStorageId = await fileStorage.store(ctx, new Blob(["crop"], { type: "image/jpeg" }));
    const id = await seedContribution(ctx, {
      deviceId: a.deviceId,
      venueId,
      cropStorageId,
    });
    await seedPublishedContribution(ctx, (await ctx.db.get("contributions", id))!);
  });
  expect(
    (
      await a.as.query(api.leaderboards.list, {
        audience: "global",
        metric: "artworks",
      })
    ).rows[0].score,
  ).toBe(0);
});

it(
  "finds the highest scores beyond the first 1,000 profiles with a bounded top-100 read",
  { timeout: 60_000 },
  async () => {
    const t = harness({ transactionLimits: { documentsRead: 500 } });
    const viewer = await socialUser(t, "Viewer");
    const template = (await t.run((ctx) => ctx.db.get("profiles", viewer.profileId)))!;
    const { _id, _creationTime, ...profile } = template;
    for (let start = 0; start < 1005; start += 20) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(start + 20, 1005); i++) {
          const accountId = await ctx.db.insert("accounts", { appleUserId: `rank-${i}` });
          await ctx.db.insert("profiles", { ...profile, accountId, username: `rank_${i}`, name: `Rank ${i}` });
          const score = (await ctx.db
            .query("leaderboardScores")
            .withIndex("by_account_metric", (q) => q.eq("accountId", accountId).eq("metric", "visits"))
            .unique())!;
          await ctx.db.patch("leaderboardScores", score._id, { score: i + 1 });
        }
      });
    }
    const query = { metric: "visits" as const, audience: "global" as const };
    const result = await viewer.as.query(api.leaderboards.list, query);
    expect(result.rows).toHaveLength(100);
    expect(result.rows[0]).toMatchObject({ profile: { name: "Rank 1004" }, score: 1005, rank: 1 });
    await t.run(async (ctx) => {
      const leader = (await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", "rank_1004"))
        .unique())!;
      await ctx.db.patch("profiles", leader._id, { leaderboardVisibility: "off" });
    });
    expect((await viewer.as.query(api.leaderboards.list, query)).rows[0]).toMatchObject({ score: 1004 });
  },
);
