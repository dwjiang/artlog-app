import type { Infer } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { exhibitionImport } from "./lib/exhibitionValidators";
import { seedMuseum } from "./lib/testFactories";
import { harness } from "./test.helpers";

type Import = Infer<typeof exhibitionImport>;
const NOW = Date.parse("2026-10-09T19:00:00Z");
const VENUE_KEY = "wikidata:verified-museum";

function exhibition(overrides: Partial<Import> = {}): Import {
  return {
    venueKey: VENUE_KEY,
    title: "Between Worlds",
    sourceUrl: "https://museum.example/exhibitions/between-worlds",
    sourceSha256: "a".repeat(64),
    checkedAt: NOW - 1000,
    timeZone: "America/Los_Angeles",
    viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
    ...overrides,
  };
}

async function fixture(overrides = {}) {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness();
  const museumId = await t.run((ctx) =>
    seedMuseum(ctx, {
      key: VENUE_KEY,
      name: "Verified Museum",
      website: "https://museum.example",
      lat: 37.785,
      lng: -122.401,
      city: "San Francisco",
      country: "US",
      ...overrides,
    }),
  );
  return { t, museumId };
}

afterEach(() => vi.restoreAllMocks());

describe("verified exhibition import", () => {
  it("resolves the deployment's museum key and keeps one row on exact retries", async () => {
    const { t, museumId } = await fixture();
    const record = exhibition();
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [record] })).toEqual({
      inserted: 1,
      updated: 0,
      unchanged: 0,
    });
    const first = await t.query(internal.exhibitions.exportPage, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(first.page).toEqual([
      expect.objectContaining({ ...record, museumId, finalEndAt: Date.parse("2026-11-01T06:59:59.999Z") }),
    ]);
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [record] })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(await t.query(internal.exhibitions.exportPage, { paginationOpts: { numItems: 10, cursor: null } })).toEqual(
      first,
    );
  });

  it("replaces revised dates without duplicating a show and rejects older or simultaneous conflicting evidence", async () => {
    const { t } = await fixture();
    const original = exhibition();
    await t.action(internal.exhibitions.upsertBatch, { records: [original] });
    const updated = exhibition({
      checkedAt: NOW,
      sourceSha256: "b".repeat(64),
      viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-11-02" }],
    });
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [updated] })).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    await expect(t.action(internal.exhibitions.upsertBatch, { records: [original] })).rejects.toThrow(
      "stale_exhibition",
    );
    await expect(
      t.action(internal.exhibitions.upsertBatch, { records: [{ ...updated, sourceSha256: "c".repeat(64) }] }),
    ).rejects.toThrow("timestamp_collision");
    const exported = await t.query(internal.exhibitions.exportPage, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(exported.page).toHaveLength(1);
    expect(exported.page[0]).toMatchObject(updated);
  });

  it("rolls back all rows when any venue is missing", async () => {
    const { t } = await fixture();
    await expect(
      t.action(internal.exhibitions.upsertBatch, {
        records: [exhibition(), exhibition({ venueKey: "missing", title: "Unknown" })],
      }),
    ).rejects.toThrow("not_found");
    expect(
      (await t.query(internal.exhibitions.exportPage, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([]);
  });

  it("updates and removes images without revising source evidence, rejecting stale or conflicting image checks", async () => {
    const { t } = await fixture();
    const original = exhibition();
    await t.action(internal.exhibitions.upsertBatch, { records: [original] });
    const enriched = { ...original, imageUrl: "https://museum.example/show.jpg", imageCheckedAt: NOW };
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [enriched] })).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [enriched] })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(await t.action(internal.exhibitions.upsertBatch, { records: [original] })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
    await expect(
      t.action(internal.exhibitions.upsertBatch, {
        records: [{ ...enriched, imageUrl: "https://museum.example/other.jpg" }],
      }),
    ).rejects.toThrow("image_timestamp_collision");
    await expect(
      t.action(internal.exhibitions.upsertBatch, { records: [{ ...enriched, imageCheckedAt: NOW - 1 }] }),
    ).rejects.toThrow("stale_image");
    await expect(
      t.action(internal.exhibitions.upsertBatch, {
        records: [{ ...enriched, imageCheckedAt: NOW + 1, sourceSha256: "b".repeat(64) }],
      }),
    ).rejects.toThrow("timestamp_collision");
    const cleared = { ...original, imageCheckedAt: NOW + 1 };
    await t.action(internal.exhibitions.upsertBatch, { records: [cleared] });
    const [stored] = await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY] });
    expect(stored).toMatchObject(cleared);
    expect(stored.imageUrl).toBeUndefined();
    await expect(t.action(internal.exhibitions.upsertBatch, { records: [enriched] })).rejects.toThrow("stale_image");
  });

  it.each(["flag", "registry"] as const)("refuses opted-out venues via %s", async (kind) => {
    const { t, museumId } = await fixture({ optOut: kind === "flag" });
    if (kind === "registry") {
      await t.run((ctx) =>
        ctx.db.insert("optOuts", {
          target: { kind: "venue", venueId: museumId },
          requester: "museum",
          receivedAt: NOW,
        }),
      );
    }
    await expect(t.action(internal.exhibitions.upsertBatch, { records: [exhibition()] })).rejects.toThrow(
      "venue_opted_out",
    );
  });

  it("accepts official subdomains and preserves closing-only dates and explicit closure gaps", async () => {
    const { t } = await fixture();
    const record = exhibition({
      sourceUrl: "https://exhibitions.museum.example/between-worlds",
      viewingPeriods: [
        { startDate: null, endDate: "2026-10-31" },
        { startDate: "2026-11-03", endDate: "2026-11-30" },
      ],
    });
    await t.action(internal.exhibitions.upsertBatch, { records: [record] });
    expect(
      (await t.query(internal.exhibitions.exportPage, { paginationOpts: { numItems: 10, cursor: null } })).page[0],
    ).toMatchObject(record);
  });

  it.each([
    { title: " " },
    { title: " Between Worlds" },
    { venueKey: "" },
    { sourceUrl: "http://museum.example/exhibitions" },
    { sourceUrl: "https://museum.example.evil/exhibitions" },
    { sourceUrl: "https://user:secret@museum.example/exhibitions" },
    { sourceSha256: "invented" },
    { imageUrl: "http://cdn.museum.example/show.jpg" },
    { imageUrl: "https://user:secret@cdn.museum.example/show.jpg" },
    { imageUrl: "default image here" },
    { checkedAt: -1 },
    { checkedAt: NOW + 60001 },
    { imageCheckedAt: -1 },
    { imageCheckedAt: NOW + 60001 },
    { timeZone: "America/New_York" },
    { viewingPeriods: [] },
    { viewingPeriods: [{ startDate: "2026-02-30", endDate: "2026-10-31" }] },
    { viewingPeriods: [{ startDate: "2026-11-01", endDate: "2026-10-31" }] },
    {
      viewingPeriods: [
        { startDate: "2026-10-01", endDate: "2026-10-31" },
        { startDate: "2026-10-31", endDate: "2026-11-30" },
      ],
    },
    {
      viewingPeriods: [
        { startDate: "2026-10-01", endDate: "2026-10-31" },
        { startDate: null, endDate: "2026-11-30" },
      ],
    },
  ])("refuses invalid or untrusted evidence %j", async (invalid) => {
    const { t } = await fixture();
    await expect(t.action(internal.exhibitions.upsertBatch, { records: [exhibition(invalid)] })).rejects.toThrow(
      "exhibition_metadata",
    );
  });

  it("refuses duplicate normalized titles in the same batch", async () => {
    const { t } = await fixture();
    await expect(
      t.action(internal.exhibitions.upsertBatch, {
        records: [exhibition(), exhibition({ title: "BETWEEN WORLDS" })],
      }),
    ).rejects.toThrow("duplicate_entry");
  });

  it("bounds the import batch", async () => {
    const { t } = await fixture();
    await expect(
      t.action(internal.exhibitions.upsertBatch, {
        records: Array.from({ length: 101 }, (_, index) => exhibition({ title: `Show ${index}` })),
      }),
    ).rejects.toThrow("batch_too_large");
  });

  it("preflights local venues and reads back exact provenance without merging shared museum listings", async () => {
    const { t, museumId } = await fixture();
    const secondId = await t.run((ctx) =>
      seedMuseum(ctx, {
        key: "wikidata:second-museum",
        name: "Second Museum",
        website: "https://museum.example",
        lat: 37.785,
        lng: -122.401,
      }),
    );
    const records = [exhibition(), exhibition({ venueKey: "wikidata:second-museum" })];
    const venueKeys = records.map((record) => record.venueKey);
    expect(await t.query(internal.exhibitions.venuesForImport, { venueKeys })).toEqual([
      { venueKey: VENUE_KEY, museumId, name: "Verified Museum", timeZone: "America/Los_Angeles", optOut: false },
      {
        venueKey: "wikidata:second-museum",
        museumId: secondId,
        name: "Second Museum",
        timeZone: "America/Los_Angeles",
        optOut: false,
      },
    ]);
    await t.action(internal.exhibitions.upsertBatch, { records });
    const exported = await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys });
    expect(exported).toEqual([
      expect.objectContaining({ ...records[0], museumId }),
      expect.objectContaining({ ...records[1], museumId: secondId }),
    ]);
    expect(exported[0].exhibitionId).not.toEqual(exported[1].exhibitionId);
    await expect(t.query(internal.exhibitions.venuesForImport, { venueKeys: ["missing"] })).rejects.toThrow(
      "not_found",
    );
    await expect(
      t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY, VENUE_KEY] }),
    ).rejects.toThrow("duplicate_entry");
  });
});

describe("Explore region catalog", () => {
  const REGION = "sf-bay-area";

  it("hides audited museums and shows from discovery while retaining their records and imported evidence", async () => {
    const { t, museumId } = await fixture({ region: REGION });
    await t.action(internal.exhibitions.upsertBatch, { records: [exhibition()] });
    const [stored] = await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY] });
    expect((await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW })).museums).toHaveLength(1);
    await t.action(internal.museumAudit.applyBatch, {
      records: [{ key: VENUE_KEY, excludedFromDiscovery: true }],
    });
    expect(await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW })).toEqual({
      museums: [],
      exhibitions: [],
    });
    expect(await t.query(api.exhibitions.regions, { asOf: NOW })).toEqual([]);
    expect(await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).toEqual({ museums: [], exhibitions: [] });
    expect(await t.run((ctx) => ctx.db.get("museums", museumId))).toMatchObject({ excludedFromDiscovery: true });
    expect(await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY] })).toEqual([stored]);
  });

  it("lists a museum's shows and refresh schedule under its new region after a reseed moves it", async () => {
    const { t, museumId } = await fixture({ region: "country:US" });
    await t.action(internal.exhibitions.upsertBatch, { records: [exhibition()] });
    await t.run((ctx) =>
      ctx.db.insert("exhibitionRefreshes", { museumId, region: "country:US", dueAt: NOW, failures: 0 }),
    );
    const { _id, _creationTime, optOut, contributionRevision, ...row } = (await t.run((ctx) =>
      ctx.db.get("museums", museumId),
    ))!;
    await t.mutation(internal.ingest.upsertMuseums, { rows: [{ ...row, region: REGION }] });
    expect((await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW })).exhibitions).toHaveLength(1);
    expect((await t.query(api.exhibitions.inRegion, { region: "country:US", asOf: NOW })).exhibitions).toEqual([]);
    expect((await t.query(api.exhibitions.regions, { asOf: NOW })).map(({ region }) => region)).toEqual([REGION]);
    const schedule = await t.run((ctx) =>
      ctx.db
        .query("exhibitionRefreshes")
        .withIndex("by_museumId", (q) => q.eq("museumId", museumId))
        .unique(),
    );
    expect(schedule).toMatchObject({ region: REGION });
  });

  it.each([false, true])("keeps saved shows readable after discovery exclusion (alias: %s)", async (alias) => {
    const { t, museumId } = await fixture({ region: REGION });
    await t.action(internal.exhibitions.upsertBatch, { records: [exhibition()] });
    const [stored] = await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY] });
    const args = { exhibitionIds: [stored.exhibitionId], asOf: NOW };
    const before = await t.query(api.exhibitions.byIds, args);
    if (alias) await t.run((ctx) => seedMuseum(ctx, { key: "survivor" }));
    await t.action(internal.museumAudit.applyBatch, {
      records: [{ key: VENUE_KEY, excludedFromDiscovery: true, ...(alias ? { duplicateOf: "survivor" } : {}) }],
    });

    expect(await t.query(api.exhibitions.byIds, args)).toEqual(before);
    expect(await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW })).toEqual({
      museums: [],
      exhibitions: [],
    });
    expect(await t.query(api.exhibitions.byIds, { ...args, asOf: stored.finalEndAt + 1 })).toEqual({
      museums: [],
      exhibitions: [],
    });
    await t.run((ctx) =>
      ctx.db.insert("optOuts", { target: { kind: "venue", venueId: museumId }, requester: "museum", receivedAt: NOW }),
    );
    expect(await t.query(api.exhibitions.byIds, args)).toEqual({ museums: [], exhibitions: [] });
  });

  it("looks up saved exhibitions and museum details independently of a browsing region", async () => {
    const { t, museumId } = await fixture({ region: REGION });
    const otherMuseumId = await t.run((ctx) =>
      seedMuseum(ctx, {
        key: "london-museum",
        region: "london",
        name: "London Museum",
        lat: 51.5,
        lng: -0.13,
        website: "https://museum.example",
      }),
    );
    await t.action(internal.exhibitions.upsertBatch, {
      records: [exhibition(), exhibition({ venueKey: "london-museum", timeZone: "Europe/London" })],
    });
    const rows = await t.query(internal.exhibitions.exportByVenueKeys, { venueKeys: [VENUE_KEY, "london-museum"] });
    const catalog = await t.query(api.exhibitions.byIds, {
      exhibitionIds: rows.map((row) => row.exhibitionId),
      asOf: NOW,
    });
    expect(new Set(catalog.museums.map((row) => row.museumId))).toEqual(new Set([museumId, otherMuseumId]));
    expect(catalog.exhibitions).toHaveLength(2);
    const museum = await t.query(api.exhibitions.atMuseum, { museumId: otherMuseumId, asOf: NOW });
    expect(museum.museums.map((row) => row.museumId)).toEqual([otherMuseumId]);
    expect(museum.exhibitions.map((row) => row.museumId)).toEqual([otherMuseumId]);
    await t.run((ctx) =>
      ctx.db.insert("optOuts", {
        target: { kind: "venue", venueId: otherMuseumId },
        requester: "museum",
        receivedAt: NOW,
      }),
    );
    expect(
      (await t.query(api.exhibitions.byIds, { exhibitionIds: rows.map((row) => row.exhibitionId), asOf: NOW }))
        .exhibitions,
    ).toHaveLength(1);
    expect(await t.query(api.exhibitions.atMuseum, { museumId: otherMuseumId, asOf: NOW })).toEqual({
      museums: [],
      exhibitions: [],
    });
    await t.run((ctx) => ctx.db.delete("exhibitions", rows[0].exhibitionId));
    expect(
      (await t.query(api.exhibitions.byIds, { exhibitionIds: [rows[0].exhibitionId], asOf: NOW })).exhibitions,
    ).toEqual([]);
  });

  it("reads a region's shows with live museum names and inclusive local closing dates", async () => {
    const { t, museumId } = await fixture({ region: REGION });
    await t.action(internal.exhibitions.upsertBatch, {
      records: [exhibition({ viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-09" }] })],
    });
    await t.run((ctx) => ctx.db.patch("museums", museumId, { name: "Current Museum Name" }));
    const beforeLocalMidnight = Date.parse("2026-10-10T06:59:59.999Z");
    expect(await t.query(api.exhibitions.inRegion, { region: REGION, asOf: beforeLocalMidnight })).toEqual({
      museums: [{ museumId, name: "Current Museum Name", city: "San Francisco", lat: 37.785, lng: -122.401 }],
      exhibitions: [
        {
          exhibitionId: expect.any(String),
          museumId,
          title: "Between Worlds",
          sourceUrl: exhibition().sourceUrl,
          viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-09" }],
        },
      ],
    });
    expect(
      (await t.query(api.exhibitions.inRegion, { region: REGION, asOf: beforeLocalMidnight + 1 })).exhibitions,
    ).toEqual([]);
  });

  it("returns a show's preview image when the import found one", async () => {
    const { t } = await fixture({ region: REGION });
    const imageUrl = "https://images.ctfassets.example/tides.jpg";
    await t.action(internal.exhibitions.upsertBatch, {
      records: [exhibition({ imageUrl }), exhibition({ title: "No preview" })],
    });
    const { exhibitions } = await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW });
    expect(exhibitions.map((row) => [row.title, row.imageUrl])).toEqual([
      ["Between Worlds", imageUrl],
      ["No preview", undefined],
    ]);
  });

  it("keeps upcoming and temporarily closed shows while excluding fully ended ones", async () => {
    const { t } = await fixture({ region: REGION });
    const records = [
      exhibition({ title: "Ended", viewingPeriods: [{ startDate: "2026-09-01", endDate: "2026-10-08" }] }),
      exhibition({ title: "Upcoming", viewingPeriods: [{ startDate: "2026-10-10", endDate: "2026-10-31" }] }),
      exhibition({
        title: "Returns after closure",
        viewingPeriods: [
          { startDate: "2026-09-01", endDate: "2026-10-08" },
          { startDate: "2026-10-11", endDate: "2026-11-30" },
        ],
      }),
    ];
    await t.action(internal.exhibitions.upsertBatch, { records });
    const { exhibitions } = await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW });
    expect(exhibitions.map((row) => row.title)).toEqual(["Upcoming", "Returns after closure"]);
    expect(exhibitions[1].viewingPeriods).toEqual(records[2].viewingPeriods);
  });

  it("ends a viewing period at local midnight after daylight saving time changes", async () => {
    const { t } = await fixture({ region: REGION });
    await t.action(internal.exhibitions.upsertBatch, {
      records: [exhibition({ viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-11-01" }] })],
    });
    const lastMillisecond = Date.parse("2026-11-02T07:59:59.999Z");
    const shows = async (asOf: number) =>
      (await t.query(api.exhibitions.inRegion, { region: REGION, asOf })).exhibitions;
    expect(await shows(lastMillisecond)).toHaveLength(1);
    expect(await shows(lastMillisecond + 1)).toEqual([]);
  });

  it("lists each region with a show still on once, at one of its museums", async () => {
    const { t } = await fixture({ region: REGION });
    const places = [
      { key: "wikidata:second-sf", region: REGION, lat: 37.8, lng: -122.27 },
      { key: "wikidata:london", region: "london", lat: 51.5, lng: -0.13 },
      { key: "wikidata:paris", region: "paris", lat: 48.86, lng: 2.34 },
    ];
    for (const place of places) {
      await t.run((ctx) => seedMuseum(ctx, { ...place, name: place.key, website: "https://museum.example" }));
    }
    await t.action(internal.exhibitions.upsertBatch, {
      records: [
        exhibition(),
        exhibition({ venueKey: "wikidata:second-sf", timeZone: "America/Los_Angeles" }),
        exhibition({ venueKey: "wikidata:london", timeZone: "Europe/London" }),
        exhibition({
          venueKey: "wikidata:paris",
          timeZone: "Europe/Paris",
          viewingPeriods: [{ startDate: "2026-09-01", endDate: "2026-10-08" }],
        }),
      ],
    });
    expect(await t.query(api.exhibitions.regions, { asOf: NOW })).toEqual([
      { region: "london", lat: 51.5, lng: -0.13 },
      { region: REGION, lat: expect.any(Number), lng: expect.any(Number) },
    ]);
    expect((await t.query(api.exhibitions.inRegion, { region: "london", asOf: NOW })).museums).toEqual([
      expect.objectContaining({ name: "wikidata:london" }),
    ]);
  });

  it.each(["flag", "registry", "deleted"] as const)("hides imported venues later %s", async (kind) => {
    const { t, museumId } = await fixture({ region: REGION });
    await t.action(internal.exhibitions.upsertBatch, { records: [exhibition()] });
    await t.run(async (ctx) => {
      if (kind === "deleted") {
        await ctx.db.delete("museums", museumId);
      } else if (kind === "flag") {
        await ctx.db.patch("museums", museumId, { optOut: true });
      } else {
        await ctx.db.insert("optOuts", {
          target: { kind: "venue", venueId: museumId },
          requester: "museum",
          receivedAt: NOW,
        });
      }
    });
    expect(await t.query(api.exhibitions.inRegion, { region: REGION, asOf: NOW })).toEqual({
      museums: [],
      exhibitions: [],
    });
    expect(await t.query(api.exhibitions.regions, { asOf: NOW })).toEqual([]);
  });
});
