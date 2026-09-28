import { ConvexError, v } from "convex/values";

import {
  GUIDE_MAX_WORDS,
  GUIDE_MODEL,
  GUIDE_PROMPT,
  guideOpening,
  guideResearch,
  guideSchema,
  guideWordFloor,
  parseGuideLines,
  unsupportedLines,
  validateGuide,
} from "../shared/audio/guide";
import { SPEECH_INSTRUCTIONS, SPEECH_MODEL, SPEECH_VOICE } from "../shared/audio/speech";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  env,
  httpAction,
  internalAction,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internalMutation } from "./functions";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice, requireDeviceFromAction } from "./lib/auth";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { createSegmenter, eventPlaylist, type PackedSegment } from "./lib/hls";
import {
  liveNarration,
  narrationCurrent,
  narrationEntry,
  narrationFiles,
  narrationProvenance,
  renderedNarration,
  scriptCurrent,
  type RenderedNarration,
} from "./lib/narrationCache";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { limitDevice, limitKey } from "./lib/rateLimits";
import { reserveSpend } from "./lib/spend";
import { chatJson } from "./lib/tokenFactory";
import { docentSentence, factSheetEntry, type DocentSentence, type FactSheetEntry } from "./lib/validators";

const audio = v.object({
  uri: v.string(),
  sentences: v.array(docentSentence),
  renderId: v.string(),
  live: v.boolean(),
});
const segment = v.object({ storageId: v.id("files"), duration: v.number() });
const LEASE_MS = 180_000;
const FIRST_SEGMENT_POLL_MS = 250;
const FIRST_SEGMENT_TIMEOUT_MS = 30_000;
// Long enough for a listener who paused the live playlist to finish it; later plays get the whole file.
const SEGMENT_RETENTION_MS = 60 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function deleteFiles(ctx: MutationCtx, entry: Doc<"narrationAudio">) {
  await Promise.all(narrationFiles(entry).map((storageId) => fileStorage.delete(ctx, storageId)));
}

export const claim = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.object({
    owned: v.boolean(),
    audio: v.union(audio, v.null()),
    facts: v.array(factSheetEntry),
    opening: v.string(),
    sentences: v.optional(v.array(docentSentence)),
  }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", args.artworkId);
    if (!artwork || artwork.retiredAt || artwork.identityStatus !== "established" || artwork.factSheetNeedsReview) {
      throw new ConvexError({ code: "narration_unavailable" });
    }
    const content = await readArtworkContent(ctx, artwork);
    const facts = guideResearch(content?.factSheet ?? []);
    if (facts.length === 0) throw new ConvexError({ code: "narration_unavailable" });
    const opening = guideOpening(artwork);
    const audio = await renderedNarration(ctx, artwork);
    if (audio) return { facts, opening, owned: false, audio };
    const entry = await narrationEntry(ctx, artwork._id);
    if (entry?.claimedAt !== undefined && narrationCurrent(entry, artwork) && Date.now() - entry.claimedAt < LEASE_MS) {
      return { facts, opening, owned: false, audio: liveNarration(entry, artwork) };
    }
    await limitDevice(ctx, "narration", device._id);
    await limitKey(ctx, "narrationDaily", "global");
    // A script written from this research and opening is spoken again; only its audio is replaced.
    const sentences = entry && scriptCurrent(entry, artwork) ? entry.sentences : undefined;
    const fields = {
      artworkId: artwork._id,
      claim: args.claim,
      claimedAt: Date.now(),
      ...narrationProvenance(artwork),
      storageId: undefined,
      sentences,
      segments: undefined,
    };
    if (entry) {
      await ctx.db.replace("narrationAudio", entry._id, fields);
      await deleteFiles(ctx, entry);
    } else {
      await ctx.db.insert("narrationAudio", fields);
    }
    return { facts, opening, owned: true, audio: null, sentences };
  },
});

// Stores the script and starts speaking it; false once the claim was released or replaced.
export const scripted = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string(), sentences: v.array(docentSentence) },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, claim, sentences }) => {
    const entry = await narrationEntry(ctx, artworkId);
    if (entry?.claim !== claim) return false;
    await ctx.db.patch("narrationAudio", entry._id, { sentences });
    await ctx.scheduler.runAfter(0, internal.narration.speak, {
      artworkId,
      claim,
      input: sentences.map((line) => line.sentence).join(" "),
    });
    return true;
  },
});

export const appendSegment = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string(), segment },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, claim, segment: added }) => {
    const entry = await narrationEntry(ctx, artworkId);
    if (entry?.claim !== claim || entry.storageId) {
      await fileStorage.delete(ctx, added.storageId);
      return false;
    }
    await retainFile(ctx, added.storageId, true);
    await ctx.db.patch("narrationAudio", entry._id, { segments: [...(entry.segments ?? []), added] });
    return true;
  },
});

// With the finished file, completes the claim; without it, or once stale, releases the claim and its
// files, keeping the script while the research and opening it was written from are current.
export const finish = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    claim: v.string(),
    storageId: v.optional(v.id("files")),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim, storageId }) => {
    const entry = await narrationEntry(ctx, artworkId);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (entry?.claim === claim && storageId && artwork && narrationCurrent(entry, artwork)) {
      await retainFile(ctx, storageId, true);
      await ctx.db.patch("narrationAudio", entry._id, { storageId });
      await ctx.scheduler.runAfter(SEGMENT_RETENTION_MS, internal.narration.dropSegments, { artworkId, claim });
      return null;
    }
    if (storageId) await fileStorage.delete(ctx, storageId);
    if (entry?.claim === claim) {
      // The row must drop its references before the files can go; the reference count holds them.
      if (artwork && entry.sentences && scriptCurrent(entry, artwork)) {
        await ctx.db.patch("narrationAudio", entry._id, {
          claim: undefined,
          claimedAt: undefined,
          storageId: undefined,
          segments: undefined,
        });
      } else {
        await ctx.db.delete("narrationAudio", entry._id);
      }
      await deleteFiles(ctx, entry);
    }
    return null;
  },
});

export const dropSegments = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim }) => {
    const entry = await narrationEntry(ctx, artworkId);
    if (entry?.claim !== claim || !entry.storageId || !entry.segments) return null;
    await ctx.db.patch("narrationAudio", entry._id, { segments: undefined });
    await Promise.all(entry.segments.map(({ storageId }) => fileStorage.delete(ctx, storageId)));
    return null;
  },
});

// What the claim's owner can hand its listener; null once the claim is released, replaced or stale.
export const progress = internalQuery({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.union(v.object({ audio: v.union(audio, v.null()) }), v.null()),
  handler: async (ctx, { artworkId, claim }) => {
    const entry = await narrationEntry(ctx, artworkId);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (entry?.claim !== claim || !artwork || !narrationCurrent(entry, artwork)) return null;
    return { audio: (await renderedNarration(ctx, artwork)) ?? liveNarration(entry, artwork) };
  },
});

export const listing = internalQuery({
  args: { artworkId: v.string(), render: v.string() },
  returns: v.union(
    v.object({
      segments: v.array(v.object({ uri: v.string(), duration: v.number() })),
      ended: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const artworkId = ctx.db.normalizeId("artworks", args.artworkId);
    const entry = artworkId ? await narrationEntry(ctx, artworkId) : null;
    if (entry?.claim !== args.render || !entry.segments?.length) return null;
    const segments = [];
    for (const { storageId, duration } of entry.segments) {
      const uri = await fileStorage.getUrl(ctx, storageId);
      if (!uri) return null;
      segments.push({ uri, duration });
    }
    return { segments, ended: entry.storageId !== undefined };
  },
});

export const playlist = httpAction(async (ctx, request) =>
  withErrorReporting("narration.playlist", async () => {
    const params = new URL(request.url).searchParams;
    const listed = await ctx.runQuery(internal.narration.listing, {
      artworkId: params.get("artworkId") ?? "",
      render: params.get("render") ?? "",
    });
    if (!listed) {
      return new Response("Narration unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(eventPlaylist(listed.segments, listed.ended), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }),
);

// Explicit invalidation: `npx convex run narration:clear` after a prompt or delivery change worth
// re-rendering. Research, metadata, model and voice changes re-render on their own at play time.
export const clear = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let cleared = 0;
    for await (const entry of ctx.db.query("narrationAudio")) {
      await ctx.db.delete("narrationAudio", entry._id);
      await deleteFiles(ctx, entry);
      cleared++;
    }
    return cleared;
  },
});

// Writes the stop from the research and returns the whole script, opening first.
async function authorScript(ctx: ActionCtx, facts: FactSheetEntry[], opening: string): Promise<DocentSentence[]> {
  const day = await reserveSpend(ctx, "tokenFactory", 2);
  let calls = 0;
  const factIds = new Set(facts.map((fact) => fact.id));
  let problems: string[] = [];
  const parse = (value: unknown) => {
    problems = [];
    const lines = parseGuideLines(value);
    if (!lines) {
      problems.push(
        "The response was not a thread, a quote and hook, look, story and takeaway lists of sentence, fact_ids and support.",
      );
      return null;
    }
    problems = unsupportedLines(lines, facts).map(
      (line) => `The support "${line.support}" is not verbatim in the facts cited for "${line.sentence}".`,
    );
    if (problems.length > 0) return null;
    const guide = validateGuide(
      [
        { sentence: opening, factIds: [] },
        ...lines.map(({ sentence, fact_ids }) => ({
          sentence,
          factIds: fact_ids,
        })),
      ],
      factIds,
      opening,
    );
    if (!guide) {
      problems.push(
        `The script broke a format rule: ${guideWordFloor(facts.length)} to ${GUIDE_MAX_WORDS} words after the opening, only real fact ids, every sentence ending in punctuation, no repeated sentence.`,
      );
    }
    return guide;
  };
  // One pass without reasoning: about 3 seconds against 15 to 35 with low-effort thinking, the same
  // pass rate and fewer invented claims on the 2026-09-25 eval, and no runaway thinking that hits the cap.
  const schema = guideSchema(facts.length);
  const write = (previousAttemptProblems?: string) =>
    chatJson({
      model: GUIDE_MODEL,
      system: GUIDE_PROMPT,
      // The schema stays in the prompt here: without it 4 of 12 scripts broke the length rules on the
      // 2026-09-28 check and the retry cost more than the 500 tokens saved.
      user: JSON.stringify({
        task: "Write the continuation of this audio guide stop from the research. Do not repeat the opening.",
        ...(previousAttemptProblems ? { previousAttemptProblems } : {}),
        opening,
        research: facts,
        schema,
      }),
      schemaName: "audioGuide",
      schema,
      maxTokens: 12_000,
      timeoutMs: 60_000,
      parse,
    });
  try {
    let script;
    try {
      script = await write();
    } catch (error) {
      // One more attempt, with the rejected sentences named; pointed feedback lands better than the rules did.
      if (!(error instanceof ConvexError && error.data.reason === "schema")) {
        throw error;
      }
      calls += error.data.calls;
      script = await write(
        `Your previous script was rejected. ${problems.join(" ")} Fix these and return the whole script again.`,
      );
    }
    calls += script.calls;
    return script.value;
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data.calls === "number") {
      calls += error.data.calls;
    }
    throw error;
  } finally {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tokenFactory",
      day,
      reserved: 2,
      actual: calls,
    });
  }
}

export const render = action({
  args: { artworkId: v.id("artworks") },
  returns: audio,
  handler: async (ctx, { artworkId }): Promise<RenderedNarration> => {
    await requireDeviceFromAction(ctx);
    const claimId = crypto.randomUUID();
    let claimed = await ctx.runMutation(internal.narration.claim, {
      artworkId,
      claim: claimId,
    });
    // Share an in-flight generation instead of paying for the same script twice. Claiming again
    // each second returns its playlist once speech starts, or takes the generation over if it failed.
    for (let attempt = 0; !claimed.audio && !claimed.owned; attempt++) {
      if (attempt === 120) throw new ConvexError({ code: "narration_busy" });
      await sleep(1000);
      claimed = await ctx.runMutation(internal.narration.claim, {
        artworkId,
        claim: claimId,
      });
    }
    const { audio, facts, opening, sentences: cached } = claimed;
    if (audio) return audio;
    try {
      if (!env.OPENAI_API_KEY || !env.NEBIUS_API_KEY) {
        throw new ConvexError({ code: "narration_not_configured" });
      }
      const sentences = cached ?? (await authorScript(ctx, facts, opening));
      if (!(await ctx.runMutation(internal.narration.scripted, { artworkId, claim: claimId, sentences }))) {
        throw new ConvexError({ code: "narration_unavailable" });
      }
    } catch (error) {
      await ctx.runMutation(internal.narration.finish, {
        artworkId,
        claim: claimId,
      });
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({ code: "narration_provider_failed" });
    }
    // `speak` streams the speech; the listener can start once its first segment is stored.
    for (let waited = 0; waited < FIRST_SEGMENT_TIMEOUT_MS; waited += FIRST_SEGMENT_POLL_MS) {
      await sleep(FIRST_SEGMENT_POLL_MS);
      const progress = await ctx.runQuery(internal.narration.progress, { artworkId, claim: claimId });
      if (!progress) throw new ConvexError({ code: "narration_provider_failed" });
      if (progress.audio) return progress.audio;
    }
    throw new ConvexError({ code: "narration_provider_failed" });
  },
});

// Stores each segment for the live playlist as speech arrives, then the whole file for later plays.
export const speak = internalAction({
  args: { artworkId: v.id("artworks"), claim: v.string(), input: v.string() },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim, input }) => {
    let storageId: Id<"files"> | undefined;
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: SPEECH_MODEL,
          voice: SPEECH_VOICE,
          instructions: SPEECH_INSTRUCTIONS,
          input,
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("audio/")) {
        console.warn("Narration provider request failed", {
          status: response.status,
        });
        throw new ConvexError({ code: "narration_provider_failed", reason: `http_${response.status}` });
      }
      const reader = response.body.getReader();
      const segmenter = createSegmenter();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let segments = 0;
      const append = async ({ bytes, duration }: PackedSegment) => {
        segments++;
        const segmentId = await fileStorage.store(ctx, new Blob([bytes], { type: "audio/mpeg" }));
        return ctx.runMutation(internal.narration.appendSegment, {
          artworkId,
          claim,
          segment: { storageId: segmentId, duration },
        });
      };
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        chunks.push(new Uint8Array(read.value));
        for (const next of segmenter.push(read.value)) {
          // Replaced or cleared while speaking: stop paying for speech nobody will hear.
          if (!(await append(next))) {
            await reader.cancel();
            return null;
          }
        }
      }
      const last = segmenter.end();
      if (last && !(await append(last))) return null;
      if (segments === 0) throw new ConvexError({ code: "narration_provider_failed", reason: "invalid_output" });
      storageId = await fileStorage.store(ctx, new Blob(chunks, { type: "audio/mpeg" }));
      await ctx.runMutation(internal.narration.finish, { artworkId, claim, storageId });
    } catch (error) {
      await reportBackendError(error, "narration.speak");
      if (storageId) await fileStorage.delete(ctx, storageId);
      await ctx.runMutation(internal.narration.finish, { artworkId, claim });
    }
    return null;
  },
});
