import type { Infer } from "convex/values";
import { describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { exhibitionSource } from "./lib/exhibitionSourceValidators";
import { seedMuseum } from "./lib/testFactories";
import { harness } from "./test.helpers";

type Source = Infer<typeof exhibitionSource>;

function validated(museumId: Id<"museums">, overrides: Partial<Source> = {}): Source {
  const checkedAt = Date.now();
  return {
    museumId,
    websiteSnapshot: "https://museum.example",
    status: "validated",
    urls: [
      {
        url: "https://museum.example/exhibitions",
        purpose: "combined",
        discoverySource: "navigation",
        validatedAt: checkedAt,
        evidence: "Exhibitions heading and current/upcoming exhibition cards; museum name in site header.",
        venueAssociation: "venue_specific",
      },
    ],
    outcomeReason: "Verified the exhibition listing and museum identity.",
    checkedAt,
    ...overrides,
  };
}

async function fixture(overrides: Partial<Doc<"museums">> = {}) {
  const t = harness();
  const museumId = await t.run((ctx) =>
    seedMuseum(ctx, {
      website: "https://museum.example",
      collectionSiteUrl: "https://collection.example",
      city: "Paris",
      country: "FR",
      ...overrides,
    }),
  );
  return { t, museumId };
}

describe("exhibition URL metadata storage", () => {
  it("keeps one result per museum across retries and moved listing replacements without changing museum fields", async () => {
    const { t, museumId } = await fixture();
    const museumBefore = await t.run((ctx) => ctx.db.get("museums", museumId));
    const record = validated(museumId);
    expect(await t.action(internal.exhibitionSources.upsertBatch, { records: [record] })).toEqual({
      inserted: 1,
      updated: 0,
      unchanged: 0,
    });
    expect(await t.action(internal.exhibitionSources.upsertBatch, { records: [record] })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
    const first = await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } });
    const replacement = {
      ...record,
      checkedAt: record.checkedAt + 1,
      urls: [{ ...record.urls[0], url: "https://museum.example/whats-on/exhibitions" }],
    };
    expect(await t.action(internal.exhibitionSources.upsertBatch, { records: [replacement] })).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    const saved = await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(saved.page).toEqual([{ ...first.page[0], ...replacement }]);
    expect(saved.isDone).toBe(true);
    expect(await t.run((ctx) => ctx.db.get("museums", museumId))).toEqual(museumBefore);
  });

  it("rolls back the entire batch when a museum website changed after discovery", async () => {
    const { t, museumId } = await fixture();
    const changedId = await t.run((ctx) => seedMuseum(ctx, { website: "https://moved.example" }));
    await expect(
      t.action(internal.exhibitionSources.upsertBatch, { records: [validated(museumId), validated(changedId)] }),
    ).rejects.toThrow("website_changed");
    const saved = await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(saved.page).toEqual([]);
  });

  it("keeps a newer result when an old checkpoint batch is retried", async () => {
    const { t, museumId } = await fixture();
    const record = validated(museumId);
    await t.action(internal.exhibitionSources.upsertBatch, { records: [record] });
    const newer = { ...record, checkedAt: record.checkedAt + 1000, outcomeReason: "Revalidated the moved listing." };
    await t.action(internal.exhibitionSources.upsertBatch, { records: [newer] });
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [record] })).rejects.toThrow(
      "stale_discovery",
    );
    expect(
      (await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([expect.objectContaining(newer)]);
  });

  it("rejects contradictory discovery results with the same timestamp", async () => {
    const { t, museumId } = await fixture();
    const record = validated(museumId);
    await t.action(internal.exhibitionSources.upsertBatch, { records: [record] });
    const conflicting = { ...record, outcomeReason: "Another worker reported a different result." };
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [conflicting] })).rejects.toThrow(
      "timestamp_collision",
    );
    expect(
      (await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([expect.objectContaining(record)]);
  });

  it("retains venue identity when different museums share a single exhibition listing", async () => {
    const { t, museumId } = await fixture();
    const secondId = await t.run((ctx) =>
      seedMuseum(ctx, { website: "https://museum.example", name: "Second Museum" }),
    );
    const records = [museumId, secondId].map((id, index) => {
      const record = validated(id);
      return {
        ...record,
        urls: [
          {
            ...record.urls[0],
            venueAssociation: "shared_with_identity" as const,
            evidence: `The exhibition cards identify ${index === 0 ? "Test Museum" : "Second Museum"} as their venue.`,
          },
        ],
      };
    });
    await t.action(internal.exhibitionSources.upsertBatch, { records });
    const saved = await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(saved.page).toHaveLength(2);
    expect(saved.page).toEqual(expect.arrayContaining(records.map((record) => expect.objectContaining(record))));
  });

  it("refuses to attach results to a deleted museum", async () => {
    const { t, museumId } = await fixture();
    await t.run((ctx) => ctx.db.delete("museums", museumId));
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [validated(museumId)] })).rejects.toThrow(
      "not_found",
    );
  });

  it.each(["flag", "registry"] as const)("refuses validated listings for a museum opted out via %s", async (kind) => {
    const { t, museumId } = await fixture({ optOut: kind === "flag" });
    if (kind === "registry") {
      await t.run((ctx) =>
        ctx.db.insert("optOuts", {
          target: { kind: "venue", venueId: museumId },
          requester: "museum",
          receivedAt: Date.now(),
        }),
      );
    }
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [validated(museumId)] })).rejects.toThrow(
      "venue_opted_out",
    );
    const unresolved = validated(museumId, { status: "inaccessible", urls: [], outcomeReason: "Venue opted out." });
    await t.action(internal.exhibitionSources.upsertBatch, { records: [unresolved] });
    expect(
      (await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([expect.objectContaining(unresolved)]);
  });

  it.each(["no_listing_found", "missing_website", "inaccessible", "temporary_failure"] as const)(
    "retains the %s outcome independently of validated URL metadata",
    async (status) => {
      const { t, museumId } = await fixture({
        website: status === "missing_website" ? undefined : "https://museum.example",
      });
      const record = validated(museumId, {
        websiteSnapshot: status === "missing_website" ? null : "https://museum.example",
        status,
        urls: [],
        outcomeReason: `Discovery outcome: ${status}`,
      });
      await t.action(internal.exhibitionSources.upsertBatch, { records: [record] });
      expect(
        (await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } })).page,
      ).toEqual([expect.objectContaining(record)]);
    },
  );

  it.each([
    { status: "validated", urls: [] },
    { status: "temporary_failure" },
    { status: "missing_website", urls: [] },
    { urls: [{ url: "javascript:alert(1)" }] },
    { urls: [{ url: "https://user:secret@museum.example/exhibitions" }] },
    { urls: [{ validatedAt: -1 }] },
    { urls: [{ validatedAt: Number.MAX_SAFE_INTEGER }] },
    { urls: [{ evidence: " " }] },
    { outcomeReason: " " },
    { checkedAt: -1 },
    { checkedAt: Number.MAX_SAFE_INTEGER },
  ])("rejects invalid discovery metadata %j", async (invalid) => {
    const { t, museumId } = await fixture();
    const record = validated(museumId);
    const { urls, ...fields } = invalid;
    const badRecord = {
      ...record,
      ...fields,
      urls: urls?.map((url) => ({ ...record.urls[0], ...url })) ?? record.urls,
    } as Source;
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [badRecord] })).rejects.toThrow(
      "invalid_venue",
    );
    expect(
      (await t.query(internal.exhibitionSources.list, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([]);
  });

  it("rejects duplicate museum submissions and unbounded batches", async () => {
    const { t, museumId } = await fixture();
    const record = validated(museumId);
    await expect(t.action(internal.exhibitionSources.upsertBatch, { records: [record, record] })).rejects.toThrow(
      "duplicate_entry",
    );
    await expect(
      t.action(internal.exhibitionSources.upsertBatch, { records: Array(101).fill(record) }),
    ).rejects.toThrow("batch_too_large");
    await expect(
      t.action(internal.exhibitionSources.upsertBatch, {
        records: [{ ...record, urls: [record.urls[0], record.urls[0]] }],
      }),
    ).rejects.toThrow("duplicate_entry");
  });

  it("exports the full directory and saved metadata with durable pagination and registry opt-outs", async () => {
    const { t, museumId } = await fixture({ key: "first" });
    const secondId = await t.run((ctx) => seedMuseum(ctx, { key: "second" }));
    await t.run((ctx) =>
      ctx.db.insert("optOuts", {
        target: { kind: "venue", venueId: secondId },
        requester: "museum",
        receivedAt: Date.now(),
      }),
    );
    const first = await t.query(internal.exhibitionSources.exportMuseumPage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(first.page).toEqual([
      {
        museumId,
        key: "first",
        name: "Test Museum",
        website: "https://museum.example",
        country: "FR",
        city: "Paris",
        region: "US",
        optOut: false,
      },
    ]);
    expect(first.isDone).toBe(false);
    const second = await t.query(internal.exhibitionSources.exportMuseumPage, {
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    });
    expect(second.page).toEqual([
      expect.objectContaining({ museumId: secondId, website: null, country: null, city: null, optOut: true }),
    ]);
    expect(second.isDone).toBe(true);
    await t.action(internal.exhibitionSources.upsertBatch, {
      records: [
        validated(museumId),
        validated(secondId, {
          websiteSnapshot: null,
          status: "missing_website",
          urls: [],
          outcomeReason: "Missing website.",
        }),
      ],
    });
    const savedFirst = await t.query(internal.exhibitionSources.list, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    const savedSecond = await t.query(internal.exhibitionSources.list, {
      paginationOpts: { numItems: 1, cursor: savedFirst.continueCursor },
    });
    expect(new Set([...savedFirst.page, ...savedSecond.page].map((record) => record.museumId))).toEqual(
      new Set([museumId, secondId]),
    );
    expect(savedSecond.isDone).toBe(true);
  });
});
