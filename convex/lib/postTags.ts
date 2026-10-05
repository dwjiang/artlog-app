import type { Triggers } from "convex-helpers/server/triggers";

import { extractHashtags, MAX_POST_TAGS } from "../../shared/social/hashtags";
import { isOffensive } from "../../shared/social/offensive-text";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The tags a post is listed under: none unless it is active, not removed, and shared beyond its author. */
export function indexedTags(publication: Doc<"sharedVisits"> | null): string[] {
  if (!publication || publication.status !== "active" || publication.removal || publication.audience === "private") {
    return [];
  }
  return extractHashtags(publication.reflection).filter((tag) => !isOffensive(tag));
}

export function tagStats(ctx: QueryCtx, tag: string) {
  return ctx.db
    .query("tagStats")
    .withIndex("by_tag", (q) => q.eq("tag", tag))
    .unique();
}

async function changePublicCount(ctx: MutationCtx, tag: string, delta: number) {
  const stats = await tagStats(ctx, tag);
  const publicCount = (stats?.publicCount ?? 0) + delta;
  if (stats && publicCount <= 0) await ctx.db.delete("tagStats", stats._id);
  else if (stats) await ctx.db.patch("tagStats", stats._id, { publicCount });
  else if (publicCount > 0) await ctx.db.insert("tagStats", { tag, publicCount });
}

// Every write path (publishing, a visit's audience or date changing, review removal, account deletion) goes through
// this trigger, so tag pages and counts follow the post without each path knowing about tags.
export function registerPostTags(triggers: Triggers<DataModel>) {
  triggers.register("sharedVisits", async (ctx, { id, newDoc }) => {
    const wanted = indexedTags(newDoc);
    const rows = await ctx.db
      .query("postTags")
      .withIndex("by_publication", (q) => q.eq("publicationId", id))
      .take(MAX_POST_TAGS);
    for (const row of rows) {
      if (wanted.includes(row.tag)) continue;
      await ctx.db.delete("postTags", row._id);
      if (row.public) await changePublicCount(ctx, row.tag, -1);
    }
    if (!newDoc) return;
    const fields = {
      visitedOn: newDoc.visitedOn,
      publishedAt: newDoc.publishedAt,
      public: newDoc.audience === "public",
    };
    for (const tag of wanted) {
      const row = rows.find((existing) => existing.tag === tag);
      if (!row) {
        await ctx.db.insert("postTags", { tag, publicationId: id, postId: newDoc.postId, ...fields });
        if (fields.public) await changePublicCount(ctx, tag, 1);
      } else if (
        row.visitedOn !== fields.visitedOn
        || row.publishedAt !== fields.publishedAt
        || row.public !== fields.public
      ) {
        await ctx.db.patch("postTags", row._id, fields);
        if (row.public !== fields.public) await changePublicCount(ctx, tag, fields.public ? 1 : -1);
      }
    }
  });
}
