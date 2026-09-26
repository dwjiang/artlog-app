import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { MAX_BATCH_ROWS } from "./ingest";
import { seedMuseum } from "./lib/testFactories";
import { harness } from "./test.helpers";
import { CHANGES_PAGE_SIZE } from "./venueChanges";

const met = {
  key: "wikidata:Q160236",
  wikidataId: "Q160236",
  name: "The Metropolitan Museum of Art",
  lat: 40.7794,
  lng: -73.9632,
  website: "https://www.metmuseum.org",
  region: "us-ny",
  city: "New York City",
  cityKey: "wikidata:Q60",
  country: "US",
  seedSource: "wikidata" as const,
};
const moma = { ...met, key: "wikidata:Q188740", wikidataId: "Q188740", name: "Museum of Modern Art" };

describe("venue changes", () => {
  it("returns nothing for a table that is current, and keeps venues from before the log out of it", async () => {
    const t = harness();
    await t.run((ctx) => seedMuseum(ctx));
    expect(await t.query(internal.venueChanges.latestVersion, {})).toBe(0);
    expect(await t.query(api.venueChanges.list, { since: 0 })).toEqual({ venues: [], checkpoint: 0, hasMore: false });
  });

  it("sends seeded venues as journal rows, then only what changed since the phone's checkpoint", async () => {
    const t = harness();
    const { ids } = await t.mutation(internal.ingest.upsertMuseums, { rows: [met, moma] });
    const first = await t.query(api.venueChanges.list, { since: 0 });
    expect(first).toEqual({
      venues: [
        {
          id: ids[met.key],
          key: met.key,
          name: met.name,
          lat: met.lat,
          lng: met.lng,
          region: met.region,
          website: met.website,
          city: met.city,
          cityKey: met.cityKey,
          country: met.country,
        },
        expect.objectContaining({ id: ids[moma.key] }),
      ],
      checkpoint: 2,
      hasMore: false,
    });

    await t.mutation(internal.ingest.upsertMuseums, { rows: [met, moma] });
    expect(await t.query(api.venueChanges.list, { since: first.checkpoint })).toMatchObject({ venues: [] });

    await t.mutation(internal.ingest.upsertMuseums, { rows: [{ ...met, name: "The Met", website: undefined }] });
    const edited = await t.query(api.venueChanges.list, { since: first.checkpoint });
    expect(edited).toEqual({
      venues: [expect.objectContaining({ id: ids[met.key], name: "The Met" })],
      checkpoint: 3,
      hasMore: false,
    });
    expect(edited.venues[0].website).toBeUndefined();
    // An edited venue moves to its new version instead of appearing twice to a phone that is further behind.
    expect((await t.query(api.venueChanges.list, { since: 0 })).venues.map((venue) => venue.name)).toEqual([
      moma.name,
      "The Met",
    ]);
    expect(await t.run((ctx) => ctx.db.query("venueChanges").collect())).toHaveLength(2);
  });

  it("pages in version order without gaps or repeats", async () => {
    const t = harness();
    const rows = Array.from({ length: CHANGES_PAGE_SIZE + 5 }, (_, i) => ({
      ...met,
      key: `poi:${i}`,
      wikidataId: undefined,
      name: `Venue ${i}`,
    }));
    for (let start = 0; start < rows.length; start += MAX_BATCH_ROWS) {
      await t.mutation(internal.ingest.upsertMuseums, { rows: rows.slice(start, start + MAX_BATCH_ROWS) });
    }
    const first = await t.query(api.venueChanges.list, { since: 0 });
    expect(first).toMatchObject({ checkpoint: CHANGES_PAGE_SIZE, hasMore: true });
    const second = await t.query(api.venueChanges.list, { since: first.checkpoint });
    expect(second).toMatchObject({ checkpoint: CHANGES_PAGE_SIZE + 5, hasMore: false });
    expect([...first.venues, ...second.venues].map((venue) => venue.name)).toEqual(rows.map((row) => row.name));
  });

  it("sends a change made while a table was being exported after the version the export started from", async () => {
    const t = harness();
    await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    const exportedAt = await t.query(internal.venueChanges.latestVersion, {});
    await t.mutation(internal.ingest.upsertMuseums, { rows: [moma] });
    expect((await t.query(api.venueChanges.list, { since: exportedAt })).venues).toEqual([
      expect.objectContaining({ name: moma.name }),
    ]);
  });
});
