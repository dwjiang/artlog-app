import { ConvexError, type Infer, v } from "convex/values";

import { pageArgs, pagination } from "../shared/journal/contracts";
import { displayMedia, publicProfile, relationship } from "../shared/social/contracts";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { relationshipSnapshot } from "./lib/friendships";
import { requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { readablePublication } from "./lib/publicationAccess";
import { projectArtworkPage } from "./lib/sharedPublications";
import { isListedCompanion } from "./lib/visitCompanions";
import { visibleParticipant } from "./lib/visitReactions";

const pageFields = { cursor: v.union(v.string(), v.null()), isDone: v.boolean() };
const base = {
  id: v.id("notifications"),
  createdAt: v.number(),
  actor: publicProfile,
};
const visit = {
  postId: v.string(),
  venue: v.string(),
  media: v.optional(displayMedia),
};
const notification = v.union(
  v.object({ ...base, kind: v.literal("friendRequest"), relationship }),
  v.object({ ...base, kind: v.literal("friendAccepted") }),
  v.object({ ...base, kind: v.literal("visitLike"), ...visit }),
  v.object({ ...base, kind: v.literal("visitComment"), ...visit, body: v.string() }),
  v.object({ ...base, kind: v.literal("visitCompanion"), ...visit }),
);
export type Notification = Infer<typeof notification>;
type VisitSummary = { postId: string; venue: string; media?: Infer<typeof displayMedia> };

export async function seenAt(ctx: QueryCtx, profileId: Id<"profiles">) {
  const read = await ctx.db
    .query("notificationReads")
    .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
    .unique();
  return read?.seenAt ?? 0;
}

export function received(ctx: QueryCtx, profileId: Id<"profiles">, after = 0) {
  return ctx.db
    .query("notifications")
    .withIndex("by_recipient", (q) => q.eq("recipientId", profileId).gt("_creationTime", after))
    .order("desc");
}

// Rows are checked against current state, so a hidden visit, a block, or a withdrawn friendship drops its rows.
export async function resolveNotifications(
  ctx: QueryCtx,
  viewer: Doc<"profiles">,
  rows: Doc<"notifications">[],
  withMedia: boolean,
): Promise<Notification[]> {
  const visits = new Map<string, VisitSummary | null>();
  // Likes and comments are on the viewer's own visits; a companion notice is on the actor's, which must still name them.
  async function visitSummary(publicationId: Id<"sharedVisits">, authorId: Id<"profiles">) {
    const key = `${publicationId}:${authorId}`;
    if (!visits.has(key)) {
      const publication = await ctx.db.get("sharedVisits", publicationId);
      const listed =
        publication?.profileId === authorId
        && (authorId === viewer._id || (await isListedCompanion(ctx, publicationId, viewer._id)));
      const access = listed ? await readablePublication(ctx, publication, viewer._id) : null;
      let summary: VisitSummary | null = null;
      if (access) {
        const first = withMedia
          ? (await projectArtworkPage(ctx, access.publication, access.visit, { limit: 1 })).page[0]
          : undefined;
        const media = first?.photos?.[0] ?? first?.artwork.media;
        summary = { postId: access.publication.postId, venue: access.visit.venueName, ...(media ? { media } : {}) };
      }
      visits.set(key, summary);
    }
    return visits.get(key)!;
  }
  const items: Notification[] = [];
  for (const row of rows) {
    const actor = await visibleParticipant(ctx, row.actorId, [viewer._id]);
    if (!actor) continue;
    const fields = { id: row._id, createdAt: row._creationTime, actor: await projectProfile(ctx, actor) };
    const { event } = row;
    if (event.kind === "friendRequest" || event.kind === "friendAccepted") {
      const { state } = await relationshipSnapshot(ctx, viewer._id, actor._id);
      if (event.kind === "friendRequest" && (state.state === "accepted" || state.requesterId === actor._id)) {
        items.push({ ...fields, kind: event.kind, relationship: state });
      } else if (event.kind === "friendAccepted" && state.state === "accepted") {
        items.push({ ...fields, kind: event.kind });
      }
      continue;
    }
    const summary = await visitSummary(event.publicationId, event.kind === "visitCompanion" ? actor._id : viewer._id);
    if (!summary) continue;
    if (event.kind === "visitLike" || event.kind === "visitCompanion") {
      items.push({ ...fields, kind: event.kind, ...summary });
    } else {
      const comment = await ctx.db.get("visitComments", event.commentId);
      if (comment) items.push({ ...fields, kind: event.kind, ...summary, body: comment.body });
    }
  }
  return items;
}

export const list = query({
  args: pageArgs,
  returns: v.object({ seenAt: v.number(), page: v.array(notification), ...pageFields }),
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    const result = await received(ctx, profile._id).paginate(pagination(input));
    return {
      seenAt: await seenAt(ctx, profile._id),
      page: await resolveNotifications(ctx, profile, result.page, true),
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const unseen = query({
  args: pageArgs,
  returns: v.object({ page: v.array(notification), ...pageFields }),
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    const result = await received(ctx, profile._id, await seenAt(ctx, profile._id)).paginate(pagination(input));
    return {
      page: await resolveNotifications(ctx, profile, result.page, false),
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const markSeen = mutation({
  args: { through: v.number() },
  returns: v.null(),
  handler: async (ctx, { through }) => {
    const { profile } = await requireProfile(ctx);
    if (!Number.isFinite(through) || through < 0) throw new ConvexError({ code: "invalid_notification" });
    const read = await ctx.db
      .query("notificationReads")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    const latest = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", profile._id))
      .order("desc")
      .first();
    const next = Math.min(through, latest?._creationTime ?? 0);
    if (next <= (read?.seenAt ?? 0)) return null;
    if (read) await ctx.db.patch("notificationReads", read._id, { seenAt: next });
    else await ctx.db.insert("notificationReads", { profileId: profile._id, seenAt: next });
    return null;
  },
});
