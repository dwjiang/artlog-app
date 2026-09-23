import { ConvexError, v } from "convex/values";
import {
  GUIDE_MAX_WORDS,
  GUIDE_MODEL,
  GUIDE_PROMPT,
  GUIDE_REASONING,
  GUIDE_SCHEMA,
  guideOpening,
  guideResearch,
  guideWordFloor,
  parseGuideLines,
  unsupportedLines,
  validateGuide,
} from "../shared/audio/guide";
import { SPEECH_INSTRUCTIONS, SPEECH_MODEL, SPEECH_VOICE } from "../shared/audio/speech";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireDevice, requireDeviceFromAction } from "./lib/auth";
import { limitDevice, limitKey } from "./lib/rateLimits";
import {
  narrationCurrent,
  narrationEntry,
  narrationProvenance,
  renderedNarration,
  type RenderedNarration,
} from "./lib/narrationCache";
import { chatJson } from "./lib/tokenFactory";
import { docentSentence, factSheetEntry, type DocentSentence } from "./lib/validators";

const audio = v.object({
  uri: v.string(),
  sentences: v.array(docentSentence),
  renderId: v.string(),
});
const LEASE_MS = 180_000;

export const claim = internalMutation({
  args: { artworkId: v.id("artworks"), claim: v.string() },
  returns: v.object({
    owned: v.boolean(),
    audio: v.union(audio, v.null()),
    facts: v.array(factSheetEntry),
    opening: v.string(),
  }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    const artwork = await ctx.db.get(args.artworkId);
    if (
      !artwork ||
      artwork.retiredAt ||
      artwork.identityStatus !== "established" ||
      artwork.factSheetNeedsReview
    )
      throw new ConvexError({ code: "narration_unavailable" });
    const facts = guideResearch(artwork.factSheet ?? []);
    if (!facts.length) throw new ConvexError({ code: "narration_unavailable" });
    const opening = guideOpening(artwork);
    const audio = await renderedNarration(ctx, artwork);
    if (audio) return { facts, opening, owned: false, audio };
    const entry = await narrationEntry(ctx, artwork._id);
    if (entry && narrationCurrent(entry, artwork) && Date.now() - entry.claimedAt < LEASE_MS)
      return { facts, opening, owned: false, audio: null };
    await limitDevice(ctx, "narration", device._id);
    await limitKey(ctx, "narrationDaily", "global");
    const fields = {
      artworkId: artwork._id,
      claim: args.claim,
      claimedAt: Date.now(),
      ...narrationProvenance(artwork),
      storageId: undefined,
      sentences: undefined,
    };
    if (entry) {
      if (entry.storageId) await ctx.storage.delete(entry.storageId);
      await ctx.db.replace(entry._id, fields);
    } else await ctx.db.insert("narrationAudio", fields);
    return { facts, opening, owned: true, audio: null };
  },
});

export const rendered = internalQuery({
  args: { artworkId: v.id("artworks") },
  returns: v.union(audio, v.null()),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get(artworkId);
    return artwork ? renderedNarration(ctx, artwork) : null;
  },
});

export const finish = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    claim: v.string(),
    audio: v.optional(
      v.object({ storageId: v.id("_storage"), sentences: v.array(docentSentence) }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await narrationEntry(ctx, args.artworkId);
    if (!entry || entry.claim !== args.claim) {
      if (args.audio) await ctx.storage.delete(args.audio.storageId);
    } else if (args.audio) await ctx.db.patch(entry._id, args.audio);
    else {
      if (entry.storageId) await ctx.storage.delete(entry.storageId);
      await ctx.db.delete(entry._id);
    }
    return null;
  },
});

// Explicit invalidation: `npx convex run narration:clear` after a prompt or delivery change worth
// re-rendering. Research, metadata, model and voice changes re-render on their own at play time.
export const clear = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let cleared = 0;
    for await (const entry of ctx.db.query("narrationAudio")) {
      if (entry.storageId) await ctx.storage.delete(entry.storageId);
      await ctx.db.delete(entry._id);
      cleared++;
    }
    return cleared;
  },
});

export const render = action({
  args: { artworkId: v.id("artworks") },
  returns: audio,
  handler: async (ctx, { artworkId }): Promise<RenderedNarration> => {
    await requireDeviceFromAction(ctx);
    const claimId = crypto.randomUUID();
    let claimed = await ctx.runMutation(internal.narration.claim, { artworkId, claim: claimId });
    // Share an in-flight generation instead of paying for the same script twice. Claiming again
    // each second returns its audio once ready, or takes the generation over if it failed.
    for (let attempt = 0; !claimed.audio && !claimed.owned; attempt++) {
      if (attempt === 120) throw new ConvexError({ code: "narration_busy" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      claimed = await ctx.runMutation(internal.narration.claim, { artworkId, claim: claimId });
    }
    const { audio, facts, opening } = claimed;
    if (audio) return audio;
    let storageId: Id<"_storage"> | undefined;
    try {
      const key = process.env.OPENAI_API_KEY;
      if (!key || !process.env.NEBIUS_API_KEY)
        throw new ConvexError({ code: "narration_not_configured" });
      const day = await ctx.runMutation(internal.spend.reserve, {
        kind: "tokenFactory",
        amount: 2,
      });
      let calls = 0;
      let sentences: DocentSentence[];
      const factIds = new Set(facts.map((fact) => fact.id));
      let problems: string[] = [];
      const parse = (value: unknown) => {
        problems = [];
        const lines = parseGuideLines(value);
        if (!lines) {
          problems.push("The response was not an array of sentence, fact_ids and support.");
          return null;
        }
        problems = unsupportedLines(lines, facts).map(
          (line) =>
            `The support "${line.support}" is not verbatim in the facts cited for "${line.sentence}".`,
        );
        if (problems.length) return null;
        const guide = validateGuide(
          [
            { sentence: opening, factIds: [] },
            ...lines.map(({ sentence, fact_ids }) => ({ sentence, factIds: fact_ids })),
          ],
          factIds,
          opening,
        );
        if (!guide)
          problems.push(
            `The script broke a format rule: ${guideWordFloor(facts.length)} to ${GUIDE_MAX_WORDS} words after the opening, only real fact ids, every sentence ending in punctuation, no repeated sentence.`,
          );
        return guide;
      };
      const write = (previousAttemptProblems?: string) =>
        chatJson({
          model: GUIDE_MODEL,
          system: GUIDE_PROMPT,
          user: JSON.stringify({
            task: "Write the continuation of this audio guide stop from the research. Do not repeat the opening.",
            ...(previousAttemptProblems ? { previousAttemptProblems } : {}),
            opening,
            research: facts,
            schema: GUIDE_SCHEMA,
          }),
          schemaName: "audioGuide",
          schema: GUIDE_SCHEMA,
          maxTokens: 12_000,
          timeoutMs: 60_000,
          reasoning: GUIDE_REASONING,
          parse,
        });
      try {
        let script;
        try {
          script = await write();
        } catch (error) {
          // One more attempt, with the rejected sentences named; pointed feedback lands better than the rules did.
          if (!(error instanceof ConvexError && error.data.reason === "schema")) throw error;
          calls += error.data.calls;
          script = await write(
            `Your previous script was rejected. ${problems.join(" ")} Fix these and return the whole script again.`,
          );
        }
        calls += script.calls;
        sentences = script.value;
      } catch (error) {
        if (error instanceof ConvexError && typeof error.data.calls === "number")
          calls += error.data.calls;
        throw error;
      } finally {
        await ctx.runMutation(internal.spend.reconcile, {
          kind: "tokenFactory",
          day,
          reserved: 2,
          actual: calls,
        });
      }
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: SPEECH_MODEL,
          voice: SPEECH_VOICE,
          instructions: SPEECH_INSTRUCTIONS,
          input: sentences.map((line) => line.sentence).join(" "),
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        console.warn("Narration provider request failed", { status: response.status });
        throw new ConvexError({ code: "narration_provider_failed" });
      }
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || !response.headers.get("content-type")?.startsWith("audio/"))
        throw new ConvexError({ code: "narration_provider_failed" });
      storageId = await ctx.storage.store(new Blob([bytes], { type: "audio/mpeg" }));
      await ctx.runMutation(internal.narration.finish, {
        artworkId,
        claim: claimId,
        audio: { storageId, sentences },
      });
      storageId = undefined;
      const ready = await ctx.runQuery(internal.narration.rendered, { artworkId });
      if (!ready) throw new ConvexError({ code: "narration_unavailable" });
      return ready;
    } catch (error) {
      if (storageId) await ctx.storage.delete(storageId);
      await ctx.runMutation(internal.narration.finish, { artworkId, claim: claimId });
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({ code: "narration_provider_failed" });
    }
  },
});
