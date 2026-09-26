import { afterEach, expect, it, vi } from "vitest";

import { guideBodyFixture, guideFixture, researchFixture, sectionedGuide } from "../shared/audio/guide-fixtures";
import { api, internal } from "./_generated/api";
import { patchArtworkContent } from "./lib/artworkContent";
import { fileStorage } from "./lib/fileStorage";
import { FRAME_BYTES, speechMp3 } from "./lib/hls.fixtures";
import { seedArtworkWithObject, seedDevice } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

const sentences = [{ sentence: "A short written docent.", factIds: ["f1"] }];
// Catalogue lines stay in the written docent research but never reach the guide.
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
// Six seconds of speech: segments of 2.016, 2.016 and 1.968 seconds.
const spokenBytes = speechMp3(250);
const speech = (body: BodyInit = spokenBytes) => new Response(body, { headers: { "Content-Type": "audio/mpeg" } });
// Speech that pauses after its first segment until released, then finishes or drops the connection.
function heldSpeech(ending: "finish" | "fail" = "finish") {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(spokenBytes.subarray(0, 100 * FRAME_BYTES));
        return;
      }
      await held;
      if (ending === "fail") {
        controller.error(new Error("Connection reset"));
        return;
      }
      controller.enqueue(spokenBytes.subarray(100 * FRAME_BYTES));
      controller.close();
    },
  });
  return { response: speech(body), release };
}
const path = (uri: string) => new URL(uri).pathname + new URL(uri).search;
const completion = (value = script) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(sectionedGuide(value)) } }],
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
async function setup() {
  const t = harness();
  const device = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { factSheetUpdatedAt: 5 },
      artworkContent: {
        docent: { en: sentences },
        factSheet: [...researchFixture, catalogueFact],
      },
    }),
  );
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("OPENAI_API_KEY", "test-only-secret");
  vi.stubEnv("NEBIUS_API_KEY", "test-nebius-secret");
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async (url) =>
    url.includes("tokenfactory") ? completion() : speech(),
  );
  vi.stubGlobal("fetch", fetcher);
  const rows = () => t.run((ctx) => ctx.db.query("narrationAudio").take(10));
  const files = () =>
    t.run(async (ctx) => (await ctx.db.query("files").collect()).filter((file) => file.state === "ready"));
  // Plays through the live playlist, then waits for the whole file to be stored.
  const render = async (as: typeof device.as = device.as) => {
    const audio = await as.action(api.narration.render, { artworkId });
    await t.finishInProgressScheduledFunctions();
    return audio;
  };
  return { t, ...device, artworkId, fetcher, rows, files, render, args: { artworkId } };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("streams Shimmer with the museum instructions as a live playlist, then shares the stored file across devices", async () => {
  const { t, as, args, artworkId, fetcher, rows, files } = await setup();
  const held = heldSpeech();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const first = await as.action(api.narration.render, args);
  expect(first).toEqual({
    uri: `https://test.convex.site/narration-playlist?artworkId=${artworkId}&render=${first.renderId}`,
    sentences: guideFixture,
    renderId: expect.any(String),
    live: true,
  });
  held.release();
  await t.finishInProgressScheduledFunctions();
  const playlist = await t.fetch(path(first.uri));
  expect(playlist.headers.get("Content-Type")).toBe("application/vnd.apple.mpegurl");
  const lines = (await playlist.text()).split("\n");
  expect(lines.filter((line) => line.startsWith("#EXTINF"))).toEqual([
    "#EXTINF:2.016,",
    "#EXTINF:2.016,",
    "#EXTINF:1.968,",
  ]);
  expect(lines.at(-2)).toBe("#EXT-X-ENDLIST");
  const other = await seedDevice(t);
  const stored = await other.as.action(api.narration.render, args);
  expect(stored).toEqual({ ...first, uri: expect.not.stringContaining("narration-playlist"), live: false });
  const { storageId } = (await rows())[0];
  const whole = await t.run(async (ctx) => (await fileStorage.get(ctx, storageId!))!.arrayBuffer());
  expect(new Uint8Array(whole)).toEqual(spokenBytes);
  expect(await files()).toHaveLength(4);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const options = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(options.body as string)).toMatchObject({
    voice: "shimmer",
    model: "gpt-4o-mini-tts-2025-12-15",
    input: guideFixture.map((line) => line.sentence).join(" "),
    response_format: "mp3",
  });
  expect(JSON.parse(options.body as string).instructions).toContain("museum guide");
  const authoring = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(authoring.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
  expect(JSON.parse(authoring.messages[1].content).research).toEqual(researchFixture);
  const spend = await t.run((ctx) => ctx.db.query("dailySpend").take(1));
  expect(spend[0].tokenFactoryCalls).toBe(1);
  expect(JSON.stringify(first)).not.toContain("test-only-secret");
});

it("lets a second device join the playlist while the first is still being spoken", async () => {
  const { t, as, args, fetcher } = await setup();
  const held = heldSpeech();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const first = await as.action(api.narration.render, args);
  const other = await seedDevice(t);
  expect(await other.as.action(api.narration.render, args)).toEqual(first);
  const open = await (await t.fetch(path(first.uri))).text();
  expect(open).not.toContain("#EXT-X-ENDLIST");
  expect(open.match(/#EXTINF/g)).toHaveLength(1);
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("drops the live segments an hour after the whole file is stored", async () => {
  const { t, artworkId, rows, files, render } = await setup();
  const first = await render();
  const [drop] = await t.run((ctx) =>
    ctx.db.system
      .query("_scheduled_functions")
      .filter((q) => q.eq(q.field("name"), "narration:dropSegments"))
      .collect(),
  );
  expect(drop.args).toEqual([{ artworkId, claim: first.renderId }]);
  expect(drop.scheduledTime).toBeGreaterThan(Date.now() + 59 * 60_000);
  expect((await rows())[0].segments).toHaveLength(3);
  await t.mutation(internal.narration.dropSegments, drop.args[0]);
  expect((await rows())[0].segments).toBeUndefined();
  expect(await files()).toHaveLength(1);
  expect((await t.fetch(`/narration-playlist?artworkId=${artworkId}&render=${first.renderId}`)).status).toBe(404);
});

it("does not serve a playlist for a malformed artwork or another render", async () => {
  const { t, artworkId, render } = await setup();
  const first = await render();
  const url = new URL(`https://test.convex.site/narration-playlist?artworkId=${artworkId}&render=${first.renderId}`);
  expect((await t.fetch(`${url.pathname}?artworkId=not-an-id&render=${first.renderId}`)).status).toBe(404);
  url.searchParams.set("render", "another-render");
  expect((await t.fetch(url.pathname + url.search)).status).toBe(404);
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
  await t.run((ctx) => ctx.db.patch("devices", deviceId, { banned: true }));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "device_banned" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects facts under review, catalogue-only research and retired artworks before spending", async () => {
  const { t, as, args, artworkId, fetcher } = await setup();
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetNeedsReview: true }));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("artworks", artworkId, { factSheetNeedsReview: undefined });
    await patchArtworkContent(ctx, { _id: artworkId }, { factSheet: [catalogueFact] });
  });
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: artworkId }, { factSheet: researchFixture });
    await ctx.db.patch("artworks", artworkId, { retiredAt: Date.now() });
  });
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("is independent of the written docent and re-renders only when the research is rewritten", async () => {
  const { t, artworkId, fetcher, rows, files, render } = await setup();
  await t.run((ctx) => patchArtworkContent(ctx, { _id: artworkId }, { docent: undefined }));
  const first = await render();
  await t.run((ctx) =>
    patchArtworkContent(
      ctx,
      { _id: artworkId },
      {
        docent: {
          en: [{ sentence: "Changed written docent.", factIds: ["f1"] }],
        },
      },
    ),
  );
  expect((await render()).renderId).toBe(first.renderId);
  const previous = await files();
  const updatedFacts = researchFixture.map((fact) => ({
    ...fact,
    text: `${fact.text} Corrected evidence.`,
  }));
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: artworkId }, { factSheet: updatedFacts });
    await ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 });
  });
  const updated = await render();
  expect(updated.renderId).not.toBe(first.renderId);
  expect(
    JSON.parse((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body as string).messages[1].content,
  ).toContain("Corrected evidence.");
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(([url]) => !url.includes("tavily"))).toBe(true);
  expect(await rows()).toHaveLength(1);
  const remaining = new Set((await files()).map((file) => file._id));
  expect(previous.filter((file) => remaining.has(file._id))).toEqual([]);
});

it("re-renders from corrected artwork metadata even when the research is unchanged", async () => {
  const { t, as, artworkId, fetcher, render } = await setup();
  const first = await render();
  await t.run((ctx) =>
    ctx.db.patch("artworks", artworkId, {
      title: "Nymphéas",
      artist: "Attributed to Claude Monet",
      date: "1917",
    }),
  );
  const opening = "Attributed to Claude Monet. Nymphéas. Dated 1917.";
  expect((await as.query(api.artworks.enrichment, { artworkId }))?.narrationOpening).toBe(opening);
  const updated = await render();
  expect(updated.renderId).not.toBe(first.renderId);
  expect(updated.sentences).toEqual([{ sentence: opening, factIds: [] }, ...guideBodyFixture]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const speech = JSON.parse((fetcher.mock.calls[3] as unknown as [string, RequestInit])[1].body as string);
  expect(speech.input.startsWith(`${opening} ${guideBodyFixture[0].sentence}`)).toBe(true);
});

it("re-renders audio that was made with another voice or model", async () => {
  const { t, fetcher, rows, render } = await setup();
  const first = await render();
  const entry = (await rows())[0];
  await t.run((ctx) => ctx.db.patch("narrationAudio", entry._id, { voice: "previous-voice" }));
  expect((await render()).renderId).not.toBe(first.renderId);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch("narrationAudio", row._id, { guideModel: "previous-model" });
  });
  await render();
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("tells the client which render is current only once its file is stored and while it is fresh", async () => {
  const { t, as, args, artworkId, fetcher } = await setup();
  const held = heldSpeech();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const current = async () => (await as.query(api.artworks.enrichment, { artworkId }))?.narrationRenderId;
  expect(await current()).toBeUndefined();
  const first = await as.action(api.narration.render, args);
  expect(await current()).toBeUndefined();
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect(await current()).toBe(first.renderId);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 }));
  expect(await current()).toBeUndefined();
});

it("clears every rendering and its audio so the next play renders again", async () => {
  const { t, fetcher, rows, files, render } = await setup();
  const first = await render();
  expect(await t.mutation(internal.narration.clear, {})).toBe(1);
  expect(await rows()).toHaveLength(0);
  expect(await files()).toEqual([]);
  expect((await render()).renderId).not.toBe(first.renderId);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("releases failed generations, hides provider response details, and permits retry", async () => {
  const { t, as, args, fetcher, rows, render } = await setup();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(new Response("Sensitive provider error", { status: 429 }));
  const failure = await as.action(api.narration.render, args).catch((error: unknown) => error);
  expect(failure).toMatchObject({ data: { code: "narration_provider_failed" } });
  expect(JSON.stringify(failure)).not.toContain("Sensitive");
  await t.finishInProgressScheduledFunctions();
  expect(await rows()).toHaveLength(0);
  expect((await render()).uri).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("releases a stream that drops midway and deletes the segments it already stored", async () => {
  const { t, as, args, fetcher, rows, files } = await setup();
  const held = heldSpeech("fail");
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const live = await as.action(api.narration.render, args);
  expect(await files()).toHaveLength(1);
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect(await rows()).toHaveLength(0);
  expect(await files()).toEqual([]);
  expect((await t.fetch(path(live.uri))).status).toBe(404);
});

it("allows only one generation claim and rejects a late completion after a stale claim is replaced", async () => {
  const { t, as, args, rows } = await setup();
  const first = await as.mutation(internal.narration.claim, {
    ...args,
    claim: "first",
  });
  const second = await as.mutation(internal.narration.claim, {
    ...args,
    claim: "second",
  });
  expect(first.owned).toBe(true);
  expect(second.owned).toBe(false);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch("narrationAudio", row._id, { claimedAt: Date.now() - 181_000 });
  });
  expect(
    (
      await as.mutation(internal.narration.claim, {
        ...args,
        claim: "replacement",
      })
    ).owned,
  ).toBe(true);
  const storageId = await t.run((ctx) => fileStorage.store(ctx, new Blob(["obsolete"])));
  await t.mutation(internal.narration.finish, { ...args, claim: "first", storageId });
  expect(await t.run((ctx) => fileStorage.get(ctx, storageId))).toBeNull();
  const entries = await rows();
  expect(entries).toHaveLength(1);
  expect(entries[0].claim).toBe("replacement");
  expect(entries[0].storageId).toBeUndefined();
});

it("takes over a shared generation once its owner releases it instead of waiting out the poll", async () => {
  vi.useFakeTimers();
  const { t, as, args, fetcher } = await setup();
  expect((await as.mutation(internal.narration.claim, { ...args, claim: "failing" })).owned).toBe(true);
  const waiting = as.action(api.narration.render, args);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetcher).not.toHaveBeenCalled();
  await t.mutation(internal.narration.finish, { ...args, claim: "failing" });
  await vi.advanceTimersByTimeAsync(2000);
  expect((await waiting).sentences).toEqual(guideFixture);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("deletes its speech when the research changes while it is being spoken", async () => {
  const { t, as, args, artworkId, fetcher, rows, files } = await setup();
  const held = heldSpeech();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const live = await as.action(api.narration.render, args);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 }));
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect(await rows()).toHaveLength(0);
  expect(await files()).toEqual([]);
  expect((await t.fetch(path(live.uri))).status).toBe(404);
});

it("retries once naming the sentence whose evidence span is not verbatim, then speaks the fixed script", async () => {
  const { t, fetcher, render } = await setup();
  const invented = [
    ...script.slice(0, 9),
    {
      sentence: "The lilies float serenely in the evening light of Giverny.",
      fact_ids: ["f1"],
      support: "lilies float serenely",
    },
  ];
  fetcher.mockResolvedValueOnce(completion(invented));
  expect((await render()).sentences).toEqual(guideFixture);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const request = (call: number) =>
    JSON.parse((fetcher.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
  const retry = request(1);
  expect(retry.messages[1].content).toContain("lilies float serenely");
  expect(retry.messages[1].content).toContain("not verbatim");
  // Neither call reasons; thin research asks for a five-sentence story.
  expect(request(0).chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(retry.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(retry.response_format.json_schema.schema.properties.story.minItems).toBe(5);
  expect((await t.run((ctx) => ctx.db.query("dailySpend").take(1)))[0].tokenFactoryCalls).toBe(2);
});

it("asks for the thin-research length, not the full one, when a script from thin research is too short", async () => {
  const { as, args, fetcher } = await setup();
  fetcher.mockResolvedValueOnce(completion(script.slice(0, 2)));
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
  const retry = JSON.parse(
    JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages[1].content,
  );
  expect(retry.previousAttemptProblems).toContain("90 to 225 words after the opening");
});

it("rejects invented citations before generating speech and releases the claim for retry", async () => {
  const { as, args, fetcher, rows } = await setup();
  fetcher.mockResolvedValueOnce(
    completion([
      {
        sentence: "An unsupported story.",
        fact_ids: ["invented"],
        support: "unsupported",
      },
    ]),
  );
  fetcher.mockResolvedValueOnce(
    completion([
      {
        sentence: "An unsupported story.",
        fact_ids: ["invented"],
        support: "unsupported",
      },
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
