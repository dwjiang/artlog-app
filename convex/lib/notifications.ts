import type { Triggers } from "convex-helpers/server/triggers";

import { isApprovedDemo } from "../../shared/demo-policy";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { demoPerson } from "./demoAccounts";
import { mentionRecipients, postMentionRecipients } from "./mentions";
import { NOTIFICATION_RETENTION_MS } from "./retentionPolicy";
import type { NotificationEvent } from "./validators";

// A like taken back or a request withdrawn within this window deletes its row before anyone's phone hears of it.
export const PUSH_GRACE_MS = 30_000;

async function notify(
  ctx: MutationCtx,
  actorId: Id<"profiles">,
  recipientId: Id<"profiles">,
  event: NotificationEvent,
) {
  if (actorId === recipientId) return;
  if (await demoPerson(ctx, actorId)) {
    const recipient = await demoPerson(ctx, recipientId);
    if (!recipient || !isApprovedDemo(recipient.username)) return;
  }
  // Mention notices are worked out again on every write to a post, so the row may already exist; keep the first one.
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_actor_recipient_event", (q) =>
      q.eq("actorId", actorId).eq("recipientId", recipientId).eq("event", event),
    )
    .first();
  if (existing) return;
  const notificationId = await ctx.db.insert("notifications", {
    actorId,
    recipientId,
    event,
    expiresAt: Date.now() + NOTIFICATION_RETENTION_MS,
  });
  const notification = (await ctx.db.get("notifications", notificationId))!;
  await ctx.scheduler.runAt(Math.ceil(notification._creationTime + PUSH_GRACE_MS), internal.push.prepare, {
    notificationId,
  });
}

async function withdraw(
  ctx: MutationCtx,
  actorId: Id<"profiles">,
  recipientId: Id<"profiles">,
  ...events: NotificationEvent[]
) {
  for (const event of events) {
    const row = await ctx.db
      .query("notifications")
      .withIndex("by_actor_recipient_event", (q) =>
        q.eq("actorId", actorId).eq("recipientId", recipientId).eq("event", event),
      )
      .unique();
    if (row) await ctx.db.delete("notifications", row._id);
  }
}

export function registerNotifications(triggers: Triggers<DataModel>) {
  triggers.register("visitLikes", async (ctx, { newDoc, oldDoc, operation }) => {
    if (operation === "update") return;
    const like = newDoc ?? oldDoc!;
    const publication = await ctx.db.get("sharedVisits", like.publicationId);
    if (!publication) return;
    if (newDoc) {
      await notify(ctx, like.profileId, publication.profileId, { kind: "visitLike", publicationId: publication._id });
    } else {
      await withdraw(ctx, like.profileId, publication.profileId, { kind: "visitLike", publicationId: publication._id });
    }
  });

  triggers.register("visitComments", async (ctx, { newDoc, oldDoc, operation }) => {
    if (operation === "update") return;
    const comment = newDoc ?? oldDoc!;
    const publication = await ctx.db.get("sharedVisits", comment.publicationId);
    if (!publication) return;
    if (newDoc) {
      await notify(ctx, comment.profileId, publication.profileId, {
        kind: "visitComment",
        publicationId: publication._id,
        commentId: comment._id,
      });
    } else {
      await withdraw(ctx, comment.profileId, publication.profileId, {
        kind: "visitComment",
        publicationId: publication._id,
        commentId: comment._id,
      });
    }
  });

  // Each person named in a comment hears about it once; the post's author already hears "commented on your visit".
  triggers.register("visitComments", async (ctx, { newDoc, oldDoc, operation }) => {
    if (operation === "update") return;
    const comment = newDoc ?? oldDoc!;
    const event = { kind: "commentMention" as const, publicationId: comment.publicationId, commentId: comment._id };
    if (!newDoc) {
      for (const { profileId } of comment.mentions ?? []) await withdraw(ctx, comment.profileId, profileId, event);
      return;
    }
    const publication = await ctx.db.get("sharedVisits", comment.publicationId);
    if (!publication) return;
    const skip = [comment.profileId, publication.profileId];
    for (const profileId of await mentionRecipients(ctx, comment.mentions, publication, skip)) {
      await notify(ctx, comment.profileId, profileId, event);
    }
  });

  // Every write to a post compares who its notes notify before and after: publishing, editing, an audience change and
  // removal all add or withdraw mention notices without each path knowing about mentions.
  triggers.register("sharedVisits", async (ctx, { id, newDoc, oldDoc }) => {
    if (
      oldDoc
      && newDoc
      && oldDoc.status === newDoc.status
      && oldDoc.removal === newDoc.removal
      && oldDoc.audience === newDoc.audience
      && JSON.stringify(oldDoc.mentions ?? []) === JSON.stringify(newDoc.mentions ?? [])
      && JSON.stringify(oldDoc.companionSelections ?? []) === JSON.stringify(newDoc.companionSelections ?? [])
    ) {
      return;
    }
    const authorId = (newDoc ?? oldDoc)!.profileId;
    const event = { kind: "visitMention" as const, publicationId: id };
    const before = await postMentionRecipients(ctx, oldDoc);
    const after = await postMentionRecipients(ctx, newDoc);
    // A former recipient may have lost access since the notification was sent.
    for (const { profileId } of oldDoc?.mentions ?? []) {
      if (!after.includes(profileId)) await withdraw(ctx, authorId, profileId, event);
    }
    for (const profileId of after) {
      if (!before.includes(profileId)) await notify(ctx, authorId, profileId, event);
    }
  });

  // A row exists while the companion can read the post, so its notification follows the row.
  triggers.register("visitCompanions", async (ctx, { newDoc, oldDoc, operation }) => {
    if (operation === "update") return;
    const row = newDoc ?? oldDoc!;
    const event = { kind: "visitCompanion" as const, publicationId: row.publicationId };
    if (newDoc) await notify(ctx, row.authorId, row.profileId, event);
    else await withdraw(ctx, row.authorId, row.profileId, event);
  });

  // The accepted request stays with the person who accepted it, where it reads "You and … are now friends"; every
  // other friendship notification between the pair is withdrawn when the edge moves, so a later request starts clean.
  triggers.register("friendships", async (ctx, { newDoc, oldDoc }) => {
    const edge = newDoc ?? oldDoc!;
    const was = oldDoc?.state ?? "none";
    const is = newDoc?.state ?? "none";
    if (was === is && oldDoc?.requesterId === newDoc?.requesterId) return;
    const requester = edge.requesterId;
    const other = requester === edge.firstProfileId ? edge.secondProfileId : edge.firstProfileId;
    if (is === "accepted") {
      await withdraw(ctx, other, requester, { kind: "friendRequest" }, { kind: "friendAccepted" });
      await withdraw(ctx, requester, other, { kind: "friendAccepted" });
      await notify(ctx, other, requester, { kind: "friendAccepted" });
      return;
    }
    await withdraw(ctx, requester, other, { kind: "friendRequest" }, { kind: "friendAccepted" });
    await withdraw(ctx, other, requester, { kind: "friendRequest" }, { kind: "friendAccepted" });
    if (is === "pending") await notify(ctx, requester, other, { kind: "friendRequest" });
  });
}
