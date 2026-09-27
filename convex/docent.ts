import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, env } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { patchArtworkContent, readArtworkContent, type ArtworkContentFields } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import {
  DOCENT_MAX_TOKENS,
  DOCENT_PROMPT,
  DOCENT_SCHEMA,
  FACT_SHEET_MAX_TOKENS,
  FACT_SHEET_PROMPT,
  FACT_SHEET_SCHEMA,
  buildFactSheet,
  docentUser,
  factSheetUser,
  parseDocent,
  parseFactSheet,
} from "./lib/docentPrompts";
import { gatherSources } from "./lib/docentSources";
import { validateDocent } from "./lib/docentValidator";
import { readObjectDetails } from "./lib/objectDetails";
import { limitDevice } from "./lib/rateLimits";
import { chatJson } from "./lib/tokenFactory";
import {
  docentSentence,
  factSheetEntry,
  type DocentSentence,
  type DocentStatus,
  type FactSheetEntry,
} from "./lib/validators";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

// A scan's claim blocks concurrent generation for ten minutes; the batch job (enrich.claimBatch)
// reclaims after an hour.
const CLAIM_MS = 10 * 60 * 1000;
// Two chatJson calls, each retried at most once (tokenFactory.chatJson); chatJson sends temperature 0.
const MAX_MODEL_CALLS = 4;
// Measured p95 was 3.3 s for Super on smaller inputs; an owner page adds several thousand tokens.
const MODEL_TIMEOUT_MS = 20_000;

export async function clearDocent(ctx: MutationCtx, artwork: Doc<"artworks">): Promise<void> {
  await patchArtworkContent(ctx, artwork, { docent: undefined });
  await ctx.db.patch("artworks", artwork._id, {
    docentUpdatedAt: undefined,
    enrichClaimedAt: undefined,
    enrichGeneration: (artwork.enrichGeneration ?? 0) + 1,
  });
}

export function docentStatusOf(artwork: Doc<"artworks">, content: ArtworkContentFields | null): DocentStatus {
  if (content?.docent?.en) return content.docent.en.length > 0 ? "ready" : "unavailable";
  if (artwork.factSheetNeedsReview) return "unavailable";
  return artwork.docentFailedAt === undefined ? "writing" : "failed";
}

export const load = internalQuery({
  args: { artworkId: v.id("artworks") },
  returns: v.union(
    v.null(),
    v.object({
      artwork: schema.doc("artworks"),
      content: v.union(schema.doc("artworkContent"), v.null()),
      pageUrl: v.optional(v.string()),
      owner: v.union(schema.doc("museums"), v.null()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork || artwork.identityStatus !== "established") return null;
    let pageUrl: string | undefined;
    let owner: Doc<"museums"> | null = null;
    for await (const object of ctx.db.query("objects").withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
      if (object.reverted || object.mergedInto || !object.ownerId) {
        continue;
      }
      const details = await readObjectDetails(ctx, object);
      if (!details?.pageUrl) continue;
      const museum = await ctx.db.get("museums", object.ownerId);
      if (!museum || (await isVenueOptedOut(ctx, museum))) continue;
      pageUrl = details.pageUrl;
      owner = museum;
      break;
    }
    return { artwork, content: await readArtworkContent(ctx, artwork), pageUrl, owner };
  },
});

export const claim = internalMutation({
  args: { artworkId: v.id("artworks") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork || artwork.identityStatus !== "established" || artwork.factSheetNeedsReview) {
      return null;
    }
    const content = await readArtworkContent(ctx, artwork);
    if (content?.docent?.en) return null;
    const now = Date.now();
    if (artwork.enrichClaimedAt !== undefined && artwork.enrichClaimedAt > now - CLAIM_MS) {
      return null;
    }
    const generation = (artwork.enrichGeneration ?? 0) + 1;
    await ctx.db.patch("artworks", artworkId, {
      enrichClaimedAt: now,
      enrichGeneration: generation,
      docentFailedAt: undefined,
    });
    return generation;
  },
});

// Shared with the Python enrichment job. Omit `factSheet` to rewrite only the sentences.
export const writeEnrichment = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    generation: v.number(),
    factSheet: v.optional(v.array(factSheetEntry)),
    docentEn: v.array(docentSentence),
  },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, generation, factSheet, docentEn }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) throw new ConvexError({ code: "artwork_not_found" });
    if (
      artwork.identityStatus !== "established"
      || artwork.factSheetNeedsReview
      || artwork.enrichGeneration !== generation
      || artwork.enrichClaimedAt === undefined
    ) {
      return false;
    }
    const now = Date.now();
    await patchArtworkContent(ctx, artwork, {
      ...(factSheet ? { factSheet } : {}),
      docent: { en: docentEn },
    });
    await ctx.db.patch("artworks", artworkId, {
      ...(factSheet ? { factSheetUpdatedAt: now } : {}),
      docentUpdatedAt: now,
      enrichClaimedAt: undefined,
      docentFailedAt: undefined,
    });
    return true;
  },
});

// Ends a claimed run that wrote nothing. A newer claim or an invalidation keeps its own state.
export const fail = internalMutation({
  args: { artworkId: v.id("artworks"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { artworkId, generation }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (artwork?.enrichGeneration === generation) {
      await ctx.db.patch("artworks", artworkId, {
        enrichClaimedAt: undefined,
        docentFailedAt: Date.now(),
      });
    }
    return null;
  },
});

// The card's "Try again". The run's own claim and the device's hourly limit still gate the work.
export const retry = mutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || scan.outcome !== "confident" || !scan.best) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const { artworkId } = scan.best;
    await ctx.db.patch("artworks", artworkId, { docentFailedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.docent.ensure, {
      artworkId,
      deviceId: device._id,
    });
    return null;
  },
});

export const invalidateDocent = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    includeResearch: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, includeResearch }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (artwork) {
      await clearDocent(ctx, artwork);
      if (includeResearch) {
        await patchArtworkContent(ctx, artwork, { factSheet: undefined });
        await ctx.db.patch("artworks", artworkId, {
          factSheetUpdatedAt: undefined,
        });
      }
    }
    return null;
  },
});

type Models = { factSheet: string; docent: string };

function configuredModels(): Models | null {
  const factSheet = env.FACT_SHEET_MODEL;
  const docent = env.DOCENT_MODEL;
  return factSheet && docent ? { factSheet, docent } : null;
}

async function generate(
  ctx: ActionCtx,
  models: Models,
  artwork: Doc<"artworks">,
  context: { content: ArtworkContentFields | null; pageUrl?: string; owner: Doc<"museums"> | null },
): Promise<{
  factSheet?: FactSheetEntry[];
  docentEn: DocentSentence[];
} | null> {
  const cached = artwork.factSheetUpdatedAt !== undefined ? context.content?.factSheet : undefined;
  let sources: Awaited<ReturnType<typeof gatherSources>> | undefined;
  if (!cached) {
    // Checked before the search so a blocked model run does not spend a Tavily credit for nothing.
    await ctx.runQuery(internal.spend.assertCap, { kind: "tokenFactory" });
    sources = await gatherSources(ctx, {
      artwork,
      owner: context.owner,
      pageUrl: context.pageUrl,
    });
    // Nothing found because every source errored: release the claim and try again later.
    if (sources.sources.length === 0) {
      return sources.failures ? null : { factSheet: [], docentEn: [] };
    }
  }
  const day = await ctx.runMutation(internal.spend.reserve, {
    kind: "tokenFactory",
    amount: MAX_MODEL_CALLS,
  });
  let calls = 0;
  try {
    let factSheet = cached;
    if (!factSheet) {
      const sheet = await chatJson({
        model: models.factSheet,
        system: FACT_SHEET_PROMPT,
        user: factSheetUser(sources!.sources, artwork),
        schemaName: "factSheet",
        schema: FACT_SHEET_SCHEMA,
        maxTokens: FACT_SHEET_MAX_TOKENS,
        parse: parseFactSheet,
        timeoutMs: MODEL_TIMEOUT_MS,
      });
      calls += sheet.calls;
      factSheet = buildFactSheet(sheet.value, sources!.sources);
    }
    let docentEn: DocentSentence[] = [];
    if (factSheet.length > 0) {
      const prose = await chatJson({
        model: models.docent,
        system: DOCENT_PROMPT,
        user: docentUser(factSheet),
        schemaName: "docent",
        schema: DOCENT_SCHEMA,
        maxTokens: DOCENT_MAX_TOKENS,
        parse: parseDocent,
        timeoutMs: MODEL_TIMEOUT_MS,
      });
      calls += prose.calls;
      docentEn = validateDocent(
        prose.value.map(({ sentence, fact_ids }) => ({
          sentence,
          factIds: fact_ids,
        })),
        new Set(factSheet.map((fact) => fact.id)),
      );
    }
    return { ...(cached ? {} : { factSheet }), docentEn };
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data.calls === "number") {
      calls += error.data.calls;
    }
    throw error;
  } finally {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tokenFactory",
      day,
      reserved: MAX_MODEL_CALLS,
      actual: calls,
    });
  }
}

// Scheduled after a confident identification (identify.ts) and by retry; the card never waits on it.
// Reuses a current fact sheet and only rewrites the sentences when they were invalidated. Every
// claimed run that writes nothing marks the artwork failed so the card can offer a retry.
export const ensure = internalAction({
  args: { artworkId: v.id("artworks"), deviceId: v.id("devices") },
  returns: v.null(),
  handler: async (ctx, { artworkId, deviceId }) => {
    const generation = await ctx.runMutation(internal.docent.claim, {
      artworkId,
    });
    if (generation === null) return null;
    let written = false;
    try {
      const models = configuredModels();
      if (!models) {
        console.warn("FACT_SHEET_MODEL or DOCENT_MODEL is not configured; skipping docent generation");
        return null;
      }
      const context = await ctx.runQuery(internal.docent.load, { artworkId });
      if (!context || context.artwork.enrichGeneration !== generation || context.artwork.factSheetNeedsReview) {
        return null;
      }
      await limitDevice(ctx, "docent", deviceId);
      const result = await generate(ctx, models, context.artwork, context);
      if (!result) return null;
      written = await ctx.runMutation(internal.docent.writeEnrichment, {
        artworkId,
        generation,
        ...result,
      });
    } catch (error) {
      if (error instanceof ConvexError && (error.data.code === "spend_cap" || error.data.code === "rate_limited")) {
        console.warn("Docent generation skipped", error.data);
        return null;
      }
      throw error;
    } finally {
      if (!written) {
        await ctx.runMutation(internal.docent.fail, { artworkId, generation });
      }
    }
    return null;
  },
});
