import { expect, it } from "vitest";

import example from "../shared/sources/fixtures/checklist-example.json";
import { internal } from "./_generated/api";
import { seedArtworkWithObject, seedMuseum } from "./lib/testFactories";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { harness } from "./test.helpers";

async function fixture() {
  const t = harness({ transactionLimits: true });
  const seeded = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx, {
      key: "example:venue",
      lat: 37.78,
      lng: -122.4,
    });
    const ownerId = await seedMuseum(ctx, { key: "example:lender" });
    const work = await seedArtworkWithObject(ctx, {
      artwork: { wikidataId: "Q123" },
      object: { key: "example:object", ownerId, accession: "2026.1" },
      placement: {
        venueId: ownerId,
        onView: true,
        source: "wikidata",
        confidence: 0.9,
      },
    });
    return { venueId, ownerId, ...work };
  });
  return { t, ...seeded };
}

it("resolves every identity mode, deduplicates objects, preserves provenance and retries without writes", async () => {
  const { t, objectId, venueId } = await fixture();
  expect(await t.mutation(internal.checklists.ingestChecklist, example)).toEqual({
    placed: 1,
    unresolved: [],
  });
  const rows = await t.run((ctx) => ctx.db.query("placements").collect());
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({
    objectId,
    venueId,
    gallery: "Gallery 2",
    onView: true,
    source: "checklist",
    confidence: 0.85,
    from: Date.parse("2026-10-01T07:00:00Z"),
    to: Date.parse("2026-10-31T06:59:59.999Z"),
    exhibition: { ...example.exhibition, timeZone: "America/Los_Angeles" },
  });
  expect(await t.mutation(internal.checklists.ingestChecklist, example)).toEqual({
    placed: 1,
    unresolved: [],
  });
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toEqual(rows);
  expect(await t.query(internal.ingest.counts, {})).toMatchObject({
    placements: 1,
  });
});

it.each(example.works)("resolves an individual work: %j", async (input) => {
  const { t } = await fixture();
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works: [input],
    }),
  ).toEqual({ placed: 1, unresolved: [] });
});

it("refuses ambiguous physical objects, then resolves an owner and accession disambiguator", async () => {
  const { t, artworkId, objectId, ownerId } = await fixture();
  await t.run(async (ctx) => {
    const object = (await ctx.db.get("objects", objectId))!;
    const { _id, _creationTime, ...fields } = object;
    await ctx.db.insert("objects", {
      ...fields,
      key: "second",
      accession: "2026.2",
    });
  });
  for (const input of [{ wikidataId: "Q123" }, { wikidataId: "Q123", ownerKey: "example:lender" }]) {
    expect(
      await t.mutation(internal.checklists.ingestChecklist, {
        ...example,
        works: [input],
      }),
    ).toEqual({
      placed: 0,
      unresolved: [{ input, reason: "ambiguous_object" }],
    });
  }
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works: [{ wikidataId: "Q123", ownerKey: "example:lender", accession: "2026.1" }],
    }),
  ).toEqual({ placed: 1, unresolved: [] });
  expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
    artworkId,
    ownerId,
  });
});

it("limits matches within the requested owner when an edition has over 100 objects", async () => {
  const { t, objectId } = await fixture();
  await t.run(async (ctx) => {
    const elsewhere = await seedMuseum(ctx);
    const { _id, _creationTime, ...object } = (await ctx.db.get("objects", objectId))!;
    for (let i = 0; i < 100; i++) {
      await ctx.db.insert("objects", { ...object, key: `copy-${i}`, ownerId: elsewhere });
    }
  });
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works: [{ wikidataId: "Q123", ownerKey: "example:lender" }],
    }),
  ).toEqual({ placed: 1, unresolved: [] });
  const input = { wikidataId: "Q123" };
  expect(await t.mutation(internal.checklists.ingestChecklist, { ...example, works: [input] })).toEqual({
    placed: 0,
    unresolved: [{ input, reason: "too_many_matches" }],
  });
});

it("reports missing identities and unindexed title matches instead of guessing", async () => {
  const { t } = await fixture();
  const works = [
    { objectKey: "missing" },
    { wikidataId: "Q404" },
    { wikidataId: "Q123", ownerKey: "missing" },
    { title: "Water Lilies", artist: "Claude Monet" },
    {
      title: "Water Lilies",
      artist: "Claude Monet",
      ownerKey: "example:lender",
      accession: "404",
    },
  ];
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works,
    }),
  ).toEqual({
    placed: 0,
    unresolved: works.map((input, i) => ({
      input,
      reason: [
        "object_not_found",
        "artwork_not_found",
        "owner_not_found",
        "title_artist_unindexed",
        "object_not_found",
      ][i],
    })),
  });
});

it.each(["reverted", "mergedInto"] as const)("does not place %s objects through any identity mode", async (field) => {
  const { t, objectId } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch("objects", objectId, field === "reverted" ? { reverted: true } : { mergedInto: objectId }),
  );
  const result = await t.mutation(internal.checklists.ingestChecklist, example);
  expect(result.placed).toBe(0);
  expect(result.unresolved).toHaveLength(3);
});

it("closes only overlapping checklist rows for the resolved object at the same venue", async () => {
  const { t, objectId, ownerId } = await fixture();
  const elsewhere = await t.run((ctx) =>
    ctx.db.insert("placements", {
      identityStatus: "established",
      objectId,
      venueId: ownerId,
      source: "checklist",
      onView: true,
      confidence: 0.85,
    }),
  );
  await t.mutation(internal.checklists.ingestChecklist, example);
  const changed = {
    ...example,
    exhibition: { ...example.exhibition, from: "2026-10-15", to: "2026-11-15" },
  };
  await t.mutation(internal.checklists.ingestChecklist, changed);
  await t.mutation(internal.checklists.ingestChecklist, {
    ...example,
    exhibition: { ...example.exhibition, from: "2026-12-01", to: "2026-12-31" },
  });
  const rows = await t.run((ctx) => ctx.db.query("placements").collect());
  expect(rows).toHaveLength(5);
  expect(rows[2].closedAt).toEqual(expect.any(Number));
  expect(rows.filter((row) => row.closedAt !== undefined)).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.get("placements", elsewhere))).not.toHaveProperty("closedAt");
});

it.each([
  { source: "wikidata", onView: true },
  { source: "feed", onView: false },
] as const)(
  "identify loads the loan within its dates and the $source home outside them (onView: $onView)",
  async (home) => {
    const { t, vectorId, objectId, venueId, ownerId } = await fixture();
    const homePlacement = await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("placements")
        .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
        .unique())!;
      await ctx.db.patch("placements", row._id, home);
      return ctx.db.get("placements", row._id);
    });
    await t.mutation(internal.checklists.ingestChecklist, example);
    for (const [instant, expectedVenue] of [
      ["2026-10-01T06:59:59.999Z", ownerId],
      ["2026-10-01T07:00:00Z", venueId],
      ["2026-10-31T06:59:59.999Z", venueId],
      ["2026-10-31T07:00:00Z", ownerId],
    ] as const) {
      const [candidate] = await t.query(internal.identify.loadCandidates, {
        recordIds: [searchRecordId((await t.run((ctx) => ctx.db.get("vectors", vectorId)))!)],
        scores: [1],
        now: Date.parse(instant),
      });
      expect(candidate.placement?.venueId).toBe(expectedVenue);
      expect(candidate.object.ownerId).toBe(ownerId);
    }
    expect(await t.run((ctx) => ctx.db.get("placements", homePlacement!._id))).toEqual(homePlacement);
  },
);

it("includes a 25-hour closing day across a daylight-saving transition", async () => {
  const { t } = await fixture();
  await t.mutation(internal.checklists.ingestChecklist, {
    ...example,
    exhibition: { ...example.exhibition, from: "2026-11-01", to: "2026-11-01" },
  });
  const rows = await t.run((ctx) => ctx.db.query("placements").collect());
  expect(rows[1]).toMatchObject({
    from: Date.parse("2026-11-01T07:00:00Z"),
    to: Date.parse("2026-11-02T07:59:59.999Z"),
  });
});

it.each([
  { from: "2026-02-30", to: "2026-03-01" },
  { from: "unknown", to: "2026-10-30" },
  { from: "2026-11-01", to: "2026-10-30" },
  { from: "2026-1-01", to: "2026-10-30" },
])("rejects invalid exhibition dates atomically: %j", async (dates) => {
  const { t } = await fixture();
  await expect(
    t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      exhibition: { ...example.exhibition, ...dates },
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_checklist_window" } });
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toHaveLength(1);
});

it("rejects missing hosts, invalid sources, and oversized requests before writing", async () => {
  const { t } = await fixture();
  for (const [args, code] of [
    [{ ...example, venueKey: "missing" }, "venue_not_found"],
    [
      {
        ...example,
        exhibition: { ...example.exhibition, sourceUrl: "not a URL" },
      },
      "invalid_checklist_source",
    ],
    [{ ...example, works: Array(101).fill(example.works[0]) }, "checklist_too_large"],
  ] as const) {
    await expect(t.mutation(internal.checklists.ingestChecklist, args)).rejects.toMatchObject({
      data: { code },
    });
  }
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toHaveLength(1);
});

it("an owner disambiguator selects that lender’s object and does not change unlisted works", async () => {
  const { t, artworkId, objectId, ownerId, venueId } = await fixture();
  const unlisted = await t.run(async (ctx) => {
    const other = await seedArtworkWithObject(ctx, {
      placement: {
        venueId,
        source: "checklist",
        onView: true,
        confidence: 0.85,
      },
    });
    await ctx.db.patch("objects", other.objectId, { artworkId });
    return ctx.db
      .query("placements")
      .withIndex("by_objectId", (q) => q.eq("objectId", other.objectId))
      .unique();
  });
  const input = { wikidataId: "Q123" };
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works: [input],
    }),
  ).toEqual({ placed: 0, unresolved: [{ input, reason: "ambiguous_object" }] });
  expect(
    await t.mutation(internal.checklists.ingestChecklist, {
      ...example,
      works: [{ ...input, ownerKey: "example:lender" }],
    }),
  ).toEqual({ placed: 1, unresolved: [] });
  expect(await t.run((ctx) => ctx.db.get("placements", unlisted!._id))).toEqual(unlisted);
  expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({ ownerId });
});

it("refuses a host that opted out", async () => {
  const { t, venueId } = await fixture();
  await t.run((ctx) => ctx.db.patch("museums", venueId, { optOut: true }));
  await expect(t.mutation(internal.checklists.ingestChecklist, example)).rejects.toMatchObject({
    data: { code: "venue_opted_out" },
  });
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toHaveLength(1);
});
