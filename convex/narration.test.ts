import { guideBodyFixture, guideFixture, researchFixture } from "../shared/audio/guide-fixtures";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { seedArtworkWithObject, seedDevice } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

const sentences = [{ sentence: "A short written docent.", factIds: ["f1"] }];
// Catalogue lines stay on the artwork for the written docent but never reach the guide.
const catalogueFact = {
  id: "f3",
  text: "Material: oil paint, canvas",
  sourceUrl: "https://www.wikidata.org/wiki/Q1",
  sourceLabel: "Wikidata",
  sourceScore: 0.8,
};
const supportFor: Record<string, string> = {
  f1: "water lilies and reflections of the garden",
  f2: "visible strokes of oil paint",
};
const script = guideBodyFixture.map(({ sentence, factIds }) => ({
  sentence,
  fact_ids: factIds,
  support: supportFor[factIds[0]],
}));
const completion = (value = script) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), {
    headers: { "Content-Type": "application/json" },
  });
async function setup() {
  const t = harness();
  const device = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: {
        docent: { en: sentences },
        factSheet: [...researchFixture, catalogueFact],
        factSheetUpdatedAt: 5,
      },
    }),
  );
  vi.stubEnv("OPENAI_API_KEY", "test-only-secret");
  vi.stubEnv("NEBIUS_API_KEY", "test-nebius-secret");
  const fetcher = vi.fn(async (url: string) =>
    url.includes("tokenfactory")
      ? completion()
      : new Response(new Uint8Array([73, 68, 51, 1]), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  const rows = () => t.run((ctx) => ctx.db.query("narrationAudio").take(10));
  return { t, ...device, artworkId, fetcher, rows, args: { artworkId } };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("generates Shimmer with the museum instructions once and shares cached audio across devices", async () => {
  const { t, as, args, fetcher } = await setup();
  const first = await as.action(api.narration.render, args);
  const other = await seedDevice(t);
  expect(await other.as.action(api.narration.render, args)).toEqual(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const options = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(options.body as string)).toMatchObject({
    voice: "shimmer",
    model: "gpt-4o-mini-tts-2025-12-15",
    input: guideFixture.map((line) => line.sentence).join(" "),
    response_format: "mp3",
  });
  expect(JSON.parse(options.body as string).instructions).toContain("museum guide");
  expect(first.uri).toBeTruthy();
  expect(first.renderId).toBeTruthy();
  expect(first.sentences).toEqual(guideFixture);
  const authoring = JSON.parse(
    (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(authoring.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
  expect(JSON.parse(authoring.messages[1].content).research).toEqual(researchFixture);
  const spend = await t.run((ctx) => ctx.db.query("dailySpend").take(1));
  expect(spend[0].tokenFactoryCalls).toBe(1);
  expect(JSON.stringify(first)).not.toContain("test-only-secret");
});

it("rejects unauthenticated, unregistered and banned callers before spending", async () => {
  const { t, as, args, deviceId, fetcher } = await setup();
  await expect(t.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  const unknown = await signIn(t);
  await expect(unknown.as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "device_not_registered" },
  });
  await t.run((ctx) => ctx.db.patch(deviceId, { banned: true }));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "device_banned" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects facts under review, catalogue-only research and retired artworks before spending", async () => {
  const { t, as, args, artworkId, fetcher } = await setup();
  await t.run((ctx) => ctx.db.patch(artworkId, { factSheetNeedsReview: true }));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  await t.run((ctx) =>
    ctx.db.patch(artworkId, { factSheetNeedsReview: undefined, factSheet: [catalogueFact] }),
  );
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  await t.run((ctx) =>
    ctx.db.patch(artworkId, { factSheet: researchFixture, retiredAt: Date.now() }),
  );
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("is independent of the written docent and re-renders only when the research is rewritten", async () => {
  const { t, as, args, artworkId, fetcher, rows } = await setup();
  await t.run((ctx) => ctx.db.patch(artworkId, { docent: undefined }));
  const first = await as.action(api.narration.render, args);
  await t.run((ctx) =>
    ctx.db.patch(artworkId, {
      docent: { en: [{ sentence: "Changed written docent.", factIds: ["f1"] }] },
    }),
  );
  expect(await as.action(api.narration.render, args)).toEqual(first);
  const previous = (await rows())[0].storageId!;
  const updatedFacts = researchFixture.map((fact) => ({
    ...fact,
    text: `${fact.text} Corrected evidence.`,
  }));
  await t.run((ctx) => ctx.db.patch(artworkId, { factSheet: updatedFacts, factSheetUpdatedAt: 6 }));
  const updated = await as.action(api.narration.render, args);
  expect(updated.renderId).not.toBe(first.renderId);
  expect(
    JSON.parse((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)
      .messages[1].content,
  ).toContain("Corrected evidence.");
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(([url]) => !url.includes("tavily"))).toBe(true);
  expect(await rows()).toHaveLength(1);
  expect(await t.run((ctx) => ctx.storage.get(previous))).toBeNull();
});

it("re-renders from corrected artwork metadata even when the research is unchanged", async () => {
  const { t, as, args, artworkId, fetcher } = await setup();
  const first = await as.action(api.narration.render, args);
  await t.run((ctx) =>
    ctx.db.patch(artworkId, {
      title: "Nymphéas",
      artist: "Attributed to Claude Monet",
      date: "1917",
    }),
  );
  const opening = "This is Nymphéas, by Attributed to Claude Monet, dated 1917.";
  expect((await as.query(api.artworks.enrichment, { artworkId }))?.narrationOpening).toBe(opening);
  const updated = await as.action(api.narration.render, args);
  expect(updated.renderId).not.toBe(first.renderId);
  expect(updated.sentences).toEqual([{ sentence: opening, factIds: [] }, ...guideBodyFixture]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const speech = JSON.parse(
    (fetcher.mock.calls[3] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(speech.input.startsWith(`${opening} ${guideBodyFixture[0].sentence}`)).toBe(true);
});

it("re-renders audio that was made with another voice or model", async () => {
  const { t, as, args, fetcher, rows } = await setup();
  const first = await as.action(api.narration.render, args);
  const entry = (await rows())[0];
  await t.run((ctx) => ctx.db.patch(entry._id, { voice: "previous-voice" }));
  expect((await as.action(api.narration.render, args)).renderId).not.toBe(first.renderId);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch(row._id, { guideModel: "previous-model" });
  });
  await as.action(api.narration.render, args);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("tells the client which render is current only while it is fresh", async () => {
  const { t, as, args, artworkId } = await setup();
  expect(
    (await as.query(api.artworks.enrichment, { artworkId }))?.narrationRenderId,
  ).toBeUndefined();
  const first = await as.action(api.narration.render, args);
  expect((await as.query(api.artworks.enrichment, { artworkId }))?.narrationRenderId).toBe(
    first.renderId,
  );
  await t.run((ctx) => ctx.db.patch(artworkId, { factSheetUpdatedAt: 6 }));
  expect(
    (await as.query(api.artworks.enrichment, { artworkId }))?.narrationRenderId,
  ).toBeUndefined();
});

it("clears every rendering and its audio so the next play renders again", async () => {
  const { t, as, args, fetcher, rows } = await setup();
  const first = await as.action(api.narration.render, args);
  const storageId = (await rows())[0].storageId!;
  expect(await t.mutation(internal.narration.clear, {})).toBe(1);
  expect(await rows()).toHaveLength(0);
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  expect((await as.action(api.narration.render, args)).renderId).not.toBe(first.renderId);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("releases failed generations, hides provider response details, and permits retry", async () => {
  const { t, as, args, fetcher, rows } = await setup();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(new Response("Sensitive provider error", { status: 429 }));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_provider_failed" },
  });
  expect(await rows()).toHaveLength(0);
  expect((await as.action(api.narration.render, args)).uri).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(t).toBeTruthy();
});

it("allows only one generation claim and rejects a late completion after a stale claim is replaced", async () => {
  const { t, as, args, rows } = await setup();
  const first = await as.mutation(internal.narration.claim, { ...args, claim: "first" });
  const second = await as.mutation(internal.narration.claim, { ...args, claim: "second" });
  expect(first.owned).toBe(true);
  expect(second.owned).toBe(false);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch(row._id, { claimedAt: Date.now() - 181_000 });
  });
  expect(
    (await as.mutation(internal.narration.claim, { ...args, claim: "replacement" })).owned,
  ).toBe(true);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["obsolete"])));
  await t.mutation(internal.narration.finish, {
    ...args,
    claim: "first",
    audio: { storageId, sentences },
  });
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  const entries = await rows();
  expect(entries).toHaveLength(1);
  expect(entries[0].claim).toBe("replacement");
  expect(entries[0].storageId).toBeUndefined();
});

it("takes over a shared generation once its owner releases it instead of waiting out the poll", async () => {
  vi.useFakeTimers();
  const { t, as, args, fetcher } = await setup();
  expect((await as.mutation(internal.narration.claim, { ...args, claim: "failing" })).owned).toBe(
    true,
  );
  const waiting = as.action(api.narration.render, args);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetcher).not.toHaveBeenCalled();
  await t.mutation(internal.narration.finish, { ...args, claim: "failing" });
  await vi.advanceTimersByTimeAsync(1000);
  expect((await waiting).sentences).toEqual(guideFixture);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("deletes its audio when the research changes while it is being spoken", async () => {
  const { t, as, args, artworkId, fetcher, rows } = await setup();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockImplementationOnce(async () => {
    await t.run((ctx) => ctx.db.patch(artworkId, { factSheetUpdatedAt: 6 }));
    return new Response(new Uint8Array([73, 68, 51, 1]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  });
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(await rows()).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
});

it("retries once naming the sentence whose evidence span is not verbatim, then speaks the fixed script", async () => {
  const { t, as, args, fetcher } = await setup();
  const invented = [
    ...script.slice(0, 9),
    {
      sentence: "The lilies float serenely in the evening light of Giverny.",
      fact_ids: ["f1"],
      support: "lilies float serenely",
    },
  ];
  fetcher.mockResolvedValueOnce(completion(invented));
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const retry = JSON.parse(
    (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(retry.messages[1].content).toContain("lilies float serenely");
  expect(retry.messages[1].content).toContain("not verbatim");
  expect((await t.run((ctx) => ctx.db.query("dailySpend").take(1)))[0].tokenFactoryCalls).toBe(2);
});

it("asks for the thin-research length, not the full one, when a script from thin research is too short", async () => {
  const { as, args, fetcher } = await setup();
  fetcher.mockResolvedValueOnce(completion(script.slice(0, 2)));
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
  const retry = JSON.parse(
    JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
      .messages[1].content,
  );
  expect(retry.previousAttemptProblems).toContain("110 to 200 words after the opening");
});

it("rejects invented citations before generating speech and releases the claim for retry", async () => {
  const { as, args, fetcher, rows } = await setup();
  fetcher.mockResolvedValueOnce(
    completion([
      { sentence: "An unsupported story.", fact_ids: ["invented"], support: "unsupported" },
    ]),
  );
  fetcher.mockResolvedValueOnce(
    completion([
      { sentence: "An unsupported story.", fact_ids: ["invented"], support: "unsupported" },
    ]),
  );
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "model_error" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await rows()).toHaveLength(0);
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
});

it("observes the existing Token Factory spend cap before authoring or speaking", async () => {
  const { as, args, fetcher } = await setup();
  vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "0");
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "spend_cap" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("refuses a tiny script instead of synthesizing another ten-second guide", async () => {
  const { as, args, fetcher, rows } = await setup();
  fetcher.mockResolvedValueOnce(completion(script.slice(0, 1)));
  fetcher.mockResolvedValueOnce(completion(script.slice(0, 1)));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "model_error" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await rows()).toHaveLength(0);
});
