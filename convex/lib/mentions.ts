import type { Infer } from "convex/values";

import type { mention } from "../../shared/social/contracts";
import { extractMentions, MAX_NOTIFIED_MENTIONS } from "../../shared/social/mentions";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { blockedEitherWay, findRelationship } from "./friendships";
import { activeProfile } from "./ownership";
import { visibleParticipant } from "./visitReactions";

export type Mention = Infer<typeof mention>;
type Post = Pick<Doc<"sharedVisits">, "profileId" | "audience">;

/**
 * The people `text` names, stored beside it. A handle `previous` already resolved keeps its person, so a later rename
 * leaves the text linked; a new handle is looked up by username. Unknown, inactive and blocked people stay text.
 */
export async function resolveMentions(
  ctx: QueryCtx,
  text: string,
  writerId: Id<"profiles">,
  previous: readonly Mention[] = [],
): Promise<Mention[]> {
  const resolved: Mention[] = [];
  for (const username of extractMentions(text)) {
    const known = previous.find((row) => row.username === username);
    const found = known
      ? await activeProfile(ctx, known.profileId)
      : await ctx.db
          .query("profiles")
          .withIndex("by_username", (q) => q.eq("username", username))
          .unique();
    const profile = found && (await activeProfile(ctx, found._id));
    if (!profile || (await blockedEitherWay(ctx, writerId, profile._id))) continue;
    resolved.push({ username, profileId: profile._id });
  }
  return resolved;
}

/** Whether someone may read a post: its author, anyone for a public post, otherwise the author's friends. */
export async function canSeePost(ctx: QueryCtx, post: Post, profileId: Id<"profiles">) {
  if (profileId === post.profileId) return true;
  if (await blockedEitherWay(ctx, post.profileId, profileId)) return false;
  return post.audience === "public" || (await findRelationship(ctx, post.profileId, profileId))?.state === "accepted";
}

/**
 * The stored mentions a viewer sees as links: people still active, blocked by neither the viewer nor the writer, and,
 * on a post or its comments, able to read that post. The rest read as plain text. "Only you" posts link the author's
 * friends, the people the author could share it with.
 */
export async function linkedMentions(
  ctx: QueryCtx,
  mentions: readonly Mention[] | undefined,
  { viewerId, writerId, post }: { viewerId?: Id<"profiles">; writerId: Id<"profiles">; post?: Post },
): Promise<Mention[]> {
  const linked: Mention[] = [];
  for (const row of mentions ?? []) {
    if (!(await visibleParticipant(ctx, row.profileId, [viewerId, writerId, post?.profileId]))) continue;
    if (post && !(await canSeePost(ctx, post, row.profileId))) continue;
    linked.push(row);
  }
  return linked;
}

/** The people a mention notice goes to: the first few named who can read the post, minus the people in `skip`. */
export async function mentionRecipients(
  ctx: QueryCtx,
  mentions: readonly Mention[] | undefined,
  post: Post,
  skip: readonly Id<"profiles">[],
): Promise<Id<"profiles">[]> {
  const recipients: Id<"profiles">[] = [];
  for (const { profileId } of (mentions ?? []).slice(0, MAX_NOTIFIED_MENTIONS)) {
    if (skip.includes(profileId)) continue;
    if (!(await activeProfile(ctx, profileId)) || !(await canSeePost(ctx, post, profileId))) continue;
    recipients.push(profileId);
  }
  return recipients;
}

/** Who hears about a post's notes: nobody while it is hidden or "Only you"; companions hear "added you" instead. */
export async function postMentionRecipients(
  ctx: QueryCtx,
  post: Doc<"sharedVisits"> | null,
): Promise<Id<"profiles">[]> {
  if (!post || post.status !== "active" || post.removal || post.audience === "private") return [];
  const companions = (post.companionSelections ?? []).map((selection) => selection.profileId);
  return mentionRecipients(ctx, post.mentions, post, [post.profileId, ...companions]);
}

/** Whether a stored mention list still names someone among the people it notifies. */
export const notifiesPerson = (mentions: readonly Mention[] | undefined, profileId: Id<"profiles">) =>
  (mentions ?? []).slice(0, MAX_NOTIFIED_MENTIONS).some((row) => row.profileId === profileId);
