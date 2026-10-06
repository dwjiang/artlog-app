import { ConvexError, v, type Infer } from "convex/values";

import { groupNotifications, notificationSentence, type NotificationSummary } from "../shared/social/notifications";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { MAX_DEVICES } from "./accounts";
import { internalMutation, mutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { PUSH_GRACE_MS } from "./lib/notifications";
import { reportBackendError } from "./lib/observability";
import { engagement, visibleParticipant } from "./lib/visitReactions";
import { received, resolveNotifications, seenAt, type Notification } from "./notifications";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_MS = 30_000;
// Expo suggests reading receipts about 15 minutes after sending and keeps them for a day.
const RECEIPT_DELAY_MS = 15 * 60_000;
export const LIKE_PUSH_INTERVAL_MS = 60 * 60_000;
const LIKE_SCAN = 100;
const BADGE_SCAN = 100;
const COMMENT_CHARACTERS = 180;
const TOKEN = /^Expo(?:nent)?PushToken\[[\w-]{1,200}\]$/;

type Topic = Infer<typeof topic>;
type Destination = Infer<typeof destination>;
type Message = Infer<typeof message>;
type Ticket = { status: "ok"; id: string } | { status: "error"; details?: { error?: string } };

const message = v.object({
  to: v.string(),
  body: v.string(),
  badge: v.number(),
  url: v.string(),
  collapseId: v.optional(v.string()),
});
const topic = v.union(v.literal("friends"), v.literal("reactions"), v.literal("companions"));
const destination = v.object({
  to: v.string(),
  deviceId: v.id("devices"),
  scopeRevision: v.number(),
});
const deliveryArgs = {
  recipientId: v.id("profiles"),
  topic,
  notificationIds: v.array(v.id("notifications")),
  destinations: v.array(destination),
};
const receipt = v.object({ id: v.string(), token: v.string() });

export const register = mutation({
  args: { token: v.string(), friends: v.boolean(), reactions: v.boolean(), companions: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { token, friends, reactions, companions }) => {
    const device = await requireDevice(ctx);
    if (!TOKEN.test(token)) throw new ConvexError({ code: "invalid_push_token" });
    // A reinstall registers a new device but can keep the old token, which must stop reaching the old device's account.
    for (const row of await tokenRows(ctx, token)) {
      if (row.deviceId !== device._id) await ctx.db.delete("pushTokens", row._id);
    }
    const current = await ctx.db
      .query("pushTokens")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    const fields = { token, friends, reactions, companions };
    if (!current) {
      await ctx.db.insert("pushTokens", { deviceId: device._id, ...fields });
    } else if (
      current.token !== token
      || current.friends !== friends
      || current.reactions !== reactions
      || current.companions !== companions
    ) {
      await ctx.db.patch("pushTokens", current._id, fields);
    }
    return null;
  },
});

/** Turns a notification that survived its grace period into one message per opted-in device of the recipient. */
export const prepare = internalMutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const row = await ctx.db.get("notifications", notificationId);
    const recipient = row && (await ctx.db.get("profiles", row.recipientId));
    if (!row || !recipient?.active) return null;
    const { kind } = row.event;
    const topic =
      kind === "friendRequest" || kind === "friendAccepted"
        ? "friends"
        : kind === "visitCompanion"
          ? "companions"
          : "reactions";
    const tokens = await recipientTokens(ctx, recipient.accountId, topic);
    if (tokens.length === 0) return null;
    const [item] = await resolveNotifications(ctx, recipient, [row], false);
    if (!item) return null;
    const notificationIds =
      row.event.kind === "visitLike"
        ? await likesSinceLastPush(ctx, recipient, row.event.publicationId)
        : [notificationId];
    if (!notificationIds?.length) return null;
    await ctx.scheduler.runAfter(0, internal.push.send, {
      recipientId: recipient._id,
      topic,
      notificationIds,
      destinations: tokens,
      attempt: 1,
    });
    return null;
  },
});

// Queued sends outlive blocks, withdrawals, reads, and sign-out; resolve content and authorization on every attempt.
export const eligibleMessages = internalQuery({
  args: deliveryArgs,
  returns: v.array(message),
  handler: async (ctx, { recipientId, topic, notificationIds, destinations }) => {
    const recipient = await ctx.db.get("profiles", recipientId);
    if (!recipient?.active) return [];
    const rows: Doc<"notifications">[] = [];
    for (const id of notificationIds) {
      const row = await ctx.db.get("notifications", id);
      if (row?.recipientId === recipientId) rows.push(row);
    }
    const content = await compose(ctx, await resolveNotifications(ctx, recipient, rows, false));
    if (!content) return [];
    const badge = await unseenCount(ctx, recipient);
    const eligible: Message[] = [];
    for (const { deviceId, scopeRevision, to } of destinations) {
      const device = await ctx.db.get("devices", deviceId);
      if (
        !device
        || device.banned
        || device.accountId !== recipient.accountId
        || device.scopeRevision !== scopeRevision
      ) {
        continue;
      }
      const token = await ctx.db
        .query("pushTokens")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .unique();
      if (token?.token === to && token[topic]) eligible.push({ to, badge, ...content });
    }
    return eligible;
  },
});

export const send = internalAction({
  args: { ...deliveryArgs, attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { attempt, ...delivery }) => {
    let response: unknown;
    let messages: Message[];
    try {
      messages = await ctx.runQuery(internal.push.eligibleMessages, delivery);
      if (messages.length === 0) return null;
      response = await postJson(
        SEND_URL,
        messages.map(({ url, ...fields }) => ({ ...fields, sound: "default", data: { url } })),
      );
    } catch (error) {
      if (retryable(error) && attempt < MAX_SEND_ATTEMPTS) {
        await ctx.scheduler.runAfter(RETRY_BASE_MS * 2 ** (attempt - 1), internal.push.send, {
          ...delivery,
          attempt: attempt + 1,
        });
      } else {
        await reportBackendError(error, "push.send");
      }
      return null;
    }
    const tickets = (response as { data?: unknown }).data;
    if (!Array.isArray(tickets) || tickets.length !== messages.length) {
      await reportBackendError(new ConvexError({ code: "push_send_failed", reason: "bad_response" }), "push.send");
      return null;
    }
    const outcomes = messages.map((sent, index) => ({ token: sent.to, ticket: tickets[index] as Ticket }));
    const receipts = outcomes.flatMap(({ token, ticket }) =>
      ticket.status === "ok" ? [{ id: ticket.id, token }] : [],
    );
    await settle(ctx, outcomes, "push.send");
    if (receipts.length > 0) await ctx.scheduler.runAfter(RECEIPT_DELAY_MS, internal.push.checkReceipts, { receipts });
    return null;
  },
});

// Apple answers after the ticket, so most unregistered tokens and every credential problem surface only here.
export const checkReceipts = internalAction({
  args: { receipts: v.array(receipt) },
  returns: v.null(),
  handler: async (ctx, { receipts }) => {
    let response: unknown;
    try {
      response = await postJson(RECEIPTS_URL, { ids: receipts.map(({ id }) => id) });
    } catch (error) {
      await reportBackendError(error, "push.receipts");
      return null;
    }
    const data = (response as { data?: Record<string, Ticket | undefined> }).data ?? {};
    const outcomes = receipts.flatMap(({ id, token }) => {
      const ticket = data[id];
      return ticket ? [{ token, ticket }] : [];
    });
    await settle(ctx, outcomes, "push.receipts");
    return null;
  },
});

export const forget = internalMutation({
  args: { tokens: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { tokens }) => {
    for (const token of tokens) {
      for (const row of await tokenRows(ctx, token)) await ctx.db.delete("pushTokens", row._id);
    }
    return null;
  },
});

function tokenRows(ctx: QueryCtx, token: string) {
  return ctx.db
    .query("pushTokens")
    .withIndex("by_token", (q) => q.eq("token", token))
    .take(MAX_DEVICES);
}

async function recipientTokens(ctx: QueryCtx, accountId: Id<"accounts">, topic: Topic): Promise<Destination[]> {
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .take(MAX_DEVICES);
  const tokens: Destination[] = [];
  for (const device of devices) {
    if (device.banned) continue;
    const row = await ctx.db
      .query("pushTokens")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    if (row?.[topic]) tokens.push({ to: row.token, deviceId: device._id, scopeRevision: device.scopeRevision });
  }
  return tokens;
}

async function compose(
  ctx: QueryCtx,
  items: Notification[],
): Promise<Pick<Message, "body" | "url" | "collapseId"> | null> {
  const [item] = items;
  if (!item) return null;
  const { actor } = item;
  const text = (summary: NotificationSummary) =>
    notificationSentence(summary)
      .map((segment) => segment.text)
      .join("");
  switch (item.kind) {
    case "friendRequest":
      // Accepted within the grace period: the inbox now reads "You and … are now friends", which is no news to them.
      if (item.relationship.state !== "pending") return null;
      return { body: text({ kind: item.kind, actor, accepted: false }), url: `/profile/${item.actor.profileId}` };
    case "friendAccepted":
      return { body: text({ kind: item.kind, actor }), url: `/profile/${item.actor.profileId}` };
    case "visitComment":
      return {
        body: `${text({ kind: item.kind, actor, venue: item.venue })} “${truncate(item.body, COMMENT_CHARACTERS)}”`,
        url: `/visit/${encodeURIComponent(item.postId)}?comments=1`,
      };
    case "visitCompanion":
      return {
        body: text({ kind: item.kind, actor, venue: item.venue }),
        url: `/visit/${encodeURIComponent(item.postId)}`,
      };
    case "visitLike": {
      const publication = await ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", item.postId))
        .unique();
      if (!publication) return null;
      return {
        body: text({
          kind: item.kind,
          people: items.slice(0, 2).map(({ actor }) => actor),
          count: items.length,
          venue: item.venue,
        }),
        url: `/visit/${encodeURIComponent(item.postId)}`,
        collapseId: `like:${publication._id}`,
      };
    }
  }
}

/** At most one like push per visit an hour; the next one counts every like since, newest liker first. */
async function likesSinceLastPush(ctx: MutationCtx, recipient: Doc<"profiles">, publicationId: Id<"sharedVisits">) {
  const counts = await engagement(ctx, publicationId);
  const now = Date.now();
  const pushedAt = counts?.likePushedAt;
  if (pushedAt !== undefined && now - pushedAt < LIKE_PUSH_INTERVAL_MS) return null;
  // Each batch stops at the grace cutoff; newer likes remain eligible for the next batch.
  const since = pushedAt === undefined ? 0 : pushedAt - PUSH_GRACE_MS;
  const through = now - PUSH_GRACE_MS;
  const likes = await ctx.db
    .query("visitLikes")
    .withIndex("by_publication", (q) =>
      q.eq("publicationId", publicationId).gt("_creationTime", since).lte("_creationTime", through),
    )
    .order("desc")
    .take(LIKE_SCAN);
  const notificationIds: Id<"notifications">[] = [];
  for (const like of likes) {
    if (like.profileId === recipient._id) continue;
    const person = await visibleParticipant(ctx, like.profileId, [recipient._id]);
    if (!person) continue;
    const row = await ctx.db
      .query("notifications")
      .withIndex("by_actor_recipient_event", (q) =>
        q
          .eq("actorId", like.profileId)
          .eq("recipientId", recipient._id)
          .eq("event", { kind: "visitLike", publicationId }),
      )
      .unique();
    if (row) notificationIds.push(row._id);
  }
  if (notificationIds.length === 0) return null;
  if (counts) await ctx.db.patch("visitEngagement", counts._id, { likePushedAt: now });
  return notificationIds;
}

// Matches the bell on Home, where likes on one visit count once.
async function unseenCount(ctx: QueryCtx, recipient: Doc<"profiles">) {
  const rows = await received(ctx, recipient._id, await seenAt(ctx, recipient._id)).take(BADGE_SCAN);
  return groupNotifications(await resolveNotifications(ctx, recipient, rows, false)).length;
}

function truncate(text: string, limit: number) {
  const characters = Array.from(text.trim());
  return characters.length <= limit ? characters.join("") : `${characters.slice(0, limit - 1).join("")}…`;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "network";
    throw new ConvexError({ code: "push_send_failed", reason });
  }
  if (!response.ok) throw new ConvexError({ code: "push_send_failed", reason: `http_${response.status}` });
  try {
    return await response.json();
  } catch {
    throw new ConvexError({ code: "push_send_failed", reason: "bad_json" });
  }
}

function retryable(error: unknown) {
  const reason = error instanceof ConvexError ? (error.data as { reason?: string }).reason : undefined;
  return reason === "network" || reason === "timeout" || reason === "http_429" || /^http_5\d\d$/.test(reason ?? "");
}

const failureCodes: Record<string, string> = {
  InvalidCredentials: "push_invalid_credentials",
  MessageTooBig: "push_message_too_big",
  MessageRateExceeded: "push_rate_exceeded",
};

async function settle(ctx: ActionCtx, outcomes: { token: string; ticket: Ticket }[], operation: string) {
  const gone: string[] = [];
  const failures = new Set<string>();
  for (const { token, ticket } of outcomes) {
    if (ticket.status !== "error") continue;
    const error = ticket.details?.error;
    if (error === "DeviceNotRegistered") gone.push(token);
    else failures.add((error && failureCodes[error]) ?? "push_rejected");
  }
  if (gone.length > 0) await ctx.runMutation(internal.push.forget, { tokens: gone });
  for (const code of failures) await reportBackendError(new ConvexError({ code }), operation);
}
