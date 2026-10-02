import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { seedArtworkWithObject, seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const DAY = "2026-10-02";

async function seedWork(
  t: Harness,
  venueId: Id<"museums">,
  title: string,
  options: {
    wikidataId?: string;
    artist?: string;
    rights?: "public_domain" | "in_copyright";
    thumbnail?: boolean;
  } = {},
) {
  return t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: {
        title,
        artist: options.artist ?? "Vincent van Gogh",
        wikidataId: options.wikidataId,
        rightsStatus: options.rights ?? "public_domain",
      },
      objectDetails: options.thumbnail === false ? { thumbnailUrl: undefined } : {},
      placement: { venueId, source: "feed", onView: false, confidence: 1 },
    }),
  );
}

async function save(
  ctx: MutationCtx,
  venueId: Id<"museums">,
  work: { artworkId: Id<"artworks">; objectId: Id<"objects"> },
  owner: { kind: "device"; deviceId: Id<"devices"> } | { kind: "account"; accountId: Id<"accounts"> },
  deviceId: Id<"devices">,
) {
  await ctx.db.insert("collections", {
    owner,
    localId: crypto.randomUUID(),
    venueId,
    artworkId: work.artworkId,
    objectId: work.objectId,
    snapshot: { title: "Work", artist: "" },
    savedAt: Date.parse(`${DAY}T12:00:00Z`) - 24 * 60 * 60 * 1000,
    updatedAt: 1,
    updatedBy: deviceId,
    changeVersion: 1,
  });
}

it("keeps each museum's best catalogue guesses, once per artwork, and only ones Home may show", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const elsewhere = await t.run((ctx) => seedMuseum(ctx));
  const famous = await seedWork(t, venueId, "Wheat Field with Cypresses", { wikidataId: "Q1373862" });
  await t.run((ctx) =>
    ctx.db.insert("placements", {
      identityStatus: "established",
      objectId: famous.objectId,
      venueId,
      source: "wikidata",
      onView: false,
      confidence: 1,
    }),
  );
  await seedWork(t, venueId, "Study of a tree", { wikidataId: "Q78655558", artist: "Unknown artist" });
  await seedWork(t, venueId, "Q114453254", { wikidataId: "Q114453254" });
  await seedWork(t, venueId, "Still in copyright", { rights: "in_copyright" });
  await seedWork(t, venueId, "No picture", { thumbnail: false });
  await seedWork(t, elsewhere, "Somewhere else");

  expect(await t.action(internal.museumPicks.rebuild, {})).toEqual({ museums: 2, picks: 3 });
  const picks = await as.query(api.museumPicks.forVenue, { venueId, day: DAY });
  expect(picks.map((pick) => pick.title)).toEqual(["Wheat Field with Cypresses", "Study of a tree"]);
  expect(picks[0]).toMatchObject({
    artworkId: famous.artworkId,
    artist: "Vincent van Gogh",
    medium: "Oil on canvas",
    thumbnailUrl: "https://museum.example/work.jpg",
    savers: 0,
  });
});

it("puts works people saved at the museum recently ahead of the guesses, ignoring demo accounts", async () => {
  const t = harness();
  const { as, deviceId } = await seedDevice(t);
  const other = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  await seedWork(t, venueId, "The famous one", { wikidataId: "Q1373862" });
  const loved = await seedWork(t, venueId, "A small favourite", { wikidataId: "Q78655558" });
  const demoPick = await seedWork(t, venueId, "Demo pick", { wikidataId: "Q78655559" });
  await t.action(internal.museumPicks.rebuild, {});
  await t.run(async (ctx) => {
    const demo = await ctx.db.insert("accounts", { provider: "apple", providerUserId: "demo:mayachen" });
    await save(ctx, venueId, loved, { kind: "device", deviceId }, deviceId);
    await save(ctx, venueId, loved, { kind: "device", deviceId: other.deviceId }, other.deviceId);
    await save(ctx, venueId, loved, { kind: "device", deviceId }, deviceId);
    for (let index = 0; index < 3; index++) {
      await save(ctx, venueId, demoPick, { kind: "account", accountId: demo }, deviceId);
    }
  });

  const picks = await as.query(api.museumPicks.forVenue, { venueId, day: DAY });
  expect(picks[0]).toMatchObject({ title: "A small favourite", savers: 2 });
  expect(picks.find((pick) => pick.title === "Demo pick")?.savers).toBe(0);
});

it("rotates the guesses by day while keeping one day's order stable", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  for (let index = 0; index < 20; index++) await seedWork(t, venueId, `Painting ${index}`, { wikidataId: "Q1373862" });
  await t.action(internal.museumPicks.rebuild, {});

  const titles = async (day: string) =>
    (await as.query(api.museumPicks.forVenue, { venueId, day })).map((pick) => pick.title);
  const today = await titles(DAY);
  expect(today).toHaveLength(10);
  expect(await titles(DAY)).toEqual(today);
  expect(await titles("2026-10-03")).not.toEqual(today);
  const tomorrow = await as.query(api.museumPicks.forVenue, { venueId, day: "2026-10-03" });
  const removedFromToday = tomorrow.find((pick) => !today.includes(pick.title));
  expect(removedFromToday).toBeDefined();
  expect(
    await as.query(api.museumPicks.forVenue, { venueId, day: DAY, artworkId: removedFromToday!.artworkId }),
  ).toEqual([removedFromToday]);
  const elsewhere = await t.run((ctx) => seedMuseum(ctx));
  expect(
    await as.query(api.museumPicks.forVenue, { venueId: elsewhere, day: DAY, artworkId: removedFromToday!.artworkId }),
  ).toEqual([]);
});

it("returns nothing for an id that is not a museum or a malformed day", async () => {
  const t = harness();
  const { as, deviceId } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  await seedWork(t, venueId, "Wheat Field with Cypresses", { wikidataId: "Q1373862" });
  await t.action(internal.museumPicks.rebuild, {});

  expect(await as.query(api.museumPicks.forVenue, { venueId: deviceId, day: DAY })).toEqual([]);
  expect(await as.query(api.museumPicks.forVenue, { venueId: "not-an-id", day: DAY })).toEqual([]);
  expect(await as.query(api.museumPicks.forVenue, { venueId, day: "today" })).toEqual([]);
});

it.each(["closed", "removed"])("clears a museum's last picks after its placements are %s", async (change) => {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const elsewhere = await t.run((ctx) => seedMuseum(ctx));
  const work = await seedWork(t, venueId, "Moved painting");
  await seedWork(t, elsewhere, "Still here");
  await t.action(internal.museumPicks.rebuild, {});
  expect(await as.query(api.museumPicks.forVenue, { venueId, day: DAY })).toHaveLength(1);
  await t.run(async (ctx) => {
    const placements = await ctx.db
      .query("placements")
      .withIndex("by_objectId", (q) => q.eq("objectId", work.objectId))
      .take(10);
    for (const placement of placements) {
      if (change === "closed") await ctx.db.patch("placements", placement._id, { closedAt: Date.now() });
      else await ctx.db.delete("placements", placement._id);
    }
  });
  await t.action(internal.museumPicks.rebuild, {});
  expect(await as.query(api.museumPicks.forVenue, { venueId, day: DAY })).toEqual([]);
  expect(await as.query(api.museumPicks.forVenue, { venueId: elsewhere, day: DAY })).toHaveLength(1);
});
