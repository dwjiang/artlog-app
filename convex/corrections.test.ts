import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import model from "../shared/model/model-version.json";
import { completion } from "./lib/labelFixtures";
import { seedArtworkWithObject, seedDevice, testVector } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const factSheet = [
  {
    id: "f1",
    text: "Painted in 1916.",
    sourceUrl: "https://www.metmuseum.org/art/1",
    sourceLabel: "The Met",
    sourceScore: 1,
  },
  {
    id: "f2",
    text: "Acquired in 1959.",
    sourceUrl: "https://www.metmuseum.org/art/1",
    sourceLabel: "The Met",
    sourceScore: 1,
  },
];
const docent = {
  en: [{ sentence: "Monet painted these water lilies in 1916.", factIds: ["f1"] }],
};

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { factSheet, factSheetUpdatedAt: 1, docent, docentUpdatedAt: 2 },
    }),
  );
  return {
    t,
    user,
    artworkId,
    artwork: () => t.run((ctx) => ctx.db.get(artworkId)),
  };
}

describe("corrections.correctFact", () => {
  it("records the correction, holds the sheet for review, and drops the cached sentences", async () => {
    const { t, user, artworkId, artwork } = await fixture();
    await user.as.mutation(api.corrections.correctFact, {
      artworkId,
      factId: "f2",
      message: "  The work entered the collection in 1983, not 1959. ",
      contact: "registrar@museum.example",
    });
    const stored = await artwork();
    expect(stored).toMatchObject({ factSheet, factSheetNeedsReview: true });
    expect(stored).not.toHaveProperty("docent");
    expect(stored).not.toHaveProperty("docentUpdatedAt");
    const open = await t.query(internal.review.listCorrections, {});
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      artworkId,
      factId: "f2",
      message: "The work entered the collection in 1983, not 1959.",
      contact: "registrar@museum.example",
      deviceId: user.deviceId,
      status: "open",
    });
    expect(await t.query(internal.review.listCorrections, { status: "resolved" })).toEqual([]);
  });

  it("keeps the sheet untouched until it is reviewed, then a rewritten sheet clears the flag", async () => {
    const { t, user, artworkId, artwork } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network expected");
      }),
    );
    vi.stubEnv("FACT_SHEET_MODEL", "super");
    vi.stubEnv("DOCENT_MODEL", "lightning");
    await user.as.mutation(api.corrections.correctFact, {
      artworkId,
      factId: "f1",
      message: "Wrong year.",
    });
    await t.action(internal.docent.ensure, {
      artworkId,
      deviceId: user.deviceId,
    });
    expect(await artwork()).toMatchObject({ factSheetNeedsReview: true });
    expect(await artwork()).not.toHaveProperty("docent");
    const corrections = await t.query(internal.review.listCorrections, {});
    await t.mutation(internal.review.replaceFactSheet, {
      artworkId,
      factSheet: [factSheet[0]],
      correctionIds: corrections.map((correction) => correction._id),
    });
    expect(await t.query(internal.review.listCorrections, {})).toEqual([]);
    expect(await t.query(internal.review.listCorrections, { status: "resolved" })).toHaveLength(1);
    expect(await artwork()).toMatchObject({ factSheet: [factSheet[0]] });
    expect(await artwork()).not.toHaveProperty("docent");
    vi.stubEnv("NEBIUS_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion(
          docent.en.map(({ sentence, factIds }) => ({
            sentence,
            fact_ids: factIds,
          })),
        ),
      ),
    );
    await t.action(internal.docent.ensure, {
      artworkId,
      deviceId: user.deviceId,
    });
    expect(await artwork()).toMatchObject({ docent });
    expect(await artwork()).not.toHaveProperty("factSheetNeedsReview");
  });

  it.each([
    ["an unknown fact", { factId: "f9", message: "Wrong." }, "unknown_fact"],
    ["an empty message", { factId: "f1", message: "   " }, "invalid_correction"],
    ["an oversized message", { factId: "f1", message: "x".repeat(2001) }, "invalid_correction"],
    ["an oversized contact", { factId: "f1", message: "Wrong.", contact: "c".repeat(201) }, "invalid_correction"],
  ])("rejects %s without touching the artwork", async (_label, args, code) => {
    const { t, user, artworkId, artwork } = await fixture();
    await expect(user.as.mutation(api.corrections.correctFact, { artworkId, ...args })).rejects.toMatchObject({
      data: { code },
    });
    expect(await artwork()).toMatchObject({ docent });
    expect(await artwork()).not.toHaveProperty("factSheetNeedsReview");
    expect(await t.run((ctx) => ctx.db.query("factCorrections").collect())).toEqual([]);
  });

  it("requires a registered device and allows five corrections per device per day", async () => {
    const { t, user, artworkId } = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    await expect(
      t.mutation(api.corrections.correctFact, {
        artworkId,
        factId: "f1",
        message: "Wrong.",
      }),
    ).rejects.toMatchObject({ data: { code: "unauthenticated" } });
    const unregistered = await signIn(t);
    await expect(
      unregistered.as.mutation(api.corrections.correctFact, {
        artworkId,
        factId: "f1",
        message: "Wrong.",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_registered" } });
    for (let i = 0; i < 5; i++) {
      await user.as.mutation(api.corrections.correctFact, {
        artworkId,
        factId: "f1",
        message: `Wrong ${i}.`,
      });
    }
    await expect(
      user.as.mutation(api.corrections.correctFact, {
        artworkId,
        factId: "f1",
        message: "Wrong again.",
      }),
    ).rejects.toMatchObject({
      data: { code: "rate_limited", name: "correctFact" },
    });
    expect(await t.run((ctx) => ctx.db.query("factCorrections").collect())).toHaveLength(5);
  });
});

it.each([false, true])(
  "does not restore disputed prose after a correction during generation (reviewed meanwhile: %s)",
  async (reviewed) => {
    const t = harness();
    const user = await seedDevice(t);
    const work = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        artwork: {
          factSheet: [
            {
              id: "f1",
              text: "Painted in 1916.",
              sourceUrl: "https://museum.example/1",
              sourceLabel: "Museum",
              sourceScore: 1,
            },
          ],
          factSheetUpdatedAt: 1,
        },
      }),
    );
    const scanId = await t.run((ctx) =>
      ctx.db.insert("scans", {
        deviceId: user.deviceId,
        localId: "race",
        generation: 0,
        modelVersion: model.modelVersion,
        vector: testVector(),
        capturedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "identified",
        outcome: "confident",
        best: {
          identityStatus: "established" as const,
          artworkId: work.artworkId,
          objectId: work.objectId,
          probability: 1,
        },
      }),
    );
    vi.stubEnv("NEBIUS_API_KEY", "test");
    vi.stubEnv("FACT_SHEET_MODEL", "super");
    vi.stubEnv("DOCENT_MODEL", "lightning");
    let fetched!: () => void;
    const started = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    let finish!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetched();
        await responseGate;
        return completion([{ sentence: "Monet painted this work in 1916.", fact_ids: ["f1"] }]);
      }),
    );
    const generating = t.action(internal.docent.ensure, {
      artworkId: work.artworkId,
      deviceId: user.deviceId,
    });
    await started;
    await user.as.mutation(api.corrections.correctFact, {
      artworkId: work.artworkId,
      factId: "f1",
      message: "The year is wrong.",
    });
    if (reviewed) {
      const corrections = await t.query(internal.review.listCorrections, {});
      await t.mutation(internal.review.replaceFactSheet, {
        artworkId: work.artworkId,
        factSheet: [],
        correctionIds: corrections.map((correction) => correction._id),
      });
    }
    finish();
    await generating;
    expect((await t.run((ctx) => ctx.db.get(work.artworkId)))?.factSheetNeedsReview).toBe(reviewed ? undefined : true);
    expect((await user.as.query(api.scans.get, { scanId }))?.docent).toBeUndefined();
  },
);
