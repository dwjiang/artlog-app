import { ConvexError, v, type Infer } from "convex/values";

import {
  citeQuotedFacts,
  GUIDE_MODEL,
  GUIDE_PROMPT,
  guideBodyProblems,
  guideOpening,
  guideResearch,
  guideSchema,
  narratable,
  parseGuideLines,
  unsupportedLines,
  validateGuide,
} from "../shared/audio/guide";
import { SPEECH_INSTRUCTIONS, SPEECH_MODEL, SPEECH_VOICE } from "../shared/audio/speech";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, env, httpAction, internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { CLAIM_MS, FAILED_RESEARCH_RETRY_MS, researchArtwork } from "./docent";
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
} from "./lib/narrationCache";
import { audioEvidenceOf, clearNarration, releaseNarrationFiles } from "./lib/narrationEvidence";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { limitDevice, limitKey } from "./lib/rateLimits";
import { reserveSpend } from "./lib/spend";
import { chatJson } from "./lib/tokenFactory";
import {
  factChip,
  factSheetEntry,
  guideSentence,
  toFactChip,
  type FactSheetEntry,
  type GuideSentence,
} from "./lib/validators";

const audio = v.object({
  uri: v.string(),
  sentences: v.array(guideSentence),
  renderId: v.string(),
  live: v.boolean(),
});
// The facts the guide was written from, for a listener who pressed play before the work had research.
const rendered = v.object({ ...audio.fields, facts: v.array(factChip), researchUpdatedAt: v.optional(v.number()) });
const segment = v.object({ storageId: v.id("files"), duration: v.number() });
const LEASE_MS = 180_000;
const RESEARCH_WAIT_MS = 120_000;
// A script the writer cannot produce for this research is not retried on every play; new research,
// a new opening or model, or this much time allows another attempt.
const SCRIPT_FAILURE_MS = 7 * 24 * 60 * 60_000;
const FIRST_SEGMENT_POLL_MS = 250;
const FIRST_SEGMENT_TIMEOUT_MS = 30_000;
const FIRST_BYTE_TIMEOUT_MS = 20_000;
const STREAM_IDLE_TIMEOUT_MS = 15_000;
// Long enough for a listener who paused the live playlist to finish it; later plays get the whole file.
const SEGMENT_RETENTION_MS = 60 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Research normally starts when a work's page opens or it is scanned: "missing" lets a play start it when that
// never ran, and "writing" waits for a run already in flight.
export type NarrationResearch = "ready" | "writing" | "missing" | "unavailable";
export function narrationResearch(
  artwork: Doc<"artworks">,
  content: Doc<"artworkContent"> | null,
  now = Date.now(),
): NarrationResearch {
  if (artwork.retiredAt || artwork.identityStatus !== "established" || artwork.factSheetNeedsReview) {
    return "unavailable";
  }
  if (content?.factSheet?.length) return narratable(guideResearch(content.factSheet)) ? "ready" : "unavailable";
  if (artwork.enrichClaimedAt !== undefined && artwork.enrichClaimedAt > now - CLAIM_MS) return "writing";
  // A play would pay for the same failed research again; the story's "Try again" can.
  const failedRecently =
    artwork.docentFailedAt !== undefined && artwork.docentFailedAt > now - FAILED_RESEARCH_RETRY_MS;
  return failedRecently || artwork.docentNoSources ? "unavailable" : "missing";
}

export const researchState = internalQuery({
  args: { artworkId: v.id("artworks") },
  returns: v.union(v.literal("ready"), v.literal("writing"), v.literal("missing"), v.literal("unavailable")),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    return artwork ? narrationResearch(artwork, await readArtworkContent(ctx, artwork)) : "unavailable";
  },
});

// The writer is not fully deterministic, so one failed render may be luck; a second for the same research is not.
export function scriptFailed(entry: Doc<"narrationAudio">, artwork: Doc<"artworks">, now = Date.now()): boolean {
  return (
    (entry.scriptFailures ?? 0) >= 2
    && entry.scriptFailedAt !== undefined
    && now - entry.scriptFailedAt < SCRIPT_FAILURE_MS
    && scriptCurrent(entry, artwork)
  );
}

// Researches the work once if it never was, or waits out a run in flight; the claim then decides availability.
// The guide needs only the saved fact sheet, so it starts while the written docent is still being drafted;
// the returned run settles that draft before the action ends.
async function awaitResearch(
  ctx: ActionCtx,
  artworkId: Id<"artworks">,
  deviceId: Id<"devices">,
): Promise<{ drafting: Promise<void> }> {
  let run: Promise<void> | undefined;
  let done = false;
  let failure: { error: unknown } | undefined;
  for (let waited = 0; waited < RESEARCH_WAIT_MS; waited += 250) {
    const state = await ctx.runQuery(internal.narration.researchState, { artworkId });
    if (state === "missing" && !run) {
      run = researchArtwork(ctx, artworkId, deviceId)
        .catch((error: unknown) => {
          failure = { error };
        })
        .finally(() => {
          done = true;
        });
    } else if (state === "ready" || state === "unavailable" || (state === "missing" && done)) {
      break;
    }
    await Promise.race(run && !done ? [sleep(250), run] : [sleep(250)]);
  }
  // The written docent can fail after valid research was saved for this independent guide. The run is
  // returned inside an object: an async function would otherwise wait for the promise it returns.
  if (failure && (await ctx.runQuery(internal.narration.researchState, { artworkId })) !== "ready") {
    throw failure.error;
  }
  return { drafting: run ?? Promise.resolve() };
}

const claimResult = v.object({
  owned: v.boolean(),
  audio: v.union(audio, v.null()),
  facts: v.array(factSheetEntry),
  opening: v.string(),
  researchUpdatedAt: v.optional(v.number()),
  sentences: v.optional(v.array(guideSentence)),
});

export const claim = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: claimResult,
  handler: async (ctx, args): Promise<Infer<typeof claimResult>> => {
    const device = await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", args.artworkId);
    const content = artwork && (await readArtworkContent(ctx, artwork));
    if (!artwork || narrationResearch(artwork, content) !== "ready") {
      throw new ConvexError({ code: "narration_unavailable" });
    }
    const research = {
      facts: guideResearch(content?.factSheet ?? []),
      opening: guideOpening(artwork),
      researchUpdatedAt: artwork.factSheetUpdatedAt,
    };
    const audio = await renderedNarration(ctx, artwork);
    if (audio) return { ...research, owned: false, audio };
    const entry = await narrationEntry(ctx, artwork._id);
    if (entry && scriptFailed(entry, artwork)) throw new ConvexError({ code: "narration_unavailable" });
    if (entry?.claimedAt !== undefined && narrationCurrent(entry, artwork) && Date.now() - entry.claimedAt < LEASE_MS) {
      return { ...research, owned: false, audio: liveNarration(entry, artwork) };
    }
    await limitDevice(ctx, "narration", device._id);
    await limitKey(ctx, "narrationDaily", "global");
    // A script written from this research and opening is spoken again; only its audio is replaced. Its
    // failures count toward giving up on this research.
    const current = entry && scriptCurrent(entry, artwork) ? entry : undefined;
    const sentences = current?.sentences;
    const fields = {
      artworkId: artwork._id,
      claim: args.claim,
      claimedAt: Date.now(),
      ...narrationProvenance(artwork),
      storageId: undefined,
      sentences,
      segments: undefined,
      scriptFailures: current?.scriptFailures,
      scriptFailedAt: current?.scriptFailedAt,
    };
    if (entry) {
      await ctx.db.replace("narrationAudio", entry._id, fields);
      await releaseNarrationFiles(ctx, narrationFiles(entry));
    } else {
      await ctx.db.insert("narrationAudio", fields);
    }
    await ctx.scheduler.runAfter(LEASE_MS, internal.narration.expireClaim, {
      artworkId: artwork._id,
      claim: args.claim,
    });
    return { ...research, owned: true, audio: null, sentences };
  },
});

// Stores the script and starts speaking it; false once the claim was released or replaced.
export const scripted = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string(), sentences: v.array(guideSentence) },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, claim, sentences }) => {
    const entry = await narrationEntry(ctx, artworkId);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (entry?.claim !== claim || !artwork || !narrationCurrent(entry, artwork)) return false;
    await ctx.db.patch("narrationAudio", entry._id, { sentences });
    await ctx.scheduler.runAfter(0, internal.narration.speak, {
      artworkId,
      claim,
      input: sentences.map((line) => line.sentence).join(" "),
    });
    return true;
  },
});

// A render that crashed before its script never released its claim, and the work would show its transcript as
// being written forever. A renewed claim is checked again when its new lease ends.
export const expireClaim = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim }) => {
    const entry = await narrationEntry(ctx, artworkId);
    if (entry?.claim !== claim || entry.sentences || entry.claimedAt === undefined) return null;
    const left = entry.claimedAt + LEASE_MS - Date.now();
    if (left > 0) {
      await ctx.scheduler.runAfter(left, internal.narration.expireClaim, { artworkId, claim });
      return null;
    }
    await ctx.db.patch("narrationAudio", entry._id, { claim: undefined, claimedAt: undefined });
    return null;
  },
});

// Keeps a slow writer's claim from lapsing into a second paid generation by another listener.
export const renewClaim = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim }) => {
    const entry = await narrationEntry(ctx, artworkId);
    if (entry?.claim === claim && !entry.sentences) {
      await ctx.db.patch("narrationAudio", entry._id, { claimedAt: Date.now() });
    }
    return null;
  },
});

export const appendSegment = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string(), segment },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, claim, segment: added }) => {
    const entry = await narrationEntry(ctx, artworkId);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (entry?.claim !== claim || entry.storageId || !artwork || !narrationCurrent(entry, artwork)) {
      await fileStorage.delete(ctx, added.storageId);
      if (entry?.claim === claim && !entry.storageId) await clearNarration(ctx, artworkId);
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
    scriptFailed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim, storageId, scriptFailed: failed }) => {
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
      if (!storageId && artwork && narrationCurrent(entry, artwork)) {
        const evidence = audioEvidenceOf(entry);
        // A cut-off stream stays privately reportable for a day, including after a retry.
        if (evidence) {
          await ctx.db.insert("narrationFailures", { ...evidence, expiresAt: Date.now() + 24 * 60 * 60_000 });
        }
      }
      // The row must drop its references before the files can go; the reference count holds them.
      if (artwork && (entry.sentences || failed) && scriptCurrent(entry, artwork)) {
        await ctx.db.patch("narrationAudio", entry._id, {
          claim: undefined,
          claimedAt: undefined,
          storageId: undefined,
          segments: undefined,
          ...(failed ? { scriptFailedAt: Date.now(), scriptFailures: (entry.scriptFailures ?? 0) + 1 } : {}),
        });
      } else {
        await ctx.db.delete("narrationAudio", entry._id);
      }
      await releaseNarrationFiles(ctx, narrationFiles(entry));
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
    await releaseNarrationFiles(
      ctx,
      entry.segments.map(({ storageId }) => storageId),
    );
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
    const artwork = artworkId ? await ctx.db.get("artworks", artworkId) : null;
    if (entry?.claim !== args.render || !entry.segments?.length || !artwork || !narrationCurrent(entry, artwork)) {
      return null;
    }
    const segments = [];
    for (const { storageId, duration } of entry.segments) {
      const uri = await fileStorage.getUrl(ctx, storageId, { artworkId: artwork._id, render: args.render });
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
      await clearNarration(ctx, entry.artworkId);
      cleared++;
    }
    return cleared;
  },
});

// Writes the stop from the research and returns the whole script, opening first. `renew` keeps the claim
// from lapsing while a retry is written.
async function authorScript(
  ctx: ActionCtx,
  facts: FactSheetEntry[],
  opening: string,
  renew: () => Promise<unknown>,
): Promise<GuideSentence[]> {
  const day = await reserveSpend(ctx, "tokenFactory", 2);
  let calls = 0;
  const ids = facts.map((fact) => fact.id);
  const factIds = new Set(ids);
  const texts = new Map(facts.map((fact) => [fact.id, fact.text]));
  let problems: string[] = [];
  const parse = (value: unknown) => {
    problems = [];
    const parsed = parseGuideLines(value);
    if (!parsed) {
      problems.push(
        "The response was not a thread, a quote and hook, look, story and takeaway lists of sentence, fact_ids and support.",
      );
      return null;
    }
    const lines = citeQuotedFacts(parsed, facts);
    // The writer sees which words it cited, so a retry can copy them exactly or drop the sentence.
    problems = unsupportedLines(lines, facts).map(
      (line) =>
        `The support "${line.support}" for "${line.sentence}" is not verbatim in its cited facts: ${line.fact_ids
          .map((id) => `${id} "${texts.get(id) ?? ""}"`)
          .join(", ")}. Copy the words exactly or cut the sentence.`,
    );
    if (problems.length > 0) return null;
    const body = lines.map(({ sentence, fact_ids, section }) => ({ sentence, factIds: fact_ids, section }));
    problems = guideBodyProblems(body, factIds);
    if (problems.length > 0) return null;
    const guide = validateGuide([{ sentence: opening, factIds: [], section: "hook" }, ...body], factIds, opening);
    if (!guide) problems.push("The script repeats the opening or runs past 4000 characters.");
    return guide;
  };
  // Reasoning is disabled to keep guide generation within the playback latency and token budgets.
  const write = (schema: ReturnType<typeof guideSchema>, previousAttemptProblems?: string) =>
    chatJson({
      model: GUIDE_MODEL,
      system: GUIDE_PROMPT,
      // The prompt carries the schema as well as the grammar so the model can follow the length rules.
      user: JSON.stringify({
        task: "Write the continuation of this audio guide stop from the research. Do not repeat the opening.",
        ...(previousAttemptProblems ? { previousAttemptProblems } : {}),
        opening,
        // Source names and URLs stay out: the writer must never say where a fact came from.
        research: facts.map(({ id, text }) => ({ id, text })),
        schema,
      }),
      schemaName: "audioGuide",
      schema,
      // The token cap bounds stalled generation while allowing a complete guide script.
      maxTokens: 3000,
      timeoutMs: 60_000,
      parse,
    });
  try {
    let script;
    try {
      script = await write(guideSchema(ids));
    } catch (error) {
      if (!(error instanceof ConvexError && (error.data.reason === "schema" || error.data.reason === "truncated"))) {
        throw error;
      }
      calls += error.data.calls;
      await renew();
      // Thin research can stall at a section's minimum, so truncation retries relax the lengths.
      // Format rejections instead retry with the specific validation problems.
      script =
        error.data.reason === "truncated"
          ? await write(guideSchema(ids, { relaxed: true }))
          : await write(
              guideSchema(ids),
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
  returns: rendered,
  handler: async (ctx, { artworkId }): Promise<Infer<typeof rendered>> => {
    const device = await requireDeviceFromAction(ctx);
    const { drafting } = await awaitResearch(ctx, artworkId, device._id);
    try {
      return await renderResearched(ctx, artworkId);
    } finally {
      await drafting;
    }
  },
});

async function renderResearched(ctx: ActionCtx, artworkId: Id<"artworks">): Promise<Infer<typeof rendered>> {
  const claimId = crypto.randomUUID();
  let claimed = await ctx.runMutation(internal.narration.claim, {
    artworkId,
    claim: claimId,
  });
  // Share an in-flight generation instead of paying for the same script twice. Claiming again
  // each second returns its playlist once speech starts, or takes the generation over if it failed.
  for (let attempt = 0; !claimed.audio && !claimed.owned; attempt++) {
    if (attempt === LEASE_MS / 1000 + 10) {
      // Another generation kept renewing its claim without speaking or releasing it.
      const busy = new ConvexError({ code: "narration_busy" });
      await reportBackendError(busy, "narration.render", { artworkId });
      throw busy;
    }
    await sleep(1000);
    claimed = await ctx.runMutation(internal.narration.claim, {
      artworkId,
      claim: claimId,
    });
  }
  const { audio, facts, opening, researchUpdatedAt, sentences: cached } = claimed;
  const research = { facts: facts.map(toFactChip), researchUpdatedAt };
  if (audio) return { ...audio, ...research };
  try {
    if (!env.OPENAI_API_KEY || (!cached && !env.NEBIUS_API_KEY)) {
      throw new ConvexError({ code: "narration_not_configured" });
    }
    const renew = () => ctx.runMutation(internal.narration.renewClaim, { artworkId, claim: claimId });
    const sentences = cached ?? (await authorScript(ctx, facts, opening, renew));
    if (!(await ctx.runMutation(internal.narration.scripted, { artworkId, claim: claimId, sentences }))) {
      throw new ConvexError({ code: "narration_unavailable" });
    }
  } catch (error) {
    await reportBackendError(error, "narration.render", { artworkId });
    // Output that failed validation twice will fail the same way for this research; anything else may not.
    const scriptFailed =
      error instanceof ConvexError
      && error.data.code === "model_error"
      && (error.data.reason === "schema" || error.data.reason === "truncated");
    await ctx.runMutation(internal.narration.finish, {
      artworkId,
      claim: claimId,
      ...(scriptFailed ? { scriptFailed } : {}),
    });
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({ code: "narration_provider_failed" });
  }
  // `speak` streams the speech; the listener can start once its first segment is stored.
  for (let waited = 0; waited < FIRST_SEGMENT_TIMEOUT_MS; waited += FIRST_SEGMENT_POLL_MS) {
    await sleep(FIRST_SEGMENT_POLL_MS);
    const progress = await ctx.runQuery(internal.narration.progress, { artworkId, claim: claimId });
    // `speak` reports its own failure before releasing the claim.
    if (!progress) throw new ConvexError({ code: "narration_provider_failed" });
    if (progress.audio) return { ...progress.audio, ...research };
  }
  const slow = new ConvexError({ code: "narration_provider_failed", reason: "first_segment_timeout" });
  await reportBackendError(slow, "narration.render", { artworkId });
  throw slow;
}

// Stores each segment for the live playlist as speech arrives, then the whole file for later plays.
export const speak = internalAction({
  args: { artworkId: v.id("artworks"), claim: v.string(), input: v.string() },
  returns: v.null(),
  handler: async (ctx, { artworkId, claim, input }) => {
    let storageId: Id<"files"> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let uploadFailure: { error: unknown } | undefined;
    let listed = Promise.resolve(true);
    // The provider is held to its first byte and then to a pause between chunks, never to a total: a long
    // script legitimately streams for a while, and our own segment uploads must not count against it.
    const abort = new AbortController();
    let timedOut = false;
    const expire = () => {
      timedOut = true;
      abort.abort();
    };
    let stall = setTimeout(expire, FIRST_BYTE_TIMEOUT_MS);
    const progressed = () => {
      clearTimeout(stall);
      stall = setTimeout(expire, STREAM_IDLE_TIMEOUT_MS);
    };
    const failedUpload = (error: unknown): false => {
      uploadFailure ??= { error };
      abort.abort();
      void reader?.cancel().catch(() => {});
      return false;
    };
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
        signal: abort.signal,
      });
      progressed();
      reader = response.body?.getReader();
      if (!response.ok || !reader || !response.headers.get("content-type")?.startsWith("audio/")) {
        console.warn("Narration provider request failed", {
          status: response.status,
        });
        throw new ConvexError({ code: "narration_provider_failed", reason: `http_${response.status}` });
      }
      const segmenter = createSegmenter();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let segments = 0;
      // Uploads run while speech keeps streaming; the playlist still lists segments in order. A failed
      // upload cuts the stream short, since the listener's playlist can no longer continue.
      let replaced = false;
      const append = ({ bytes, duration }: PackedSegment) => {
        segments++;
        const stored = fileStorage.store(ctx, new Blob([bytes], { type: "audio/mpeg" })).catch(failedUpload);
        listed = listed
          .then(async (current) => {
            const segmentId = await stored;
            if (!segmentId) return false;
            if (!current || uploadFailure) {
              await fileStorage.delete(ctx, segmentId);
              return false;
            }
            // A replaced or cleared claim deletes the segment it is handed.
            const kept = await ctx.runMutation(internal.narration.appendSegment, {
              artworkId,
              claim,
              segment: { storageId: segmentId, duration },
            });
            replaced ||= !kept;
            return current && kept;
          })
          .catch(failedUpload);
      };
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        progressed();
        chunks.push(new Uint8Array(read.value));
        for (const next of segmenter.push(read.value)) append(next);
        // Replaced or cleared while speaking: stop paying for speech nobody will hear.
        if (replaced) {
          await listed;
          return null;
        }
      }
      clearTimeout(stall);
      const last = segmenter.end();
      if (last) append(last);
      if (!(await listed)) {
        if (uploadFailure) throw uploadFailure.error;
        return null;
      }
      if (segments === 0) throw new ConvexError({ code: "narration_provider_failed", reason: "invalid_output" });
      storageId = await fileStorage.store(ctx, new Blob(chunks, { type: "audio/mpeg" }));
      await ctx.runMutation(internal.narration.finish, { artworkId, claim, storageId });
    } catch (error) {
      // A failed stream can leave uploads in flight; settle their references before releasing the claim.
      await listed;
      const failure =
        uploadFailure?.error
        ?? (timedOut ? new ConvexError({ code: "narration_provider_failed", reason: "timeout" }) : error);
      await reportBackendError(failure, "narration.speak", { artworkId });
      if (storageId) await fileStorage.delete(ctx, storageId);
      await ctx.runMutation(internal.narration.finish, { artworkId, claim });
    } finally {
      clearTimeout(stall);
      if (reader) {
        // Failed streams reject cancellation too; that must not replace the reported generation failure.
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return null;
  },
});
