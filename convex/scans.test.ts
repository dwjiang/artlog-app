import { afterEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import { patchArtworkContent } from "./lib/artworkContent";
import { labelField } from "./lib/labelVerify";
import { patchObjectDetails } from "./lib/objectDetails";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedJournalVisit, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, { object: { ownerId: venueId } }));
  const args = {
    deviceId: user.deviceId,
    localId: "capture-1",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: Date.now(),
    venueId,
  };
  const created = await t.action(internal.scans.create, args);
  const best = {
    identityStatus: "established" as const,
    objectId: work.objectId,
    artworkId: work.artworkId,
    probability: 0.99,
    gallery: "4",
  };
  return { t, user, venueId, work, args, scanId: created.scan._id, best };
}

it("creates one pending scan per device and local capture id", async () => {
  const { t, args, scanId } = await fixture();
  expect(await t.action(internal.scans.create, args)).toMatchObject({
    scan: { _id: scanId },
    existing: true,
  });
  expect(await t.run((ctx) => ctx.db.get("scans", scanId))).toMatchObject({
    status: "pending",
  });
  const other = await seedDevice(t);
  expect(
    (
      await t.action(internal.scans.create, {
        ...args,
        deviceId: other.deviceId,
      })
    ).scan._id,
  ).not.toBe(scanId);
});

it("requires authentication and hides scans belonging to other devices", async () => {
  const { t, user, scanId } = await fixture();
  await expect(t.query(api.scans.get, { scanId })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  const other = await seedDevice(t);
  expect(await other.as.query(api.scans.get, { scanId })).toBeNull();
  expect(await user.as.query(api.scans.get, { scanId })).toMatchObject({
    scanId,
    status: "pending",
  });
});

it.each([
  ["public_domain", "https://museum.example/work.jpg"],
  ["in_copyright", undefined],
  ["unknown", undefined],
] as const)("joins display data and only exposes public-domain thumbnails (%s)", async (rightsStatus, thumbnailUrl) => {
  const { t, user, work, scanId, best } = await fixture();
  await t.run((ctx) => ctx.db.patch("artworks", work.artworkId, { rightsStatus }));
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "identified",
    outcome: "soft",
    best,
    runnerUps: [
      {
        identityStatus: "established" as const,
        objectId: best.objectId,
        artworkId: best.artworkId,
        probability: 0.5,
      },
    ],
    calibratorVersion: "lr-v1",
  });
  const result = await user.as.query(api.scans.get, { scanId });
  expect(result?.best).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    institution: "Test Museum",
    rightsStatus,
  });
  for (const candidate of [result?.best, ...result!.runnerUps!]) {
    expect(candidate?.thumbnailUrl).toBe(thumbnailUrl);
  }
  expect(result).not.toHaveProperty("vector");
  expect(result).not.toHaveProperty("deviceId");
});

it("refreshes displayed metadata when only the linked details row changes", async () => {
  const { t, user, work, scanId, best } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "identified",
    outcome: "confident",
    best,
    calibratorVersion: "lr-v1",
  });
  const object = await t.run((ctx) => ctx.db.get("objects", work.objectId));
  await t.run((ctx) =>
    patchObjectDetails(
      ctx,
      { _id: work.objectId },
      {
        medium: "Watercolor",
        thumbnailUrl: "https://museum.example/new.jpg",
      },
    ),
  );
  expect(await user.as.query(api.scans.get, { scanId })).toMatchObject({
    best: { medium: "Watercolor", thumbnailUrl: "https://museum.example/new.jpg" },
  });
  expect(await t.run((ctx) => ctx.db.get("objects", work.objectId))).toEqual(object);
  await t.run((ctx) => patchObjectDetails(ctx, { _id: work.objectId }, { thumbnailUrl: undefined }));
  expect((await user.as.query(api.scans.get, { scanId }))?.best).not.toHaveProperty("thumbnailUrl");
});

it.each(["confident", "soft"] as const)(
  "joins docent sentences and source chips from the artwork only for a confident card (%s)",
  async (outcome) => {
    const { t, user, work, scanId, best } = await fixture();
    const factSheet = [
      {
        id: "f1",
        text: "Painted in 1916.",
        sourceUrl: "https://www.metmuseum.org/art/1",
        sourceLabel: "The Met",
        sourceScore: 1,
      },
    ];
    const docent = {
      en: [
        {
          sentence: "Monet painted these water lilies in 1916.",
          factIds: ["f1"],
        },
      ],
    };
    await t.run(async (ctx) => {
      await patchArtworkContent(ctx, { _id: work.artworkId }, { factSheet, docent });
      await ctx.db.patch("artworks", work.artworkId, {
        factSheetUpdatedAt: 1,
        docentUpdatedAt: 2,
      });
    });
    await t.mutation(internal.scans.setResult, {
      scanId,
      generation: 0,
      status: "identified",
      outcome,
      best,
      calibratorVersion: "lr-v1",
    });
    const result = await user.as.query(api.scans.get, { scanId });
    const confident = outcome === "confident";
    expect(result?.docent).toEqual(confident ? docent.en : undefined);
    expect(result?.factSheet).toEqual(
      confident ? [{ id: "f1", sourceUrl: "https://www.metmuseum.org/art/1", sourceLabel: "The Met" }] : undefined,
    );
    expect(result?.docentStatus).toBe(confident ? "ready" : undefined);
  },
);

it("reports whether a confident card's background is being written, failed, or has nothing to say", async () => {
  const { t, user, work, scanId, best } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "identified",
    outcome: "confident",
    best,
    calibratorVersion: "lr-v1",
  });
  const status = async () => (await user.as.query(api.scans.get, { scanId }))?.docentStatus;
  expect(await status()).toBe("writing");
  await t.run((ctx) => ctx.db.patch("artworks", work.artworkId, { docentFailedAt: 1 }));
  expect(await status()).toBe("failed");
  await t.run((ctx) => ctx.db.patch("artworks", work.artworkId, { factSheetNeedsReview: true }));
  expect(await status()).toBe("unavailable");
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: work.artworkId }, { docent: { en: [] } });
    await ctx.db.patch("artworks", work.artworkId, {
      factSheetNeedsReview: undefined,
      docentFailedAt: undefined,
      docentUpdatedAt: 2,
    });
  });
  expect(await status()).toBe("writing");
});

it("updates gallery history only for a confident result and never rolls it backwards", async () => {
  const { t, user, venueId, args, best } = await fixture();
  const visitId = await t.run((ctx) =>
    seedJournalVisit(ctx, user.deviceId, venueId, {
      startedAt: 0,
      lastConfidentGallery: "1",
      lastConfidentAt: 100,
    }),
  );
  const result = {
    generation: 0,
    status: "identified" as const,
    best,
    calibratorVersion: "lr-v1",
  };
  const soft = await t.action(internal.scans.create, {
    ...args,
    localId: "soft",
    visitId,
    capturedAt: 150,
  });
  await t.mutation(internal.scans.setResult, {
    ...result,
    scanId: soft.scan._id,
    outcome: "soft",
  });
  expect(await t.run((ctx) => ctx.db.get("visits", visitId))).toMatchObject({
    lastConfidentGallery: "1",
    lastConfidentAt: 100,
  });
  const confident = await t.action(internal.scans.create, {
    ...args,
    localId: "confident",
    visitId,
    capturedAt: 200,
  });
  await t.mutation(internal.scans.setResult, {
    ...result,
    scanId: confident.scan._id,
    outcome: "confident",
  });
  expect(await t.run((ctx) => ctx.db.get("visits", visitId))).toMatchObject({
    lastConfidentGallery: "4",
    lastConfidentAt: 200,
  });
  await t.run((ctx) => ctx.db.patch("visits", visitId, { lastConfidentGallery: "9", lastConfidentAt: 300 }));
  const older = await t.action(internal.scans.create, {
    ...args,
    localId: "older",
    visitId,
    capturedAt: 250,
  });
  await t.mutation(internal.scans.setResult, {
    ...result,
    scanId: older.scan._id,
    outcome: "confident",
  });
  expect(await t.run((ctx) => ctx.db.get("visits", visitId))).toMatchObject({
    lastConfidentGallery: "9",
    lastConfidentAt: 300,
  });
});

it("refuses another device’s visit and uses the current museum of an owned visit", async () => {
  const { t, user, venueId, args } = await fixture();
  const other = await seedDevice(t);
  const visitId = await t.run((ctx) => seedJournalVisit(ctx, other.deviceId, venueId));
  await expect(t.action(internal.scans.create, { ...args, localId: "foreign", visitId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  const otherVenue = await t.run((ctx) => seedMuseum(ctx));
  await t.run((ctx) =>
    ctx.db.patch("visits", visitId, {
      owner: { kind: "device", deviceId: user.deviceId },
      venueId: otherVenue,
    }),
  );
  await expect(
    t.action(internal.scans.create, {
      ...args,
      localId: "wrong-venue",
      visitId,
    }),
  ).resolves.toMatchObject({ scan: { venueId: otherVenue, visitId } });
});

it.each(["failed", "expired"])(
  "retries a %s scan after its visit moves while retaining the scan's recognition museum",
  async (reason) => {
    const { t, user, args, venueId } = await fixture();
    const visitId = await t.run((ctx) => seedJournalVisit(ctx, user.deviceId, venueId));
    const input = { ...args, localId: "linked-capture", visitId };
    const first = await t.action(internal.scans.create, input);
    const otherVenue = await t.run(seedMuseum);
    await t.run((ctx) =>
      ctx.db.patch("visits", visitId, { venueId: otherVenue, lastConfidentGallery: "99", lastConfidentAt: Date.now() }),
    );
    await t.run((ctx) =>
      reason === "failed"
        ? ctx.db.patch("scans", first.scan._id, { status: "failed" })
        : ctx.db.delete("scanEmbeddings", first.scan.embeddingId!),
    );
    const retry = await t.action(internal.scans.create, { ...input, venueId: otherVenue });
    expect(retry.scan).toMatchObject({ _id: first.scan._id, venueId, visitId, generation: 1, status: "pending" });
    expect(await t.query(internal.identify.loadContext, { scanId: retry.scan._id })).toMatchObject({ visit: null });
    const next = await t.action(internal.scans.create, { ...input, localId: "not-uploaded-yet" });
    expect(next.scan).toMatchObject({ venueId: otherVenue, visitId });
    await expect(t.action(internal.scans.create, { ...input, visitId: undefined })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
  },
);

it("ignores results from an older payload after an unsupported capture is restarted", async () => {
  const { t, args, scanId } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "unsupported_version",
    calibratorVersion: "lr-v1",
    error: "Update the app to identify.",
  });
  const restarted = await t.action(internal.scans.create, args);
  expect(restarted.scan).toMatchObject({
    _id: scanId,
    status: "pending",
    generation: 1,
  });
  expect(restarted.scan.error).toBeUndefined();
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "unsupported_version",
    calibratorVersion: "lr-v1",
    error: "Update the app to identify.",
  });
  expect(await t.run((ctx) => ctx.db.get("scans", scanId))).toMatchObject({
    status: "pending",
    generation: 1,
  });
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 1,
    status: "identified",
    outcome: "miss",
    calibratorVersion: "lr-v1",
  });
  expect(await t.run((ctx) => ctx.db.get("scans", scanId))).toMatchObject({
    status: "identified",
    outcome: "miss",
  });
});

it("exposes the label flow without raw OCR to the owner only", async () => {
  const { t, user, scanId } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId,
    generation: 0,
    status: "identified",
    outcome: "miss",
    calibratorVersion: "lr-v1",
  });
  expect((await user.as.query(api.scans.get, { scanId }))?.labelFlow).toBeUndefined();

  const sourceUrl = "https://www.metmuseum.org/art/collection/search/437127";
  const imageUrls = ["https://images.metmuseum.org/work.jpg"];
  const fields = {
    title: labelField("Water Lilies", "tavily+image"),
    artist: labelField("Claude Monet", "tavily+image"),
  };
  await t.run((ctx) =>
    ctx.db.patch("scans", scanId, {
      labelFlow: {
        stage: "verified",
        fields,
        evidence: ["tavily+image"],
        warnings: [],
        moderation: "clear",
        rawOcr: {
          title: "Water Lilies",
          artist: null,
          artist_dates: null,
          work_date: null,
          medium: null,
          accession: null,
          credit_line: null,
          confidence: { title: 1, artist: 0, work_date: 0, medium: 0, accession: 0 },
        },
        sourceUrl,
        imageUrls,
        updatedAt: 4,
      },
    }),
  );
  const confirmed = await user.as.query(api.scans.get, { scanId });
  expect(confirmed?.labelFlow).toEqual({
    stage: "verified",
    fields,
    evidence: ["tavily+image"],
    warnings: [],
    moderation: "clear",
    sourceUrl,
    imageUrls,
    updatedAt: 4,
  });
  expect(confirmed?.labelFlow).not.toHaveProperty("rawOcr");
  expect(confirmed).not.toHaveProperty("vector");
  expect(confirmed).not.toHaveProperty("deviceId");
  const other = await seedDevice(t);
  expect(await other.as.query(api.scans.get, { scanId })).toBeNull();
  expect(
    await t.query(internal.scans.getDisplay, {
      scanId,
      deviceId: user.deviceId,
    }),
  ).toEqual(confirmed);
  await expect(t.query(internal.scans.getDisplay, { scanId, deviceId: other.deviceId })).rejects.toMatchObject({
    data: { code: "scan_not_found" },
  });
});

describe("linking a scan to the catalogue work its details name", () => {
  async function labelled() {
    const setup = await fixture();
    const { t, scanId, best } = setup;
    await t.mutation(internal.scans.setResult, {
      scanId,
      generation: 0,
      status: "identified",
      outcome: "miss",
      best: { ...best, probability: 0.2 },
      runnerUps: [],
      calibratorVersion: "lr-v1",
    });
    const terrace = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        artwork: { title: "Café Terrace at Night", artist: "Vincent van Gogh", date: "1888", wikidataId: "Q1025704" },
      }),
    );
    await t.run((ctx) =>
      ctx.db.patch("scans", scanId, {
        labelFlow: {
          stage: "verified",
          fields: {
            title: labelField("Cafe Terrace at Night", "wikidata"),
            artist: labelField("Vincent Van Gogh", "wikidata"),
          },
          evidence: ["wikidata"],
          warnings: [],
          moderation: "clear",
          wikidataId: "Q1025704",
          updatedAt: 1,
        },
      }),
    );
    const fields = { title: "Cafe Terrace at Night", artist: "Vincent Van Gogh" };
    return { ...setup, terrace, fields };
  }

  it("suggests the label's catalogue work to the scan's owner only, while its title is kept", async () => {
    const { t, user, scanId, terrace, fields } = await labelled();
    const matches = await user.as.query(api.scans.corpusMatches, { scanId, fields });
    expect(matches).toEqual([
      expect.objectContaining({
        objectId: terrace.objectId,
        artworkId: terrace.artworkId,
        title: "Café Terrace at Night",
        artist: "Vincent van Gogh",
        thumbnailUrl: "https://museum.example/work.jpg",
      }),
    ]);
    expect(matches[0]).not.toHaveProperty("probability");
    const other = await seedDevice(t);
    expect(await other.as.query(api.scans.corpusMatches, { scanId, fields })).toEqual([]);
    expect(await user.as.query(api.scans.corpusMatches, { scanId, fields: { ...fields, title: " " } })).toEqual([]);
    expect(
      await user.as.query(api.scans.corpusMatches, { scanId, fields: { title: "Terrace", artist: "Van Gogh" } }),
    ).toEqual([]);
  });

  it("shows a linked work as the scan's match and starts its background", async () => {
    const { t, user, scanId, terrace, fields } = await labelled();
    await user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields });
    const view = await user.as.query(api.scans.get, { scanId });
    expect(view).toMatchObject({
      outcome: "confident",
      best: { objectId: terrace.objectId, title: "Café Terrace at Night" },
      runnerUps: [],
      linked: { source: "label" },
    });
    expect(view?.best).not.toHaveProperty("probability");
    expect(await t.run((ctx) => ctx.db.get("scans", scanId))).toMatchObject({
      outcome: "miss",
      linked: { source: "label", objectId: terrace.objectId, artworkId: terrace.artworkId },
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).toEqual(expect.arrayContaining(["docent:ensure", "rightNow:fetch"]));
  });

  it("refuses works the details don't name and unverified labels", async () => {
    const { t, user, scanId, work, fields, terrace } = await labelled();
    await expect(
      user.as.mutation(api.scans.link, { scanId, objectId: work.objectId, source: "label", fields }),
    ).rejects.toMatchObject({ data: { code: "invalid_object" } });
    const other = await seedDevice(t);
    await expect(
      other.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "manual", fields }),
    ).rejects.toMatchObject({ data: { code: "invalid_scan" } });
    await t.run((ctx) => ctx.db.patch("scans", scanId, { labelFlow: undefined }));
    await expect(
      user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields }),
    ).rejects.toMatchObject({ data: { code: "label_not_verified" } });
  });

  it("clears the previous artist's news when the owner links a work", async () => {
    const { t, user, scanId, terrace, fields } = await labelled();
    await t.run((ctx) =>
      ctx.db.patch("scans", scanId, {
        rightNow: { text: "Monet exhibition", sourceUrl: "https://museum.example/monet", sourceLabel: "Museum" },
      }),
    );
    await user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields });
    expect((await user.as.query(api.scans.get, { scanId }))?.rightNow).toBeUndefined();
  });

  it("keeps a linked work's news when the previous artist's request finishes later", async () => {
    const { t, user, scanId, terrace, fields } = await labelled();
    const previous = { artistKey: "name:claude monet", region: "US" };
    const claim = await t.mutation(internal.rightNow.claim, { ...previous, scanId, generation: 0 });
    if (typeof claim === "string") throw new Error("Expected an uncached request");
    await user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields });
    const currentCard = {
      text: "Van Gogh exhibition",
      sourceUrl: "https://museum.example/gogh",
      sourceLabel: "Museum",
    };
    const current = { artistKey: "name:vincent van gogh", region: "US" };
    await t.run((ctx) =>
      ctx.db.insert("artistContext", {
        artistId: current.artistKey,
        region: current.region,
        ...currentCard,
        empty: false,
        fetchedAt: Date.now(),
      }),
    );
    await t.mutation(internal.rightNow.claim, { ...current, scanId, generation: 0 });
    expect((await user.as.query(api.scans.get, { scanId }))?.rightNow).toEqual(currentCard);
    await t.mutation(internal.rightNow.write, {
      ...previous,
      claimId: claim.claimId,
      card: { text: "Monet exhibition", sourceUrl: "https://museum.example/monet", sourceLabel: "Museum" },
    });
    expect((await user.as.query(api.scans.get, { scanId }))?.rightNow).toEqual(currentCard);
    await t.mutation(internal.rightNow.claim, { ...previous, scanId, generation: 0 });
    expect((await user.as.query(api.scans.get, { scanId }))?.rightNow).toEqual(currentCard);
  });

  it.each(["failed", "unsupported_version"] as const)("delivers current news to a linked %s scan", async (status) => {
    const { t, user, scanId, terrace, fields } = await labelled();
    await t.run((ctx) => ctx.db.patch("scans", scanId, { status }));
    await user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields });
    const current = { artistKey: "name:vincent van gogh", region: "US" };
    const claim = await t.mutation(internal.rightNow.claim, { ...current, scanId, generation: 0 });
    if (typeof claim === "string") throw new Error("Expected an uncached request");
    const card = { text: "Van Gogh exhibition", sourceUrl: "https://museum.example/gogh", sourceLabel: "Museum" };
    await t.mutation(internal.rightNow.write, { ...current, claimId: claim.claimId, card });
    expect((await user.as.query(api.scans.get, { scanId }))?.rightNow).toEqual(card);
  });

  it("lets confirmed details and a link replace each other without losing the details", async () => {
    const { user, scanId, terrace, fields } = await labelled();
    const link = () =>
      user.as.mutation(api.scans.link, { scanId, objectId: terrace.objectId, source: "label", fields });
    const mine = { title: "My own title" };
    await user.as.mutation(api.scans.confirm, { scanId, source: "manual", fields: mine });
    await link();
    const linked = await user.as.query(api.scans.get, { scanId });
    expect(linked).toMatchObject({ linked: { source: "label" } });
    expect(linked).not.toHaveProperty("confirmed");
    await user.as.mutation(api.scans.confirm, { scanId, source: "manual", fields: mine });
    const view = await user.as.query(api.scans.get, { scanId });
    expect(view).toMatchObject({ outcome: "miss", confirmed: { fields: mine } });
    expect(view).not.toHaveProperty("linked");
  });
});
