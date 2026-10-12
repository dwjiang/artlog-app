import { v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { clearDocent } from "./docent";
import { internalMutation } from "./functions";
import { readArtworkContent } from "./lib/artworkContent";
import { reportBackendError } from "./lib/observability";
import { getEntities, type WikidataEntity } from "./lib/wikidata";

// Corpus imports titled works Wikidata gave no label for by their item ID.
const UNLABELED = /^Q\d+$/;
const WIKIDATA_ID = /^Q[1-9]\d*$/;
const UNTITLED = "Untitled";
const PUBLISHED_TITLE = "P1476";
// The order of `artwork_title` in scripts/data/pipeline/sources/wikidata_artworks.py, which titles imported works.
const LANGUAGE_ORDER = ["en", "mul", "en-", "fr", "de", "es", "it"];
const PAGE_SIZE = 1000;
const ATTEMPTS = 3;
const RETRY_MS = 60 * 1000;
const LOGGED_CHANGES = 25;

const backfillProgress = v.object({
  scanned: v.number(),
  unlabeled: v.number(),
  retitled: v.number(),
  untitled: v.number(),
  // Rows whose item Wikidata no longer has, or whose lookups kept failing; a later run retries them.
  unresolved: v.number(),
});
type BackfillProgress = Infer<typeof backfillProgress>;
const NO_PROGRESS: BackfillProgress = { scanned: 0, unlabeled: 0, retitled: 0, untitled: 0, unresolved: 0 };

const runResult = backfillProgress.extend({ isDone: v.boolean() });

const unlabeledPageResult = v.object({
  artworks: v.array(v.object({ artworkId: v.id("artworks"), title: v.string(), wikidataId: v.optional(v.string()) })),
  scanned: v.number(),
  cursor: v.string(),
  isDone: v.boolean(),
});

const titleChange = v.object({ artworkId: v.id("artworks"), unlabeled: v.string(), title: v.string() });

type Name = { text: string; language: string };

function languageRank(language: string): [number, string] {
  const index = LANGUAGE_ORDER.indexOf(language.startsWith("en-") ? "en-" : language);
  return [index === -1 ? LANGUAGE_ORDER.length : index, language];
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function best(id: string, names: Name[]): string | undefined {
  const candidates = names.flatMap(({ text, language }) => {
    const trimmed = text.trim();
    return trimmed && trimmed !== id ? [{ rank: languageRank(language), text: trimmed }] : [];
  });
  candidates.sort((a, b) => a.rank[0] - b.rank[0] || compareText(a.rank[1], b.rank[1]) || compareText(a.text, b.text));
  return candidates[0]?.text;
}

// The statements SPARQL's wdt: prefix reads: preferred ones when there are any, else every non-deprecated one.
function publishedTitles(entity: WikidataEntity): Name[] {
  const claims = (entity.claims?.[PUBLISHED_TITLE] ?? []).filter((claim) => claim.rank !== "deprecated");
  const preferred = claims.filter((claim) => claim.rank === "preferred");
  return (preferred.length > 0 ? preferred : claims).flatMap(({ mainsnak }) => {
    const value = mainsnak?.snaktype === "value" ? mainsnak.datavalue?.value : undefined;
    if (!value || typeof value !== "object") return [];
    const { text, language } = value as { text?: unknown; language?: unknown };
    return typeof text === "string" && typeof language === "string" ? [{ text, language }] : [];
  });
}

function wikidataTitle(entity: WikidataEntity): string {
  const labels = Object.entries(entity.labels ?? {}).map(([language, label]) => ({ language, text: label.value }));
  const english = labels.filter(({ language }) => language === "en" || language === "mul");
  return best(entity.id, english) ?? best(entity.id, publishedTitles(entity)) ?? best(entity.id, labels) ?? UNTITLED;
}

export const unlabeledPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: unlabeledPageResult,
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("artworks").paginate({ cursor, numItems: PAGE_SIZE });
    const artworks = page.page.flatMap(({ _id, title, wikidataId }) =>
      UNLABELED.test(title)
        ? [{ artworkId: _id, title, wikidataId: [wikidataId, title].find((id) => id && WIKIDATA_ID.test(id)) }]
        : [],
    );
    return { artworks, scanned: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Sets each title that still reads as the item ID it was read as; returns the artworks it changed. Research run under
 * the ID searched the web for it and likely settled as having no sources, so the next open researches the work again.
 */
export const applyTitles = internalMutation({
  args: { changes: v.array(titleChange) },
  returns: v.array(v.id("artworks")),
  handler: async (ctx, { changes }) => {
    const applied = [];
    for (const { artworkId, unlabeled, title } of changes) {
      const artwork = await ctx.db.get("artworks", artworkId);
      if (!UNLABELED.test(unlabeled) || artwork?.title !== unlabeled) continue;
      const content = await readArtworkContent(ctx, artwork);
      if (!content?.docent?.en?.length && !artwork.factSheetNeedsReview) {
        await clearDocent(ctx, artwork, { includeResearch: true });
      }
      await ctx.db.patch("artworks", artworkId, { title, docentNoSources: undefined, docentFailedAt: undefined });
      applied.push(artworkId);
    }
    return applied;
  },
});

/**
 * Replaces artwork titles that are bare Wikidata item IDs with the item's title, a page of artworks at a time.
 * A dry run logs the changes without writing them. Reruns touch only titles still unlabeled; a page whose lookups
 * fail three times is skipped and logged with its cursor.
 */
export const run = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    attempt: v.optional(v.number()),
    progress: v.optional(backfillProgress),
  },
  returns: runResult,
  handler: async (
    ctx,
    { dryRun = false, cursor = null, attempt = 1, progress = NO_PROGRESS },
  ): Promise<Infer<typeof runResult>> => {
    const page: Infer<typeof unlabeledPageResult> = await ctx.runQuery(internal.titleBackfill.unlabeledPage, {
      cursor,
    });
    const ids = page.artworks.flatMap(({ wikidataId }) => (wikidataId ? [wikidataId] : []));
    let entities: Record<string, WikidataEntity> = {};
    try {
      entities = await getEntities(ids, "labels|claims", "all");
    } catch (error) {
      if (attempt < ATTEMPTS) {
        await ctx.scheduler.runAfter(RETRY_MS, internal.titleBackfill.run, {
          dryRun,
          cursor,
          attempt: attempt + 1,
          progress,
        });
        return { ...progress, isDone: false };
      }
      console.warn("Title backfill skipped a page whose Wikidata lookups failed", { cursor });
      await reportBackendError(error, "titleBackfill.run");
    }
    const found = page.artworks.flatMap(({ artworkId, title: unlabeled, wikidataId }) => {
      const entity = wikidataId ? entities[wikidataId] : undefined;
      return entity ? [{ artworkId, unlabeled, title: wikidataTitle(entity) }] : [];
    });
    let changes = found;
    if (!dryRun && found.length > 0) {
      const applied: Id<"artworks">[] = await ctx.runMutation(internal.titleBackfill.applyTitles, { changes: found });
      changes = found.filter(({ artworkId }) => applied.includes(artworkId));
    }
    const untitled = changes.filter(({ title }) => title === UNTITLED).length;
    const next = {
      scanned: progress.scanned + page.scanned,
      unlabeled: progress.unlabeled + page.artworks.length,
      retitled: progress.retitled + changes.length - untitled,
      untitled: progress.untitled + untitled,
      unresolved: progress.unresolved + page.artworks.length - found.length,
    };
    console.log(page.isDone ? "Title backfill finished" : "Title backfill page", {
      dryRun,
      ...next,
      cursor: page.isDone ? null : page.cursor,
      changes: changes.slice(0, LOGGED_CHANGES).map(({ unlabeled, title }) => `${unlabeled} → ${title}`),
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.titleBackfill.run, { dryRun, cursor: page.cursor, progress: next });
    }
    return { ...next, isDone: page.isDone };
  },
});
