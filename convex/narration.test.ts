import { afterEach, expect, it, vi } from "vitest";

import { guideShape } from "../shared/audio/guide";
import { guideBodyFixture, guideFixture, researchFixture, sectionedGuide } from "../shared/audio/guide-fixtures";
import { SPEECH_MODEL, SPEECH_VOICE } from "../shared/audio/speech";
import { api, internal } from "./_generated/api";
import * as docent from "./docent";
import { patchArtworkContent } from "./lib/artworkContent";
import { fileStorage } from "./lib/fileStorage";
import { FRAME_BYTES, speechMp3 } from "./lib/hls.fixtures";
import { completion as chat, jsonResponse } from "./lib/labelFixtures";
import { r2 } from "./lib/r2";
import { readSpend, seedArtworkWithObject, seedDevice } from "./lib/testFactories";
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
function heldSpeech(ending: "finish" | "fail" = "finish", firstFrames = 100) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let pulls = 0;
  const cancel = vi.fn<() => void>();
  const body = new ReadableStream<Uint8Array>({
    cancel,
    async pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(spokenBytes.subarray(0, firstFrames * FRAME_BYTES));
        return;
      }
      await held;
      if (ending === "fail") {
        controller.error(new Error("Connection reset"));
        return;
      }
      controller.enqueue(spokenBytes.subarray(firstFrames * FRAME_BYTES));
      controller.close();
    },
  });
  return { response: speech(body), release, cancel };
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
async function setup({ researched = true } = {}) {
  const t = harness();
  const device = await seedDevice(t);
  const { artworkId, vectorId } = await t.run((ctx) =>
    seedArtworkWithObject(
      ctx,
      researched
        ? {
            artwork: { factSheetUpdatedAt: 5 },
            artworkContent: {
              docent: { en: sentences },
              factSheet: [...researchFixture, catalogueFact],
            },
          }
        : {},
    ),
  );
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("OPENAI_API_KEY", "test-only-secret");
  vi.stubEnv("NEBIUS_API_KEY", "test-nebius-secret");
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    url.includes("tokenfactory") ? completion() : speech(),
  );
  vi.stubGlobal("fetch", fetcher);
  const rows = () => t.run((ctx) => ctx.db.query("narrationAudio").take(10));
  const { archiveId } = (await t.run((ctx) => ctx.db.get("vectors", vectorId)))!;
  const files = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("files").collect()).filter((file) => file.state === "ready" && file._id !== archiveId),
    );
  // Plays through the live playlist, then waits for the whole file to be stored.
  const render = async (as: typeof device.as = device.as) => {
    const audio = await as.action(api.narration.render, { artworkId });
    await t.finishInProgressScheduledFunctions();
    return audio;
  };
  return { t, ...device, artworkId, fetcher, rows, files, render, args: { artworkId } };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ARTICLE = "https://en.wikipedia.org/wiki/Water_Lilies_(Monet_series)";
const FACT_SHEET_MODEL = "test-fact-sheet-model";
const DOCENT_MODEL = "test-docent-model";
// Answers a first play's research with one article holding the shared research, so the guide fixture fits it.
function answerResearch(
  fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>,
  results = [
    {
      url: ARTICLE,
      title: "Water Lilies",
      content: "Monet's pond.",
      raw_content: researchFixture.map((fact) => fact.text).join(" "),
      score: 0.9,
    },
  ],
) {
  vi.stubEnv("TAVILY_API_KEY", "test-tavily");
  vi.stubEnv("FACT_SHEET_MODEL", FACT_SHEET_MODEL);
  vi.stubEnv("DOCENT_MODEL", DOCENT_MODEL);
  fetcher.mockImplementation(async (url, init) => {
    if (url.includes("tavily")) return jsonResponse({ results, usage: { credits: 1 } });
    if (!url.includes("tokenfactory")) return speech();
    const { model } = JSON.parse(String(init?.body));
    if (model === FACT_SHEET_MODEL) {
      return chat(researchFixture.map(({ text }) => ({ text })));
    }
    if (model === DOCENT_MODEL) {
      return chat([
        { sentence: "Monet painted the lilies and their reflections across the pond.", fact_ids: ["f1"] },
        { sentence: "He returned to the garden again and again to study its changing light.", fact_ids: ["f2"] },
      ]);
    }
    return completion();
  });
}
const searches = (fetcher: { mock: { calls: unknown[][] } }) =>
  fetcher.mock.calls.filter(([url]) => String(url).includes("tavily")).length;

it("researches a work on its first play and narrates from that research, then replays without researching", async () => {
  const { t, as, args, fetcher } = await setup({ researched: false });
  answerResearch(fetcher);
  expect(await as.query(api.artworks.enrichment, args)).toMatchObject({ narrationAvailable: true });
  expect((await as.query(api.artworks.enrichment, args))?.narrationFacts).toBeUndefined();

  const first = await as.action(api.narration.render, args);
  expect(first).toMatchObject({ sentences: guideFixture, researchUpdatedAt: expect.any(Number) });
  expect(first.facts).toEqual(researchFixture.map(({ id }) => expect.objectContaining({ id, sourceUrl: ARTICLE })));
  await t.finishInProgressScheduledFunctions();
  const researched = searches(fetcher);
  expect(researched).toBeGreaterThan(0);
  expect((await as.query(api.artworks.enrichment, args))?.narrationFacts?.map(({ id }) => id)).toEqual(["f1", "f2"]);

  await as.action(api.narration.render, args);
  expect(searches(fetcher)).toBe(researched);
});

it.each(["rejected", "provider failure"])(
  "uses completed research for the first audio guide when the written docent has a %s",
  async (failure) => {
    const { t, as, args, fetcher } = await setup({ researched: false });
    answerResearch(fetcher);
    const answer = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (url.includes("tokenfactory") && JSON.parse(String(init?.body)).model === DOCENT_MODEL) {
        return failure === "provider failure"
          ? new Response("unavailable", { status: 400 })
          : chat([{ sentence: "This sentence cites an unknown fact.", fact_ids: ["missing"] }]);
      }
      return answer(url, init);
    });
    const first = await as.action(api.narration.render, args);
    await t.finishInProgressScheduledFunctions();
    expect(first.sentences).toEqual(guideFixture);
    expect(first.facts).toHaveLength(researchFixture.length);
    expect(await t.run((ctx) => ctx.db.get("artworks", args.artworkId))).toHaveProperty("docentFailedAt");
    const researched = searches(fetcher);
    expect((await as.action(api.narration.render, args)).renderId).toBe(first.renderId);
    expect(searches(fetcher)).toBe(researched);
  },
);

it.each(["invalidated", "held for review"])(
  "does not narrate research %s while the written docent fails",
  async (change) => {
    const { t, as, args, fetcher, rows } = await setup({ researched: false });
    answerResearch(fetcher);
    const answer = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (url.includes("tokenfactory") && JSON.parse(String(init?.body)).model === DOCENT_MODEL) {
        if (change === "invalidated") {
          await t.mutation(internal.docent.invalidateDocent, { ...args, includeResearch: true });
        } else {
          await t.run((ctx) => ctx.db.patch("artworks", args.artworkId, { factSheetNeedsReview: true }));
        }
        return new Response("unavailable", { status: 400 });
      }
      return answer(url, init);
    });
    await expect(as.action(api.narration.render, args)).rejects.toMatchObject({ data: { code: "model_error" } });
    expect(await rows()).toEqual([]);
    expect(fetcher.mock.calls.some(([url]) => url.includes("audio/speech"))).toBe(false);
  },
);

it("starts writing the guide once the research is saved, while the written docent is still drafted", async () => {
  const { t, as, args, fetcher } = await setup({ researched: false });
  answerResearch(fetcher);
  const answer = fetcher.getMockImplementation()!;
  let releaseDocent!: () => void;
  const docentHeld = new Promise<void>((resolve) => (releaseDocent = resolve));
  let guideWhileDrafting = false;
  let drafting = false;
  fetcher.mockImplementation(async (url, init) => {
    const model = url.includes("tokenfactory") ? JSON.parse(String(init?.body)).model : undefined;
    if (model === DOCENT_MODEL) {
      drafting = true;
      await docentHeld;
      drafting = false;
    }
    if (model === "nvidia/Nemotron-3-Ultra-550b-a55b") {
      guideWhileDrafting = drafting;
      releaseDocent();
    }
    return answer(url, init);
  });
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
  await t.finishInProgressScheduledFunctions();
  expect(guideWhileDrafting).toBe(true);
  expect(await t.run((ctx) => ctx.db.get("artworks", args.artworkId))).toHaveProperty("docentUpdatedAt");
});

it("waits for research already in flight, such as a scan's, instead of starting another", async () => {
  vi.useFakeTimers();
  const { t, as, args, artworkId, fetcher } = await setup({ researched: false });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: Date.now() }));
  const waiting = as.action(api.narration.render, args);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetcher).not.toHaveBeenCalled();
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: artworkId }, { factSheet: researchFixture });
    await ctx.db.patch("artworks", artworkId, { enrichClaimedAt: undefined, factSheetUpdatedAt: 5 });
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect((await waiting).sentences).toEqual(guideFixture);
  expect(searches(fetcher)).toBe(0);
});

it("waits for another research run when it loses the claim after reading missing research", async () => {
  vi.useFakeTimers();
  const { t, as, args, artworkId, fetcher } = await setup({ researched: false });
  // Another listener claims between this request's read and its claim attempt.
  vi.spyOn(docent, "researchArtwork").mockImplementationOnce(async (ctx, id) => {
    await ctx.runMutation(internal.docent.claim, { artworkId: id });
  });
  let settled = false;
  const waiting = as.action(api.narration.render, args).then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(settled).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: artworkId }, { factSheet: researchFixture });
    await ctx.db.patch("artworks", artworkId, { enrichClaimedAt: undefined, factSheetUpdatedAt: 5 });
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await waiting).toMatchObject({ sentences: guideFixture });
});

it("tells a first play there is no guide when its research finds nothing to cite, then stops offering one", async () => {
  const { as, args, fetcher } = await setup({ researched: false });
  answerResearch(fetcher, []);
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(fetcher.mock.calls.some(([url]) => url.includes("tokenfactory"))).toBe(false);
  expect((await as.query(api.artworks.enrichment, args))?.narrationAvailable).toBe(false);
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
    // Catalogue lines never reach the guide, so the listener learns only the facts it cites.
    facts: researchFixture.map(({ id, sourceUrl, sourceLabel }) => ({ id, sourceUrl, sourceLabel })),
    researchUpdatedAt: 5,
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
  // Source names and URLs never reach the writer.
  expect(JSON.parse(authoring.messages[1].content).research).toEqual(
    researchFixture.map(({ id, text }) => ({ id, text })),
  );
  expect((await readSpend(t))?.tokenFactoryCalls).toBe(1);
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
  expect(updated.sentences).toEqual([{ sentence: opening, factIds: [], section: "hook" }, ...guideBodyFixture]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const speech = JSON.parse((fetcher.mock.calls[3] as unknown as [string, RequestInit])[1].body as string);
  expect(speech.input.startsWith(`${opening} ${guideBodyFixture[0].sentence}`)).toBe(true);
});

it("speaks the kept script again for a new voice and rewrites it only for a new guide model", async () => {
  const { t, fetcher, rows, render } = await setup();
  const first = await render();
  const entry = (await rows())[0];
  await t.run((ctx) => ctx.db.patch("narrationAudio", entry._id, { voice: "previous-voice" }));
  const respoken = await render();
  expect(respoken.renderId).not.toBe(first.renderId);
  expect(respoken.sentences).toEqual(first.sentences);
  // Speech only: the voice change costs no Token Factory call.
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("tokenfactory"))).toHaveLength(1);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch("narrationAudio", row._id, { guideModel: "previous-model" });
  });
  await render();
  expect(fetcher).toHaveBeenCalledTimes(5);
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

it.each([true, false])(
  "keeps the script and retries speech with the author provider configured=%s",
  async (configured) => {
    const { t, as, args, fetcher, rows, render } = await setup();
    fetcher.mockResolvedValueOnce(completion());
    fetcher.mockResolvedValueOnce(new Response("Sensitive provider error", { status: 429 }));
    const failure = await as.action(api.narration.render, args).catch((error: unknown) => error);
    expect(failure).toMatchObject({ data: { code: "narration_provider_failed" } });
    expect(JSON.stringify(failure)).not.toContain("Sensitive");
    await t.finishInProgressScheduledFunctions();
    const [kept] = await rows();
    expect(kept).toMatchObject({ sentences: guideFixture });
    expect(kept).not.toHaveProperty("claim");
    expect(kept).not.toHaveProperty("segments");
    vi.stubEnv("NEBIUS_API_KEY", configured ? "test-nebius-secret" : "");
    expect((await render()).uri).toBeTruthy();
    // The retry paid for speech only.
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await readSpend(t))?.tokenFactoryCalls).toBe(1);
  },
);

it("cancels speech after a segment upload fails and keeps its script for retry", async () => {
  const { t, as, args, fetcher, rows, render } = await setup();
  const held = heldSpeech();
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  vi.mocked(r2.put).mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_provider_failed" },
  });
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect(held.cancel).toHaveBeenCalledOnce();
  expect((await rows())[0].sentences).toEqual(guideFixture);
  expect((await render()).sentences).toEqual(guideFixture);
  expect(fetcher.mock.calls.filter(([url]) => url.includes("tokenfactory"))).toHaveLength(1);
});

it.each(["first byte", "stream idle"])("reports a speech %s timeout and releases its claim", async (stage) => {
  vi.useFakeTimers();
  const { t, as, args, fetcher, rows } = await setup();
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  await as.mutation(internal.narration.claim, { ...args, claim: "timed-out" });
  await t.run(async (ctx) => {
    const entry = (await ctx.db.query("narrationAudio").take(1))[0];
    await ctx.db.patch("narrationAudio", entry._id, { sentences: guideFixture });
  });
  fetcher.mockImplementation(async (url, init) => {
    if (url.includes("ingest.sentry.io")) return new Response("{}", { status: 200 });
    const aborted = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (stage === "first byte") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(aborted()));
      });
    }
    return speech(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(spokenBytes.subarray(0, 100 * FRAME_BYTES));
          init?.signal?.addEventListener("abort", () => controller.error(aborted()));
        },
      }),
    );
  });
  const speaking = t.action(internal.narration.speak, { ...args, claim: "timed-out", input: "Private test script." });
  await vi.advanceTimersByTimeAsync(21_000);
  await speaking;
  expect((await rows())[0]).toMatchObject({ sentences: guideFixture });
  expect((await rows())[0].claim).toBeUndefined();
  expect((await rows())[0].segments).toBeUndefined();
  const reports = fetcher.mock.calls.filter(([url]) => url.includes("ingest.sentry.io"));
  expect(reports).toHaveLength(1);
  const event = JSON.parse(String(reports[0][1]?.body).split("\n")[2]);
  expect(event.tags).toMatchObject({
    operation: "narration.speak",
    error_code: "narration_provider_failed",
    reason: "timeout",
  });
  expect(JSON.stringify(event)).not.toContain("Private test script");
});

it("cancels speech immediately when a later upload fails before an earlier upload finishes", async () => {
  const { t, as, args, fetcher, rows, files } = await setup();
  const held = heldSpeech("finish", 200);
  fetcher.mockResolvedValueOnce(completion()).mockResolvedValueOnce(held.response);
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(r2.put)
    .mockImplementationOnce(() => first)
    .mockRejectedValueOnce(new Error("Second segment failed"));
  const playing = as.action(api.narration.render, args).catch((error: unknown) => error);
  try {
    await vi.waitFor(() => expect(held.cancel).toHaveBeenCalledOnce());
  } finally {
    release();
    held.release();
    await playing;
    await t.finishInProgressScheduledFunctions();
  }
  expect(await playing).toMatchObject({ data: { code: "narration_provider_failed" } });
  expect((await rows())[0]).toMatchObject({ sentences: guideFixture });
  expect((await rows())[0].claim).toBeUndefined();
  expect(await files()).toEqual([]);
});

it("settles pending uploads before releasing a failed speech stream's claim", async () => {
  const { t, as, args, fetcher, rows } = await setup();
  const held = heldSpeech("fail");
  fetcher.mockResolvedValueOnce(completion()).mockResolvedValueOnce(held.response);
  let release!: () => void;
  let uploading!: () => void;
  const started = new Promise<void>((resolve) => {
    uploading = resolve;
  });
  const stored = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(r2.put).mockImplementationOnce(() => {
    uploading();
    return stored;
  });
  const playing = as.action(api.narration.render, args).catch((error: unknown) => error);
  await started;
  held.release();
  let finished = false;
  const speaking = t.finishInProgressScheduledFunctions().then(() => {
    finished = true;
  });
  try {
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
  } finally {
    release();
    await speaking;
    await playing;
  }
  expect((await rows())[0].claim).toBeUndefined();
  expect((await rows())[0].segments).toBeUndefined();
});

it("keeps cut-off speech private for a day, then deletes unreported segments", async () => {
  const { t, as, args, fetcher, rows, files } = await setup();
  const held = heldSpeech("fail");
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const live = await as.action(api.narration.render, args);
  expect(await files()).toHaveLength(1);
  held.release();
  await t.finishInProgressScheduledFunctions();
  expect((await rows()).map((row) => [row.claim, row.segments, row.sentences?.length])).toEqual([
    [undefined, undefined, guideFixture.length],
  ]);
  const retained = await files();
  expect(retained).toHaveLength(1);
  expect(retained[0].publicDownload).toBe(false);
  const [failure] = await t.run((ctx) => ctx.db.query("narrationFailures").collect());
  expect(failure.renderId).toBe(live.renderId);
  expect(failure.expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  expect((await t.fetch(path(live.uri))).status).toBe(404);
  await t.run((ctx) => ctx.db.patch("narrationFailures", failure._id, { expiresAt: Date.now() - 1 }));
  await t.mutation(internal.retention.expireBatch, {});
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, retained[0]._id))).toBeNull();
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

it("stops showing a crashed render's transcript as being written once its lease ends, unless renewed", async () => {
  vi.useFakeTimers();
  const { t, as, args } = await setup();
  await as.mutation(internal.narration.claim, { ...args, claim: "crashed" });
  const writing = async () => (await as.query(api.artworks.enrichment, args))?.narrationWriting;
  expect(await writing()).toBe(true);
  await vi.advanceTimersByTimeAsync(100_000);
  await as.mutation(internal.narration.renewClaim, { ...args, claim: "crashed" });
  await vi.advanceTimersByTimeAsync(81_000);
  await t.finishInProgressScheduledFunctions();
  expect(await writing()).toBe(true);
  await vi.advanceTimersByTimeAsync(100_000);
  await t.finishInProgressScheduledFunctions();
  expect(await writing()).toBe(false);
});

it("does not pay for research again on a play within an hour of a failed run", async () => {
  const { t, as, args, artworkId, fetcher } = await setup({ researched: false });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { docentFailedAt: Date.now() }));
  expect(await as.query(api.artworks.enrichment, args)).toMatchObject({ narrationAvailable: false });
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("takes over a generation whose owner stopped renewing its claim", async () => {
  vi.useFakeTimers();
  const { as, args, fetcher } = await setup();
  expect((await as.mutation(internal.narration.claim, { ...args, claim: "stuck" })).owned).toBe(true);
  const waiting = as.action(api.narration.render, args);
  await vi.advanceTimersByTimeAsync(179_000);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await waiting).sentences).toEqual(guideFixture);
});

it("reports a listener left waiting behind a generation that keeps its claim without speaking, naming the artwork", async () => {
  vi.useFakeTimers();
  const { as, args, artworkId, fetcher } = await setup();
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  expect((await as.mutation(internal.narration.claim, { ...args, claim: "stuck" })).owned).toBe(true);
  const waiting = as.action(api.narration.render, args).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100_000);
  await as.mutation(internal.narration.renewClaim, { ...args, claim: "stuck" });
  await vi.advanceTimersByTimeAsync(100_000);
  expect(await waiting).toMatchObject({ data: { code: "narration_busy" } });
  const [url, init] = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
  expect(url).toContain("ingest.sentry.io");
  const event = JSON.parse(String(init.body).split("\n")[2]);
  expect(event.tags).toMatchObject({
    operation: "narration.render",
    error_code: "narration_busy",
    artwork_id: artworkId,
  });
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
  // Neither call reasons; two facts ask for the short stop's story.
  expect(request(0).chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(retry.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(retry.response_format.json_schema.schema.properties.story.minItems).toBe(guideShape(2).story[0]);
  expect((await readSpend(t))?.tokenFactoryCalls).toBe(2);
});

it("speaks an overlong script without its last story sentences instead of paying for a rewrite", async () => {
  const { t, fetcher, render } = await setup();
  const extra = (word: string) => ({
    sentence: `Look ${word} at the lilies resting on the pond and the reflections of the garden around them today.`,
    fact_ids: ["f1"],
    support: supportFor.f1,
  });
  const extras = ["again", "closely", "slowly"].map(extra);
  // The fixture's 172 words and three 19-word story sentences run past the 225-word cap; one sentence goes.
  const sections = { ...sectionedGuide(script), story: [...script.slice(3, 9), ...extras] };
  fetcher.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(sections) } }] }));
  const takeaway = guideFixture.at(-1)!;
  const kept = extras.slice(0, 2).map(({ sentence, fact_ids }) => ({ sentence, factIds: fact_ids, section: "story" }));
  expect((await render()).sentences).toEqual([...guideFixture.slice(0, -1), ...kept, takeaway]);
  expect((await readSpend(t))?.tokenFactoryCalls).toBe(1);
});

it("retries a script that stalled at the token cap with sections that may end after one sentence", async () => {
  const { t, fetcher, render } = await setup();
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"story": [\n \n \n' }, finish_reason: "length" }] }),
    ),
  );
  expect((await render()).sentences).toEqual(guideFixture);
  const request = (call: number) =>
    JSON.parse((fetcher.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
  const retry = request(1);
  const { properties } = retry.response_format.json_schema.schema;
  expect(["hook", "look", "story", "takeaway"].map((section) => properties[section].minItems)).toEqual([1, 1, 1, 1]);
  expect(properties.story.maxItems).toBe(guideShape(2).story[1]);
  expect(JSON.parse(retry.messages[1].content)).not.toHaveProperty("previousAttemptProblems");
  expect((await readSpend(t))?.tokenFactoryCalls).toBe(2);
});

it("asks for the thin-research length, not the full one, when a script from thin research is too short", async () => {
  const { as, args, fetcher } = await setup();
  fetcher.mockResolvedValueOnce(completion(script.slice(0, 2)));
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
  const retry = JSON.parse(
    JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages[1].content,
  );
  expect(retry.previousAttemptProblems).toContain("words after the opening; it needs 40 to 225");
});

it("rejects invented citations before generating speech and lets one more play try again", async () => {
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
  expect((await rows()).map((row) => [row.claim, row.scriptFailures])).toEqual([[undefined, 1]]);
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
});

it("stops paying for a script that failed on two plays of the same research until the research changes", async () => {
  const { t, as, args, artworkId, fetcher, rows } = await setup();
  const tiny = () => completion(script.slice(0, 1));
  for (let play = 0; play < 2; play++) {
    fetcher.mockResolvedValueOnce(tiny()).mockResolvedValueOnce(tiny());
    await expect(as.action(api.narration.render, args)).rejects.toMatchObject({ data: { code: "model_error" } });
  }
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect((await rows())[0].scriptFailures).toBe(2);
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_unavailable" },
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await as.query(api.artworks.enrichment, args)).toMatchObject({ narrationAvailable: false });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 }));
  expect(await as.query(api.artworks.enrichment, args)).toMatchObject({ narrationAvailable: true });
  expect((await as.action(api.narration.render, args)).sentences).toEqual(guideFixture);
});

it("reports a missing speech key to Sentry and releases the claim before spending", async () => {
  const { as, args, fetcher, rows } = await setup();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
    data: { code: "narration_not_configured" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("ingest.sentry.io");
  expect(String(init.body)).toContain('"operation":"narration.render"');
  expect(String(init.body)).toContain('"value":"narration_not_configured"');
  expect(await rows()).toHaveLength(0);
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
  expect((await rows()).map((row) => [row.sentences, row.segments, row.storageId])).toEqual([
    [undefined, undefined, undefined],
  ]);
});

it.each([
  ["transcript", "wrongFacts"],
  ["transcript", "offensive"],
  ["audio", "glitches"],
  ["audio", "mispronounced"],
  ["audio", "mismatch"],
] as const)("saves a %s report for %s while preserving the script and playable audio", async (kind, reason) => {
  const { t, as, artworkId, fetcher, rows, files, render } = await setup();
  const first = await render();
  const beforeRows = await rows();
  const beforeFiles = await files();
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const beforeScheduled = await scheduled();
  const { reportId } = await as.mutation(api.reports.submit, {
    target: kind === "audio" ? { kind, artworkId, renderId: first.renderId } : { kind, artworkId },
    reason,
    details: "Please review this guide.",
  });
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    reason,
    details: "Please review this guide.",
    status: "open",
    evidence:
      kind === "transcript"
        ? { kind, artworkId, sentences: guideFixture.map(({ sentence }) => sentence) }
        : { kind, artworkId, renderId: first.renderId, speechModel: SPEECH_MODEL, voice: SPEECH_VOICE },
  });
  expect(await rows()).toEqual(beforeRows);
  expect(await files()).toEqual(
    beforeFiles.map((file) => ({
      ...file,
      refCount: file.refCount + (kind === "audio" && file._id === beforeRows[0].storageId ? 1 : 0),
    })),
  );
  expect(await scheduled()).toEqual(beforeScheduled);
  const next = await render();
  expect(next.renderId).toBe(first.renderId);
  expect(next.sentences).toEqual(first.sentences);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(["docent", "transcript", "audio"] as const)(
  "revokes playing audio and cancels its generation when a %s report is removed",
  async (kind) => {
    const { t, as, artworkId, args, fetcher, rows } = await setup();
    const held = heldSpeech();
    fetcher.mockResolvedValueOnce(completion());
    fetcher.mockResolvedValueOnce(held.response);
    const live = await as.action(api.narration.render, args);
    const [entry] = await rows();
    const segmentId = entry.segments![0].storageId;
    const { reportId } = await as.mutation(api.reports.submit, {
      target: kind === "audio" ? { kind, artworkId, renderId: live.renderId } : { kind, artworkId },
      reason: kind === "audio" ? "glitches" : "offensive",
    });
    await t.mutation(internal.review.decideReport, {
      reportId,
      operator: "reviewer",
      decision: "remove",
      reason: "Confirmed",
    });
    expect((await t.fetch(path(live.uri))).status).toBe(404);
    expect(await t.query(internal.files.downloadable, { id: segmentId })).toBeNull();
    expect(await t.query(internal.narration.progress, { artworkId, claim: live.renderId })).toBeNull();
    held.release();
    await t.finishInProgressScheduledFunctions();
    expect(await rows()).toHaveLength(0);
    await expect(as.action(api.narration.render, args)).rejects.toMatchObject({
      data: { code: "narration_unavailable" },
    });
    expect(await t.run(async (ctx) => !!(await fileStorage.get(ctx, segmentId)))).toBe(kind === "audio");
  },
);

it("retains reported audio and transcript through cache replacement and clearing", async () => {
  const { t, as, artworkId, rows, render } = await setup();
  const first = await render();
  const [{ storageId }] = await rows();
  const target = { kind: "audio" as const, artworkId, renderId: first.renderId };
  const { reportId } = await as.mutation(api.reports.submit, { target, reason: "mismatch" });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 }));
  const replacement = await render();
  expect(replacement.renderId).not.toBe(first.renderId);
  await t.mutation(internal.narration.clear, {});
  const retained = await t.run(async (ctx) => (await fileStorage.get(ctx, storageId!))!.arrayBuffer());
  expect(new Uint8Array(retained)).toEqual(spokenBytes);
  expect(await t.query(internal.files.downloadable, { id: storageId! })).toBeNull();
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    status: "open",
    evidence: {
      renderId: first.renderId,
      fileIds: [storageId],
      sentences: first.sentences.map(({ sentence }) => sentence),
    },
  });
  expect(await t.action(internal.review.reportAudio, { reportId })).toEqual([`https://r2.test/download/${storageId}`]);
});

it("reports the failed render after another listener retries and retains its evidence past expiry", async () => {
  const { t, as, artworkId, args, fetcher, render } = await setup();
  const held = heldSpeech("fail");
  fetcher.mockResolvedValueOnce(completion());
  fetcher.mockResolvedValueOnce(held.response);
  const live = await as.action(api.narration.render, args);
  held.release();
  await t.finishInProgressScheduledFunctions();
  const replacement = await render();
  expect(replacement.renderId).not.toBe(live.renderId);
  const input = { target: { kind: "audio" as const, artworkId, renderId: live.renderId }, reason: "glitches" as const };
  const { reportId } = await as.mutation(api.reports.submit, input);
  expect(await as.mutation(api.reports.submit, input)).toEqual({ reportId });
  const [failure] = await t.run((ctx) => ctx.db.query("narrationFailures").collect());
  await t.run((ctx) => ctx.db.patch("narrationFailures", failure._id, { expiresAt: Date.now() - 1 }));
  await t.mutation(internal.retention.expireBatch, {});
  expect(await t.run(async (ctx) => (await fileStorage.get(ctx, failure.fileIds[0]))?.size ?? 0)).toBeGreaterThan(0);
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    evidence: { renderId: live.renderId, fileIds: failure.fileIds },
  });
  expect(await t.query(internal.files.downloadable, { id: failure.fileIds[0] })).toBeNull();
  const other = await seedDevice(t);
  await expect(other.as.mutation(api.reports.submit, input)).rejects.toMatchObject({ data: { code: "not_found" } });
});

it("rejects an audio report for another artwork's render", async () => {
  const { t, as, render } = await setup();
  const first = await render();
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(
    as.mutation(api.reports.submit, {
      target: { kind: "audio", artworkId, renderId: first.renderId },
      reason: "glitches",
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
});
