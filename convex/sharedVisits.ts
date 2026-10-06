import { ConvexError, type Infer, v } from "convex/values";

import { pageArgs, pagination } from "../shared/journal/contracts";
import { isUuid, LIMITS, utf8Bytes } from "../shared/journal/limits";
import { sharedSelection, sharedVisitCard, visitAudience } from "../shared/social/contracts";
import { normalizeHashtag } from "../shared/social/hashtags";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { acceptedRelationships, relationshipSnapshot } from "./lib/friendships";
import { resolveMentions } from "./lib/mentions";
import { flaggedUserTexts } from "./lib/moderation";
import { withErrorReporting } from "./lib/observability";
import { activeProfile, optionalProfile, requireProfile } from "./lib/ownership";
import { recordTitles } from "./lib/projections";
import { projectArtworkStory, publicArtworkStory } from "./lib/publicArtworkStory";
import { readablePublication, requireSharedVisit, requireSharedVisitItem } from "./lib/publicationAccess";
import { withdrawProfilePosts } from "./lib/publicationUpdates";
import { limitKey } from "./lib/rateLimits";
import {
  checkPublicationRevision,
  companionHistory,
  compareHistory,
  header,
  historyCursor,
  type HistoryStream,
  ownedVisit,
  PAGE_ARTWORKS,
  PAGE_BYTES,
  parseHistoryCursor,
  profileHistory,
  projectArtworkPage,
  publicationForVisit,
  publicationItems,
  publicationState,
  publicationView,
  publicHistory,
  readHeadroom,
  selectedSaves,
  projectVisitAlbum,
  stateForPublication,
  tagHistory,
} from "./lib/sharedPublications";
import { isSelectedCompanion, selectCompanions } from "./lib/visitCompanions";

const withdrawArgs = { profileId: v.id("profiles") };
export const withdrawProfile = internalAction({
  args: withdrawArgs,
  returns: v.null(),
  handler: (ctx, args): Promise<null> =>
    withErrorReporting("sharedVisits.withdrawProfile", () =>
      ctx.runMutation(internal.sharedVisits.withdrawProfileBatch, args),
    ),
});
export const withdrawProfileBatch = internalMutation({
  args: withdrawArgs,
  returns: v.null(),
  handler: (ctx, { profileId }) => withdrawProfilePosts(ctx, profileId),
});

const selectionArgs = { visitLocalId: v.string(), ...sharedSelection.fields };
async function readPublicationRequest(ctx: QueryCtx, input: Infer<typeof sharedSelection> & { visitLocalId: string }) {
  const { profile, owner, accountId } = await requireProfile(ctx);
  const publication = await publicationForVisit(ctx, profile._id, input.visitLocalId);
  if (publication?.removal) throw new ConvexError({ code: "not_found" });
  checkPublicationRevision(input.revision, publication?.publicationRevision ?? 0);
  const { visit, saves } = await selectedSaves(ctx, owner, input);
  // The device saves the audience before publishing; a mismatch means another device changed it in between.
  if (visit.visibility !== input.audience) throw new ConvexError({ code: "conflict" });
  return { profile, accountId, publication, visit, saves };
}
export const getState = query({
  args: { visitLocalId: v.string() },
  returns: publicationState,
  handler: async (ctx, { visitLocalId }) => {
    const { profile, owner } = await requireProfile(ctx);
    const visit = await ownedVisit(ctx, owner, visitLocalId);
    return stateForPublication(ctx, await publicationForVisit(ctx, profile._id, visitLocalId), visit);
  },
});
// Backs the "Shared" marker on every row of the owner's visit list with one subscription instead of one per visit;
// a visit published privately is not shared.
export const listShared = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const { profile } = await requireProfile(ctx);
    const publications = await ctx.db
      .query("sharedVisits")
      .withIndex("by_profile_status_history", (q) => q.eq("profileId", profile._id).eq("status", "active"))
      .take(1000);
    return publications
      .filter((publication) => !publication.removal && publication.audience !== "private")
      .map((publication) => publication.visitLocalId);
  },
});
export const publish = action({
  args: selectionArgs,
  returns: publicationState,
  handler: (ctx, input): Promise<Infer<typeof publicationState>> =>
    withErrorReporting("sharedVisits.publish", async () => {
      const titles = await ctx.runMutation(internal.sharedVisits.preparePublication, input);
      const [flagged] = await flaggedUserTexts([input.reflection], titles);
      if (flagged) throw new ConvexError({ code: "reflection_not_allowed" });
      return ctx.runMutation(internal.sharedVisits.savePublication, input);
    }),
});
export const preparePublication = internalMutation({
  args: selectionArgs,
  returns: v.array(v.string()),
  handler: async (ctx, input) => {
    const { accountId, saves } = await readPublicationRequest(ctx, input);
    // Commit the attempt before moderation, so rejected text also consumes the quota.
    await limitKey(ctx, "publishVisit", accountId);
    return recordTitles(ctx, saves);
  },
});
// The reflection must equal the visit's (`selectedSaves` checks it), so the text the action moderated is what goes out.
export const savePublication = internalMutation({
  args: selectionArgs,
  returns: publicationState,
  handler: async (ctx, input) => {
    const { profile, publication, visit, saves } = await readPublicationRequest(ctx, input);
    const reflection = visit.reflection ?? "";
    const mentions = await resolveMentions(ctx, reflection, profile._id, publication?.mentions);
    const fields = {
      audience: input.audience,
      status: "active" as const,
      reflection,
      mentions: mentions.length > 0 ? mentions : undefined,
      visitedOn: visit.visitedOn,
      publicationRevision: input.revision + 1,
      updatedAt: Date.now(),
      publishedAt: publication?.publishedAt || Date.now(),
      color: input.color.toUpperCase(),
      pattern: input.pattern,
      companionSelections: await selectCompanions(ctx, profile._id, input.companionIds),
    };
    const publicationId =
      publication?._id
      ?? (await ctx.db.insert("sharedVisits", {
        ...fields,
        profileId: profile._id,
        postId: crypto.randomUUID(),
        visitId: visit._id,
        visitLocalId: visit.localId,
      }));
    if (publication) await ctx.db.patch("sharedVisits", publicationId, fields);
    const previous = await publicationItems(ctx, publicationId);
    const selected = new Set(saves.map((save) => save._id));
    for (const item of previous) {
      if (!selected.has(item.saveId)) await ctx.db.delete("sharedVisitItems", item._id);
    }
    for (const [position, save] of saves.entries()) {
      const item = previous.find((item) => item.saveId === save._id);
      const photoLocalIds = input.photoSelections?.find((row) => row.saveLocalId === save.localId)?.photoLocalIds;
      const highlighted = position < 3;
      if (item) {
        await ctx.db.patch("sharedVisitItems", item._id, { position, photoLocalIds, highlighted });
      } else {
        await ctx.db.insert("sharedVisitItems", {
          publicationId,
          saveId: save._id,
          saveLocalId: save.localId,
          position,
          photoLocalIds,
          highlighted,
        });
      }
    }
    return stateForPublication(ctx, (await ctx.db.get("sharedVisits", publicationId))!, visit);
  },
});
export const get = query({
  args: { postId: v.string(), ...pageArgs },
  returns: publicationView,
  handler: async (ctx, input) => {
    const profile = await optionalProfile(ctx);
    if (!isUuid(input.postId)) throw new ConvexError({ code: "not_found" });
    const { publication, profile: author, visit } = await requireSharedVisit(ctx, input.postId, profile?._id);
    return {
      ...(await header(ctx, publication, author, visit, profile?._id)),
      artworks: await projectArtworkPage(ctx, publication, visit, input),
    };
  },
});
export const getArtwork = query({
  args: { postId: v.string(), itemId: v.id("sharedVisitItems") },
  returns: v.object({
    ...sharedVisitCard.fields,
    enrichment: v.optional(publicArtworkStory),
  }),
  handler: async (ctx, { postId, itemId }) => {
    const profile = await optionalProfile(ctx);
    const { item, save } = await requireSharedVisitItem(ctx, postId, itemId, profile?._id);
    const enrichment = await projectArtworkStory(ctx, save);
    return {
      ...(await projectVisitAlbum(ctx, item, save, postId)),
      ...(enrichment ? { enrichment } : {}),
    };
  },
});

async function historyPage(
  ctx: QueryCtx,
  viewerId: Id<"profiles"> | undefined,
  sources: HistoryStream[],
  scope: string,
  input: { cursor?: string | null; limit?: number; profileId?: Id<"profiles"> },
) {
  const { numItems } = pagination(input);
  const before = parseHistoryCursor(scope, input.cursor);
  const streams = await Promise.all(
    sources.map(async (source) => ({
      source,
      head: await source(before),
    })),
  );
  const page = [];
  let scanned = 0;
  let projected = 0;
  let bytes = 0;
  let last = before;
  while (scanned < LIMITS.maxPage && page.length < numItems) {
    const stream = streams
      .filter((s): s is { source: HistoryStream; head: Doc<"sharedVisits"> } => !!s.head)
      .sort((a, b) => -compareHistory(a.head, b.head))[0];
    if (!stream || !(await readHeadroom(ctx)) || projected + 3 > PAGE_ARTWORKS) {
      break;
    }
    const candidate = stream.head;
    // Revoked companion rows may await cleanup; never list them on the former companion's profile.
    const listed =
      !input.profileId
      || candidate.profileId === input.profileId
      || (await isSelectedCompanion(ctx, candidate, input.profileId));
    const access = listed && (await readablePublication(ctx, candidate, viewerId));
    if (access) {
      const artworks = await projectArtworkPage(ctx, candidate, access.visit, {
        limit: 3,
        highlightsOnly: true,
      });
      const result = {
        ...(await header(ctx, candidate, access.profile, access.visit, viewerId)),
        artworks,
      };
      const size = utf8Bytes(result);
      if (page.length > 0 && bytes + size > PAGE_BYTES) break;
      page.push(result);
      bytes += size;
      projected += artworks.page.length;
    }
    last = candidate;
    scanned++;
    streams.find((s) => s.source === stream.source)!.head = await stream.source(candidate);
  }
  const isDone = streams.every((s) => !s.head);
  return {
    page,
    isDone,
    cursor: isDone ? null : last ? historyCursor(scope, last) : (input.cursor ?? null),
  };
}
const historyResult = v.object({
  page: v.array(publicationView),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});
export const listPublic = query({
  args: pageArgs,
  returns: historyResult,
  handler: async (ctx, input) => {
    const viewer = await optionalProfile(ctx);
    return historyPage(ctx, viewer?._id, [publicHistory(ctx)], `public:${viewer?._id ?? "guest"}`, input);
  },
});
export const listFeed = query({
  args: pageArgs,
  returns: historyResult,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    // Each candidate is re-authorized in historyPage, so the edge list alone selects the streams. The viewer's own
    // posts join their feed, by visit date, so a visit is in the feed they land on after posting it.
    const edges = await acceptedRelationships(ctx, profile._id);
    const authors = [
      profile._id,
      ...edges
        .slice(0, LIMITS.friends)
        .map((edge) => (edge.firstProfileId === profile._id ? edge.secondProfileId : edge.firstProfileId)),
    ];
    return historyPage(
      ctx,
      profile._id,
      authors.map((id) => profileHistory(ctx, id)),
      `feed:${profile._id}`,
      input,
    );
  },
});
export const listByProfile = query({
  args: { profileId: v.id("profiles"), audience: v.optional(visitAudience), ...pageArgs },
  returns: historyResult,
  handler: async (ctx, { audience, ...input }) => {
    const viewer = await optionalProfile(ctx);
    if (!(await activeProfile(ctx, input.profileId))) {
      throw new ConvexError({ code: "not_found" });
    }
    const empty = { page: [], cursor: null, isDone: true };
    const own = viewer?._id === input.profileId;
    let friend = false;
    if (viewer && !own) {
      // A block in either direction hides every post, so skip the per-candidate scan that would reject them all.
      const { edge, block, reverseBlock } = await relationshipSnapshot(ctx, input.profileId, viewer._id);
      if (block?.active || reverseBlock?.active) return empty;
      friend = edge?.state === "accepted";
    }
    // The same shortcut for an audience filter the viewer can never read.
    if ((audience === "private" && !own) || (audience === "friends" && !own && !friend)) return empty;
    // Visits the profile was named on join its own unless a filter narrows the list to one audience of its own posts.
    return historyPage(
      ctx,
      viewer?._id,
      audience
        ? [profileHistory(ctx, input.profileId, audience)]
        : [profileHistory(ctx, input.profileId), companionHistory(ctx, input.profileId)],
      `profile:${viewer?._id ?? "guest"}:${input.profileId}:${audience ?? "all"}`,
      input,
    );
  },
});
// A tag page lists the posts whose notes use the tag, re-authorized per viewer like every other feed.
export const listByTag = query({
  args: { tag: v.string(), ...pageArgs },
  returns: historyResult,
  handler: async (ctx, { tag, ...input }) => {
    const viewer = await optionalProfile(ctx);
    const normalized = normalizeHashtag(tag);
    if (!normalized) throw new ConvexError({ code: "not_found" });
    return historyPage(
      ctx,
      viewer?._id,
      [tagHistory(ctx, normalized)],
      `tag:${viewer?._id ?? "guest"}:${normalized}`,
      input,
    );
  },
});
