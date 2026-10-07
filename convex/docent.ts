import { ConvexError, v } from "convex/values";

import referenceReview from "../shared/sources/reference-review.json";
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
  buildFactSheet,
  docentUser,
  factSheetSchema,
  factSheetUser,
  parseDocent,
  parseFactSheet,
} from "./lib/docentPrompts";
import { gatherSources, trimSources } from "./lib/docentSources";
import { validateDocent } from "./lib/docentValidator";
import { clearNarration } from "./lib/narrationEvidence";
import { readObjectDetails } from "./lib/objectDetails";
import { reportBackendError } from "./lib/observability";
import { limitDevice } from "./lib/rateLimits";
import { applyReferenceReview, referenceReviewInput, referenceReviewSchema } from "./lib/referenceReview";
import { reserveSpend } from "./lib/spend";
import { chatJson } from "./lib/tokenFactory";
import {
  docentSentence,
  factSheetEntry,
  researchConflict,
  type ConfirmedDetails,
  type ResearchConflict,
  type DocentSentence,
  type DocentStatus,
  type FactSheetEntry,
} from "./lib/validators";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

// A scan's claim blocks concurrent generation for ten minutes; the batch job (enrich.claimBatch)
// reclaims after an hour.
export const CLAIM_MS = 10 * 60 * 1000;
// Each chatJson call is retried at most once; linked references add one review call.
// Owner pages add several thousand input tokens, so the timeout allows for longer research inputs.
const MODEL_TIMEOUT_MS = 20_000;

export async function clearDocent(ctx: MutationCtx, artwork: Doc<"artworks">): Promise<void> {
  await patchArtworkContent(ctx, artwork, { docent: undefined });
  await ctx.db.patch("artworks", artwork._id, {
    docentUpdatedAt: undefined,
    docentNoSources: undefined,
    enrichClaimedAt: undefined,
    enrichGeneration: artwork.enrichGeneration + 1,
  });
}

export function docentStatusOf(artwork: Doc<"artworks">, content: ArtworkContentFields | null): DocentStatus {
  if (content?.docent?.en?.length) return "ready";
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
      accession: v.optional(v.string()),
      owner: v.union(schema.doc("museums"), v.null()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork || artwork.identityStatus !== "established") return null;
    let pageUrl: string | undefined;
    let accession: string | undefined;
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
      accession = object.accession;
      owner = museum;
      break;
    }
    return { artwork, content: await readArtworkContent(ctx, artwork), pageUrl, accession, owner };
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
    if (content?.docent?.en?.length) return null;
    const now = Date.now();
    if (artwork.enrichClaimedAt !== undefined && artwork.enrichClaimedAt > now - CLAIM_MS) {
      return null;
    }
    const generation = artwork.enrichGeneration + 1;
    await ctx.db.patch("artworks", artworkId, {
      enrichClaimedAt: now,
      enrichGeneration: generation,
      docentFailedAt: undefined,
      docentNoSources: undefined,
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
    researchConflicts: v.optional(v.array(researchConflict)),
  },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, generation, factSheet, docentEn, researchConflicts }) => {
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
    const needsReview = !!researchConflicts?.length;
    if (needsReview) await clearNarration(ctx, artworkId);
    await patchArtworkContent(ctx, artwork, {
      ...(factSheet ? { factSheet } : {}),
      researchConflicts: needsReview ? researchConflicts : undefined,
      docent: needsReview ? undefined : { en: docentEn },
    });
    await ctx.db.patch("artworks", artworkId, {
      ...(factSheet ? { factSheetUpdatedAt: now } : {}),
      docentUpdatedAt: needsReview ? undefined : now,
      factSheetNeedsReview: needsReview || undefined,
      enrichClaimedAt: undefined,
      docentFailedAt: undefined,
      docentNoSources: undefined,
    });
    return true;
  },
});

// Ends a claimed run that wrote nothing. A newer claim or an invalidation keeps its own state.
export const fail = internalMutation({
  args: { artworkId: v.id("artworks"), generation: v.number(), noSources: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { artworkId, generation, noSources }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (artwork?.enrichGeneration === generation) {
      await ctx.db.patch("artworks", artworkId, {
        enrichClaimedAt: undefined,
        docentFailedAt: Date.now(),
        docentNoSources: noSources || undefined,
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
    if (scan?.deviceId === device._id && scan.confirmed && !scan.linked) {
      const { confirmed } = scan;
      if (confirmed.docent?.length || confirmed.docentUnavailable) return null;
      await ctx.db.patch("scans", scanId, { confirmed: { ...confirmed, docentFailedAt: undefined } });
      await ctx.scheduler.runAfter(0, internal.docent.ensureForScan, {
        scanId,
        deviceId: device._id,
        generation: confirmed.generation,
      });
      return null;
    }
    const named = scan?.linked ?? (scan?.outcome === "confident" ? scan.best : undefined);
    if (!scan || scan.deviceId !== device._id || !named) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const { artworkId } = named;
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

type DocentTarget = Pick<Doc<"artworks">, "title" | "artist" | "date" | "wikidataId">;
type DocentContext = {
  cachedFactSheet?: FactSheetEntry[];
  pageUrl?: string;
  accession?: string;
  owner: Doc<"museums"> | null;
};
type Generated = {
  factSheet?: FactSheetEntry[];
  docentEn: DocentSentence[];
  researchConflicts?: ResearchConflict[];
};

// Only successful empty research is permanent; source failures and rejected model output stay retryable.
async function generate(
  ctx: ActionCtx,
  models: Models,
  artwork: DocentTarget,
  context: DocentContext,
): Promise<Generated | "no_sources" | null> {
  const cached = context.cachedFactSheet?.length ? context.cachedFactSheet : undefined;
  let sources: Awaited<ReturnType<typeof gatherSources>> | undefined;
  if (!cached) {
    // Checked before the search so a blocked model run does not spend a Tavily credit for nothing.
    await ctx.runQuery(internal.spend.assertCap, { kind: "tokenFactory" });
    sources = await gatherSources(ctx, {
      artwork,
      owner: context.owner,
      pageUrl: context.pageUrl,
      accession: context.accession,
    });
    if (sources.sources.length === 0) return sources.failures > 0 ? null : "no_sources";
  }
  const hasReferences = sources?.sources.some((source) => source.referenceUrl);
  const reserved = cached ? 2 : hasReferences ? 6 : 4;
  const day = await reserveSpend(ctx, "tokenFactory", reserved);
  let calls = 0;
  try {
    if (hasReferences) {
      const result = await chatJson({
        model: models.factSheet,
        system: referenceReview.prompt,
        user: JSON.stringify({ input: referenceReviewInput(sources!.sources, artwork) }),
        schemaName: "referenceReview",
        schema: referenceReviewSchema(sources!.sources),
        maxTokens: 2048,
        parse: (value) => {
          try {
            return applyReferenceReview(value, sources!.sources);
          } catch {
            return null;
          }
        },
        timeoutMs: MODEL_TIMEOUT_MS,
      });
      calls += result.calls;
      if (result.value.conflicts.length > 0) return { docentEn: [], researchConflicts: result.value.conflicts };
      sources!.sources = result.value.sources;
      if (sources!.sources.length === 0) return sources!.failures > 0 ? null : "no_sources";
    }
    let factSheet = cached;
    if (!factSheet) {
      sources!.sources = trimSources(sources!.sources);
      const sheet = await chatJson({
        model: models.factSheet,
        system: FACT_SHEET_PROMPT,
        user: factSheetUser(sources!.sources, artwork),
        schemaName: "factSheet",
        schema: factSheetSchema(sources!.sources.length),
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
    return docentEn.length > 0 ? { ...(cached ? {} : { factSheet }), docentEn } : null;
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data.calls === "number") {
      calls += error.data.calls;
    }
    throw error;
  } finally {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tokenFactory",
      day,
      reserved,
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
    let noSources = false;
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
      const result = await generate(ctx, models, context.artwork, {
        cachedFactSheet: context.content?.factSheet,
        pageUrl: context.pageUrl,
        accession: context.accession,
        owner: context.owner,
      });
      noSources = result === "no_sources";
      if (!result || result === "no_sources") return null;
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
      await reportBackendError(error, "docent.ensure");
      throw error;
    } finally {
      if (!written) {
        await ctx.runMutation(internal.docent.fail, { artworkId, generation, noSources });
      }
    }
    return null;
  },
});

export function scanDocentStatus(confirmed: ConfirmedDetails): DocentStatus {
  if (confirmed.docent?.length) return "ready";
  if (confirmed.docentUnavailable) return "unavailable";
  return confirmed.docentFailedAt === undefined ? "writing" : "failed";
}

const scanTarget = v.object({
  title: v.string(),
  artist: v.string(),
  date: v.optional(v.string()),
  wikidataId: v.optional(v.string()),
});

export const claimScan = internalMutation({
  args: { scanId: v.id("scans"), generation: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      target: scanTarget,
      cachedFactSheet: v.optional(v.array(factSheetEntry)),
      pageUrl: v.optional(v.string()),
      accession: v.optional(v.string()),
      owner: v.union(schema.doc("museums"), v.null()),
    }),
  ),
  handler: async (ctx, { scanId, generation }) => {
    const scan = await ctx.db.get("scans", scanId);
    const confirmed = scan?.confirmed;
    const artist = confirmed?.fields.artist;
    const now = Date.now();
    if (
      !scan
      || !confirmed
      || !artist
      || confirmed.generation !== generation
      || scanDocentStatus(confirmed) === "ready"
      || confirmed.docentUnavailable
      || (confirmed.docentClaimedAt !== undefined && confirmed.docentClaimedAt > now - CLAIM_MS)
    ) {
      return null;
    }
    await ctx.db.patch("scans", scanId, {
      confirmed: { ...confirmed, docentClaimedAt: now, docentFailedAt: undefined },
    });
    const { fields } = confirmed;
    const flow = scan.labelFlow;
    // The verifier's Wikidata item and museum page name the label it read, so edits to the work drop them.
    const verified =
      confirmed.source === "label"
      && flow?.stage === "verified"
      && flow.fields.title?.value === fields.title
      && flow.fields.artist?.value === artist;
    const venue = scan.venueId ? await ctx.db.get("museums", scan.venueId) : null;
    const owner = venue && !(await isVenueOptedOut(ctx, venue)) ? venue : null;
    return {
      target: {
        title: fields.title,
        artist,
        date: fields.date,
        wikidataId: verified ? flow.wikidataId : undefined,
      },
      cachedFactSheet: confirmed.factSheet,
      pageUrl: verified ? flow.sourceUrl : undefined,
      accession: fields.accession,
      owner,
    };
  },
});

export const writeScan = internalMutation({
  args: {
    scanId: v.id("scans"),
    generation: v.number(),
    factSheet: v.optional(v.array(factSheetEntry)),
    docentEn: v.array(docentSentence),
    researchConflicts: v.optional(v.array(researchConflict)),
  },
  returns: v.boolean(),
  handler: async (ctx, { scanId, generation, factSheet, docentEn, researchConflicts }) => {
    const scan = await ctx.db.get("scans", scanId);
    const confirmed = scan?.confirmed;
    if (!confirmed || confirmed.generation !== generation || confirmed.docentClaimedAt === undefined) return false;
    // Conflicting references go to operators for an artwork; a private scan simply goes without prose.
    const conflicted = !!researchConflicts?.length;
    await ctx.db.patch("scans", scanId, {
      confirmed: {
        ...confirmed,
        ...(factSheet ? { factSheet } : {}),
        docent: conflicted ? undefined : docentEn,
        docentUnavailable: conflicted || undefined,
        docentClaimedAt: undefined,
        docentFailedAt: undefined,
      },
    });
    return true;
  },
});

export const failScan = internalMutation({
  args: { scanId: v.id("scans"), generation: v.number(), unavailable: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { scanId, generation, unavailable }) => {
    const scan = await ctx.db.get("scans", scanId);
    const confirmed = scan?.confirmed;
    if (confirmed?.generation === generation) {
      await ctx.db.patch("scans", scanId, {
        confirmed: {
          ...confirmed,
          docentClaimedAt: undefined,
          ...(unavailable ? { docentUnavailable: true } : { docentFailedAt: Date.now() }),
        },
      });
    }
    return null;
  },
});

// Scheduled when the owner confirms a scan's details and by retry. Research that finds nothing to
// cite settles as unavailable; any other run that writes nothing stays retryable.
export const ensureForScan = internalAction({
  args: { scanId: v.id("scans"), deviceId: v.id("devices"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { scanId, deviceId, generation }) => {
    const context = await ctx.runMutation(internal.docent.claimScan, { scanId, generation });
    if (!context) return null;
    let written = false;
    let unavailable = false;
    try {
      const models = configuredModels();
      if (!models) {
        console.warn("FACT_SHEET_MODEL or DOCENT_MODEL is not configured; skipping docent generation");
        return null;
      }
      await limitDevice(ctx, "docent", deviceId);
      const result = await generate(ctx, models, context.target, context);
      if (result === "no_sources") unavailable = true;
      if (!result || result === "no_sources") return null;
      written = await ctx.runMutation(internal.docent.writeScan, { scanId, generation, ...result });
    } catch (error) {
      if (error instanceof ConvexError && (error.data.code === "spend_cap" || error.data.code === "rate_limited")) {
        console.warn("Docent generation skipped", error.data);
        return null;
      }
      await reportBackendError(error, "docent.ensureForScan");
      throw error;
    } finally {
      if (!written) {
        await ctx.runMutation(internal.docent.failScan, { scanId, generation, unavailable });
      }
    }
    return null;
  },
});
