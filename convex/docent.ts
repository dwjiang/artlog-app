import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
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
import { limitDevice } from "./lib/rateLimits";
import { chatJson } from "./lib/tokenFactory";
import {
  docentSentence,
  factSheetEntry,
  type DocentSentence,
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

export async function clearDocent(
  ctx: MutationCtx,
  artwork: Doc<"artworks">,
): Promise<void> {
  await ctx.db.patch(artwork._id, {
    docent: undefined,
    docentUpdatedAt: undefined,
    enrichClaimedAt: undefined,
    enrichGeneration: (artwork.enrichGeneration ?? 0) + 1,
  });
}

export const load = internalQuery({
  args: { artworkId: v.id("artworks") },
  returns: v.union(
    v.null(),
    v.object({
      artwork: schema.doc("artworks"),
      pageUrl: v.optional(v.string()),
      owner: v.union(schema.doc("museums"), v.null()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get(artworkId);
    if (!artwork || artwork.identityStatus !== "established") return null;
    let pageUrl: string | undefined;
    let owner: Doc<"museums"> | null = null;
    for await (const object of ctx.db
      .query("objects")
      .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
      if (
        object.reverted
        || object.mergedInto
        || !object.pageUrl
        || !object.ownerId
      ) {
        continue;
      }
      const museum = await ctx.db.get(object.ownerId);
      if (!museum || (await isVenueOptedOut(ctx, museum))) continue;
      pageUrl = object.pageUrl;
      owner = museum;
      break;
    }
    return { artwork, pageUrl, owner };
  },
});

export const claim = internalMutation({
  args: { artworkId: v.id("artworks") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { artworkId }) => {
    const artwork = await ctx.db.get(artworkId);
    if (
      !artwork
      || artwork.identityStatus !== "established"
      || artwork.docent?.en
      || artwork.factSheetNeedsReview
    ) {
      return null;
    }
    const now = Date.now();
    if (
      artwork.enrichClaimedAt !== undefined
      && artwork.enrichClaimedAt > now - CLAIM_MS
    ) {
      return null;
    }
    const generation = (artwork.enrichGeneration ?? 0) + 1;
    await ctx.db.patch(artworkId, {
      enrichClaimedAt: now,
      enrichGeneration: generation,
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
    const artwork = await ctx.db.get(artworkId);
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
    await ctx.db.patch(artworkId, {
      ...(factSheet ? { factSheet, factSheetUpdatedAt: now } : {}),
      docent: { en: docentEn },
      docentUpdatedAt: now,
      enrichClaimedAt: undefined,
    });
    return true;
  },
});

export const invalidateDocent = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    includeResearch: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, includeResearch }) => {
    const artwork = await ctx.db.get(artworkId);
    if (artwork) {
      await clearDocent(ctx, artwork);
      if (includeResearch) {
        await ctx.db.patch(artworkId, {
          factSheet: undefined,
          factSheetUpdatedAt: undefined,
        });
      }
    }
    return null;
  },
});

type Models = { factSheet: string; docent: string };

function configuredModels(): Models | null {
  const factSheet = process.env.FACT_SHEET_MODEL;
  const docent = process.env.DOCENT_MODEL;
  return factSheet && docent ? { factSheet, docent } : null;
}

async function generate(
  ctx: ActionCtx,
  models: Models,
  artwork: Doc<"artworks">,
  context: { pageUrl?: string; owner: Doc<"museums"> | null },
): Promise<{
  factSheet?: FactSheetEntry[];
  docentEn: DocentSentence[];
} | null> {
  const cached =
    artwork.factSheetUpdatedAt !== undefined ? artwork.factSheet : undefined;
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
    if (!sources.sources.length) {
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
    if (factSheet.length) {
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

// Scheduled after a confident identification (identify.ts); the card never waits on it. Reuses a
// current fact sheet and only rewrites the sentences when they were invalidated.
export const ensure = internalAction({
  args: { artworkId: v.id("artworks"), deviceId: v.id("devices") },
  returns: v.null(),
  handler: async (ctx, { artworkId, deviceId }) => {
    const models = configuredModels();
    if (!models) {
      console.warn(
        "FACT_SHEET_MODEL or DOCENT_MODEL is not configured; skipping docent generation",
      );
      return null;
    }
    const generation = await ctx.runMutation(internal.docent.claim, {
      artworkId,
    });
    if (generation === null) return null;
    let written = false;
    try {
      const context = await ctx.runQuery(internal.docent.load, { artworkId });
      if (
        !context
        || context.artwork.enrichGeneration !== generation
        || context.artwork.factSheetNeedsReview
      ) {
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
      if (
        error instanceof ConvexError
        && (error.data.code === "spend_cap"
          || error.data.code === "rate_limited")
      ) {
        console.warn("Docent generation skipped", error.data);
        return null;
      }
      throw error;
    } finally {
      if (!written) {
        await ctx.runMutation(internal.enrich.releaseClaim, {
          artworkId,
          generation,
        });
      }
    }
    return null;
  },
});
