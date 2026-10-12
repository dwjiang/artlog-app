import { type Infer, v } from "convex/values";

import { guideOpening, guideResearch } from "../shared/audio/guide";
import { catalogSearchText } from "../shared/catalog/text";
import { pageArgs, pagination } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { CLAIM_MS, docentStatusOf, FAILED_RESEARCH_RETRY_MS } from "./docent";
import { internalMutation, mutation } from "./functions";
import { artistByKey, artworkSearchFields } from "./lib/artists";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { narrationEntry, renderedNarration, scriptCurrent } from "./lib/narrationCache";
import { readObjectDetails } from "./lib/objectDetails";
import { eligibleObjectRecord } from "./lib/recognitionEligibility";
import {
  docentSentence,
  docentStatus,
  factChip,
  guideSentence,
  rightsStatus,
  snapshotFields,
  toFactChip,
} from "./lib/validators";
import { narrationResearch, scriptFailed } from "./narration";
import { joinCandidate } from "./scans";

// Artwork-level enrichment for a saved work: the snapshot never changes, this can.
export const enrichment = query({
  args: { artworkId: v.id("artworks") },
  returns: v.union(
    v.null(),
    v.object({
      docent: v.optional(v.array(docentSentence)),
      docentWriting: v.boolean(),
      // Whether a missing story failed (retryable) or cannot be written (no sources, held for review).
      docentStatus,
      docentGeneration: v.number(),
      factSheet: v.optional(v.array(factChip)),
      // A play can narrate the work, researching it first when it has never been researched.
      narrationAvailable: v.boolean(),
      narrationFacts: v.optional(v.array(factChip)),
      narrationResearchUpdatedAt: v.optional(v.number()),
      narrationOpening: v.string(),
      narrationRenderId: v.optional(v.string()),
      narration: v.optional(v.array(guideSentence)),
      narrationWriting: v.boolean(),
      rightsStatus,
      thumbnailUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { artworkId }) => {
    await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) return null;
    let thumbnailUrl: string | undefined;
    if (artwork.rightsStatus === "public_domain") {
      for await (const object of ctx.db
        .query("objects")
        .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
        if (!(await eligibleObjectRecord(ctx, object))) {
          continue;
        }
        const details = await readObjectDetails(ctx, object);
        if (!details?.thumbnailUrl) continue;
        thumbnailUrl = details.thumbnailUrl;
        break;
      }
    }
    const content = await readArtworkContent(ctx, artwork);
    const research = narrationResearch(artwork, content);
    const narrationFacts = research === "ready" ? guideResearch(content?.factSheet ?? []) : [];
    const rendered = narrationFacts.length > 0 ? await renderedNarration(ctx, artwork) : null;
    const entry = narrationFacts.length > 0 ? await narrationEntry(ctx, artworkId) : null;
    // The script shows as soon as it is written, before its audio; a claimed row without one is being written.
    const script = entry && scriptCurrent(entry, artwork) ? entry : null;
    return {
      docent: content?.docent?.en,
      docentWriting: !content?.docent?.en && artwork.enrichClaimedAt !== undefined && !artwork.factSheetNeedsReview,
      docentStatus: docentStatusOf(artwork, content),
      docentGeneration: artwork.enrichGeneration,
      factSheet: content?.factSheet?.map(toFactChip),
      narrationAvailable: research !== "unavailable" && !(entry && scriptFailed(entry, artwork)),
      narrationFacts: narrationFacts.length > 0 ? narrationFacts.map(toFactChip) : undefined,
      narrationResearchUpdatedAt: narrationFacts.length > 0 ? artwork.factSheetUpdatedAt : undefined,
      narrationRenderId: rendered?.renderId,
      narration: script?.sentences,
      narrationWriting: !!script?.claim && !script.sentences,
      narrationOpening: guideOpening(artwork),
      rightsStatus: artwork.rightsStatus,
      thumbnailUrl,
    };
  },
});

const SEARCH_FIELDS_PAGE = 256;

// `convex import` skips the artworks trigger, so imported corpus rows get their search text and artist key (and
// count toward their artist) only when this runs. Rows already current are left alone, so it can be re-run.
export const backfillSearchFields = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("artworks").paginate({ cursor, numItems: SEARCH_FIELDS_PAGE });
    for (const artwork of page.page) {
      const fields = artworkSearchFields(artwork);
      if (artwork.searchText !== fields.searchText || artwork.artistKey !== fields.artistKey) {
        await ctx.db.patch("artworks", artwork._id, fields);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.artworks.backfillSearchFields, { cursor: page.continueCursor });
    }
    return null;
  },
});

// A work can hang in several places; looking past a few objects for a picture isn't worth the reads.
const OBJECTS_PER_WORK = 8;

export const catalogArtwork = snapshotFields.extend({
  artworkId: v.id("artworks"),
  thumbnailUrl: v.optional(v.string()),
});
export type CatalogArtwork = Infer<typeof catalogArtwork>;
export const catalogArtworkPage = v.object({
  page: v.array(catalogArtwork),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

/** A catalog work as search and its page show it, from its first eligible object; null once it can't be shown. */
export async function projectCatalogArtwork(ctx: QueryCtx, artwork: Doc<"artworks">): Promise<CatalogArtwork | null> {
  if (artwork.retiredAt || artwork.identityStatus !== "established") return null;
  const objects = await ctx.db
    .query("objects")
    .withIndex("by_artworkId", (q) => q.eq("artworkId", artwork._id))
    .take(OBJECTS_PER_WORK);
  let shown: CatalogArtwork | null = null;
  for (const object of objects) {
    if (object.identityStatus !== "established") continue;
    const joined = await joinCandidate(ctx, {
      objectId: object._id,
      artworkId: artwork._id,
      identityStatus: "established",
    });
    if (!joined) continue;
    const { title, artist, date, medium, institution } = joined.candidate;
    const thumbnailUrl = artwork.rightsStatus === "public_domain" ? joined.candidate.thumbnailUrl : undefined;
    shown ??= { artworkId: artwork._id, title, artist, date, medium, institution, thumbnailUrl };
    if (thumbnailUrl) return { ...shown, thumbnailUrl };
  }
  return shown;
}

/** Catalog works whose title or artist has every word of the query, best match first. */
export async function searchArtworks(
  ctx: QueryCtx,
  query: string,
  input: { cursor?: string | null; limit?: number },
): Promise<Infer<typeof catalogArtworkPage>> {
  const text = catalogSearchText(query);
  const options = pagination(input);
  if (!text) return { page: [], cursor: null, isDone: true };
  const result = await ctx.db
    .query("artworks")
    .withSearchIndex("search_text", (q) => q.search("searchText", text))
    .paginate(options);
  const page = [];
  for (const artwork of result.page) {
    const shown = await projectCatalogArtwork(ctx, artwork);
    if (shown) page.push(shown);
  }
  return { page, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
}

export const search = query({
  args: { query: v.string(), ...pageArgs },
  returns: catalogArtworkPage,
  handler: async (ctx, input) => {
    await requireDevice(ctx);
    return searchArtworks(ctx, input.query, input);
  },
});

/** A catalog work's page: its details and the artist page they link to. */
export const get = query({
  args: { artworkId: v.id("artworks") },
  returns: v.union(v.null(), catalogArtwork.extend({ artistId: v.optional(v.id("artists")) })),
  handler: async (ctx, { artworkId }) => {
    await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", artworkId);
    const shown = artwork && (await projectCatalogArtwork(ctx, artwork));
    if (!shown) return null;
    const artist = artwork.artistKey ? await artistByKey(ctx, artwork.artistKey) : null;
    return { ...shown, ...(artist ? { artistId: artist._id } : {}) };
  },
});

// Opening a work starts missing research. Successful empty research isn't repeated; a failed run waits before an
// open retries it, but "Try again" (`retry`) asks at once. Runs stay subject to the per-device limit and daily spend
// cap. True when a run starts.

export const research = mutation({
  args: { artworkId: v.id("artworks"), retry: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, { artworkId, retry }) => {
    const device = await requireDevice(ctx);
    const artwork = await ctx.db.get("artworks", artworkId);
    const now = Date.now();
    if (
      !artwork
      || artwork.retiredAt
      || artwork.identityStatus !== "established"
      || artwork.factSheetNeedsReview
      || artwork.docentNoSources
      || (artwork.enrichClaimedAt !== undefined && artwork.enrichClaimedAt > now - CLAIM_MS)
      || (!retry && artwork.docentFailedAt !== undefined && artwork.docentFailedAt > now - FAILED_RESEARCH_RETRY_MS)
    ) {
      return false;
    }
    if ((await readArtworkContent(ctx, artwork))?.docent?.en?.length) return false;
    await ctx.scheduler.runAfter(0, internal.docent.ensure, { artworkId, deviceId: device._id });
    return true;
  },
});
