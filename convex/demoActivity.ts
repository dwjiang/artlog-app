import tzLookup from "@photostructure/tz-lookup";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { ConvexError, type Infer, v } from "convex/values";

import { calendarDate, isUuid, LIMITS } from "../shared/journal/limits";
import { extractMentions } from "../shared/social/mentions";
import { MAX_COMMENT_LENGTH } from "../shared/social/visit-reactions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  addDemoSave,
  demoAccountRange,
  demoPerson,
  demoProfile,
  insertDemoPost,
  isUsableObject,
  readableBy,
  usableObject,
  venueByKey,
} from "./lib/demoAccounts";
import { requireDemoBot } from "./lib/demoBot";
import { requireDemoPhoto } from "./lib/demoPhotos";
import { acceptedRelationships } from "./lib/friendships";
import { upsertJournalVisit } from "./lib/journal";
import { resolveMentions } from "./lib/mentions";
import { flaggedUserTexts } from "./lib/moderation";
import { PICKS_PER_MUSEUM } from "./lib/museumPicks";
import { readObjectDetails } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { limitKey, type RateLimitName } from "./lib/rateLimits";
import { publicationItems, publicationRecordTitles } from "./lib/sharedPublications";
import { insertVisitComment, insertVisitLike } from "./lib/visitReactions";
import schema from "./schema";

// The demo bot's API. artlog-bot's docs/artlog-integration.md owns the contract; these validators are its types.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CONTEXT_WINDOW_MS = 30 * DAY_MS;
const MAX_CHARACTERS = 200;
const MAX_CONTEXT_POSTS = 100;
// Withdrawn and private posts are skipped, so the merged feed stops after twice the page.
const CONTEXT_POST_SCAN = 2 * MAX_CONTEXT_POSTS;
const MAX_CONTEXT_LIKES = 50;
const MAX_CONTEXT_COMMENTS = 20;
// Real people's reactions on public demo posts are skipped, so each post's scans stop here.
const LIKE_SCAN = 100;
const COMMENT_SCAN = 50;
const VISIT_LOOKBACK_MS = 14 * DAY_MS;
const MAX_VISIT_MS = 12 * HOUR_MS;
const MAX_POST_ARTWORKS = 6;
const MAX_ARTWORK_PHOTOS = 3;
const DEFAULT_VENUE_ARTWORKS = 20;
const MAX_VENUE_ARTWORKS = 50;
const ALL_DEMO_ACCOUNTS = "all";

const audience = v.union(v.literal("public"), v.literal("friends"));
const venueRef = v.object({ key: v.string(), name: v.string() });
const contextPost = v.object({
  postId: v.string(),
  author: v.string(),
  audience,
  venue: venueRef,
  visitedOn: v.string(),
  publishedAt: v.number(),
  reflection: v.string(),
  artworks: v.array(v.object({ objectKey: v.string(), title: v.string(), artist: v.string() })),
  likes: v.array(v.string()),
  comments: v.array(
    v.object({ submissionId: v.string(), author: v.string(), body: v.string(), createdAt: v.number() }),
  ),
});
const postActivity = v.object({
  kind: v.literal("post"),
  submissionId: v.string(),
  author: v.string(),
  venueKey: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  audience,
  reflection: v.string(),
  artworks: v.array(
    v.object({ objectKey: v.string(), note: v.optional(v.string()), photoIds: v.array(v.id("files")) }),
  ),
});
const commentActivity = v.object({
  kind: v.literal("comment"),
  submissionId: v.string(),
  author: v.string(),
  postId: v.string(),
  body: v.string(),
});
const likeActivity = v.object({ kind: v.literal("like"), author: v.string(), postId: v.string() });
const receipt = v.object({
  status: v.union(v.literal("created"), v.literal("unchanged")),
  postId: v.string(),
  commentId: v.optional(v.id("visitComments")),
});
const prepared = v.object({ receipt: v.optional(receipt), titles: v.array(v.string()) });
type PostActivity = Infer<typeof postActivity>;
type CommentActivity = Infer<typeof commentActivity>;
type Receipt = Infer<typeof receipt>;

const invalidActivity = (field: string) => new ConvexError({ code: "invalid_activity", field });

export const getContext = query({
  args: { since: v.number() },
  returns: v.object({
    characters: v.array(
      v.object({
        username: v.string(),
        name: v.string(),
        bio: v.optional(v.string()),
        avatar: v.optional(v.string()),
        friends: v.array(v.string()),
      }),
    ),
    posts: v.array(contextPost),
  }),
  handler: async (ctx, { since }) => {
    await requireDemoBot(ctx);
    if (!(since >= Date.now() - CONTEXT_WINDOW_MS)) throw invalidActivity("since");
    const people: Doc<"profiles">[] = [];
    for (const account of await demoAccountRange(ctx).take(MAX_CHARACTERS)) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
        .unique();
      if (profile?.active && !profile.removal) people.push(profile);
    }
    const usernames = new Map(people.map((profile) => [profile._id, profile.username]));
    const characters = [];
    for (const profile of people) {
      const friends = (await acceptedRelationships(ctx, profile._id)).flatMap(
        (edge) => usernames.get(edge.firstProfileId === profile._id ? edge.secondProfileId : edge.firstProfileId) ?? [],
      );
      characters.push({
        username: profile.username,
        name: profile.name,
        bio: profile.bio,
        avatar: profile.avatar,
        friends,
      });
    }
    // mergedStream rejects an empty list, which a deployment without demo accounts would pass.
    const newest =
      people.length === 0
        ? []
        : await mergedStream(
            people.map((profile) =>
              stream(ctx.db, schema)
                .query("sharedVisits")
                .withIndex("by_profile_publishedAt", (q) => q.eq("profileId", profile._id).gte("publishedAt", since))
                .order("desc"),
            ),
            ["publishedAt", "_creationTime"],
          ).take(CONTEXT_POST_SCAN);
    const posts = [];
    for (const post of newest) {
      if (posts.length === MAX_CONTEXT_POSTS) break;
      const projected = await projectContextPost(ctx, post, usernames);
      if (projected) posts.push(projected);
    }
    return { characters, posts };
  },
});

async function projectContextPost(
  ctx: QueryCtx,
  post: Doc<"sharedVisits">,
  usernames: Map<Id<"profiles">, string>,
): Promise<Infer<typeof contextPost> | null> {
  const author = usernames.get(post.profileId);
  const visit = await ctx.db.get("visits", post.visitId);
  const venue = visit && (await ctx.db.get("museums", visit.venueId));
  if (!author || post.status !== "active" || post.removal || post.audience === "private" || !venue) return null;
  const artworks = [];
  for (const item of await ctx.db
    .query("sharedVisitItems")
    .withIndex("by_publication_position", (q) => q.eq("publicationId", post._id))
    .take(MAX_POST_ARTWORKS)) {
    const save = await ctx.db.get("collections", item.saveId);
    const object = save?.objectId && save.deletedAt === undefined ? await ctx.db.get("objects", save.objectId) : null;
    if (save && object) {
      artworks.push({ objectKey: object.key, title: save.snapshot.title, artist: save.snapshot.artist });
    }
  }
  const likes = [];
  for (const like of await ctx.db
    .query("visitLikes")
    .withIndex("by_publication", (q) => q.eq("publicationId", post._id))
    .order("desc")
    .take(LIKE_SCAN)) {
    const username = usernames.get(like.profileId);
    if (username && likes.length < MAX_CONTEXT_LIKES) likes.push(username);
  }
  const comments = [];
  for (const comment of await ctx.db
    .query("visitComments")
    .withIndex("by_publication", (q) => q.eq("publicationId", post._id))
    .order("desc")
    .take(COMMENT_SCAN)) {
    const username = usernames.get(comment.profileId);
    if (username && comments.length < MAX_CONTEXT_COMMENTS) {
      comments.push({
        submissionId: comment.requestId,
        author: username,
        body: comment.body,
        createdAt: comment._creationTime,
      });
    }
  }
  return {
    postId: post.postId,
    author,
    audience: post.audience,
    venue: { key: venue.key, name: venue.name },
    visitedOn: post.visitedOn,
    publishedAt: post.publishedAt,
    reflection: post.reflection,
    artworks,
    likes,
    // The newest comments, read in the order they were written.
    comments: comments.reverse(),
  };
}

export const listVenueArtworks = query({
  args: { venueKey: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    venue: v.object({
      key: v.string(),
      name: v.string(),
      city: v.optional(v.string()),
      country: v.optional(v.string()),
      timeZone: v.string(),
    }),
    artworks: v.array(
      v.object({
        objectKey: v.string(),
        title: v.string(),
        artist: v.string(),
        date: v.optional(v.string()),
        medium: v.optional(v.string()),
        gallery: v.optional(v.string()),
        thumbnailUrl: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, { venueKey, limit = DEFAULT_VENUE_ARTWORKS }) => {
    await requireDemoBot(ctx);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_VENUE_ARTWORKS) throw invalidActivity("limit");
    const venue = await venueByKey(ctx, venueKey);
    if (!venue) throw new ConvexError({ code: "invalid_venue", venueKey });
    const picks = await ctx.db
      .query("museumPicks")
      .withIndex("by_venue_score", (q) => q.eq("venueId", venue._id))
      .order("desc")
      .take(PICKS_PER_MUSEUM);
    const artworks = [];
    for (const pick of picks) {
      if (artworks.length === limit) break;
      const artwork = await onViewArtwork(ctx, venue, pick.objectId);
      if (artwork) artworks.push(artwork);
    }
    return {
      venue: {
        key: venue.key,
        name: venue.name,
        city: venue.city,
        country: venue.country,
        timeZone: tzLookup(venue.lat, venue.lng),
      },
      artworks,
    };
  },
});

async function onViewArtwork(ctx: QueryCtx, venue: Doc<"museums">, objectId: Id<"objects">) {
  const object = await ctx.db.get("objects", objectId);
  // A post accepts only works the venue owns, so loans on view there are left out.
  if (!object || !isUsableObject(object) || object.ownerId !== venue._id) return null;
  const artwork = await ctx.db.get("artworks", object.artworkId);
  const placement = (
    await ctx.db
      .query("placements")
      .withIndex("by_objectId", (q) => q.eq("objectId", object._id))
      .take(20)
  ).find(
    (row) =>
      row.venueId === venue._id && row.closedAt === undefined && row.onView && row.identityStatus === "established",
  );
  if (!artwork || artwork.retiredAt !== undefined || !placement) return null;
  const details = await readObjectDetails(ctx, object);
  return {
    objectKey: object.key,
    title: artwork.title,
    artist: artwork.artist,
    date: artwork.date,
    medium: details?.medium,
    gallery: placement.gallery,
    thumbnailUrl: artwork.rightsStatus === "public_domain" ? details?.thumbnailUrl : undefined,
  };
}

export const publish = action({
  args: { activity: v.union(postActivity, commentActivity, likeActivity) },
  returns: receipt,
  handler: (ctx, { activity }): Promise<Receipt> =>
    withErrorReporting("demoActivity.publish", async () => {
      await requireDemoBot(ctx);
      if (activity.kind === "like") return ctx.runMutation(internal.demoActivity.like, activity);
      if (activity.kind === "comment") {
        const { receipt, titles } = await ctx.runMutation(internal.demoActivity.prepareComment, activity);
        if (receipt) return receipt;
        const [flagged] = await flaggedUserTexts([activity.body], titles);
        if (flagged) throw new ConvexError({ code: "comment_not_allowed" });
        return ctx.runMutation(internal.demoActivity.insertComment, activity);
      }
      const { receipt, titles } = await ctx.runMutation(internal.demoActivity.preparePost, activity);
      if (receipt) return receipt;
      const [reflection, ...notes] = await flaggedUserTexts(
        [activity.reflection, ...activity.artworks.map((artwork) => artwork.note ?? "")],
        titles,
      );
      if (reflection) throw new ConvexError({ code: "reflection_not_allowed" });
      if (notes.some(Boolean)) throw new ConvexError({ code: "note_not_allowed" });
      return ctx.runMutation(internal.demoActivity.insertPost, activity);
    }),
});

// Prepare commits the quota before moderation, so rejected text also consumes it. Insert reads the request again in
// the writing transaction, where a concurrent duplicate either commits first or conflicts and retries.
export const preparePost = internalMutation({
  args: postActivity.fields,
  returns: prepared,
  handler: async (ctx, post) => {
    const request = await readPostRequest(ctx, post);
    if (request.receipt) return { receipt: request.receipt, titles: [] };
    await limitDemoActivity(ctx, "publishVisit", request.profile.accountId);
    return { titles: request.artworks.map((artwork) => artwork.title) };
  },
});
export const insertPost = internalMutation({
  args: postActivity.fields,
  returns: receipt,
  handler: async (ctx, post) => {
    const request = await readPostRequest(ctx, post);
    if (request.receipt) return request.receipt;
    const { profile, venue, reflection, artworks } = request;
    const owner = { kind: "account" as const, accountId: profile.accountId };
    const device = await ctx.db
      .query("devices")
      .withIndex("by_accountId", (q) => q.eq("accountId", profile.accountId))
      .first();
    if (!device) throw new ConvexError({ code: "not_found", username: post.author });
    const timeZone = tzLookup(venue.lat, venue.lng);
    const visit = await upsertJournalVisit(ctx, owner, device._id, {
      visibility: post.audience,
      localId: crypto.randomUUID(),
      venueId: venue._id,
      visitedOn: calendarDate(post.startedAt, timeZone),
      timeZone,
      startedAt: post.startedAt,
      endedAt: post.endedAt,
      reflection,
    });
    // Saves spread evenly through the visit, and each save's photos fall in the half step before it.
    const step = (post.endedAt - post.startedAt) / (post.artworks.length + 1);
    const saves = [];
    for (const [index, artwork] of post.artworks.entries()) {
      const savedAt = Math.round(post.startedAt + step * (index + 1));
      const { photos } = artworks[index];
      saves.push(
        await addDemoSave(ctx, owner, device._id, visit, venue, {
          localId: crypto.randomUUID(),
          objectKey: artwork.objectKey,
          savedAt,
          note: demoNote(artwork.note),
          photos: photos.map((photo, order) => ({
            localId: crypto.randomUUID(),
            storageId: photo.fileId,
            width: photo.width,
            height: photo.height,
            capturedAt: Math.round(savedAt - ((step / 2) * (photos.length - order)) / photos.length),
          })),
        }),
      );
      for (const photo of photos) await ctx.db.delete("demoPhotos", photo._id);
    }
    await insertDemoPost(ctx, {
      profileId: profile._id,
      visit,
      saves,
      postId: post.submissionId,
      publishedAt: Date.now(),
    });
    return { status: "created" as const, postId: post.submissionId };
  },
});

async function readPostRequest(ctx: QueryCtx, post: PostActivity) {
  if (!isUuid(post.submissionId)) throw invalidActivity("submissionId");
  const profile = await demoProfile(ctx, post.author);
  const existing = await ctx.db
    .query("sharedVisits")
    .withIndex("by_postId", (q) => q.eq("postId", post.submissionId))
    .unique();
  if (existing) {
    if (!(await isSamePost(ctx, existing, profile._id, post))) {
      throw new ConvexError({ code: "conflict", submissionId: post.submissionId });
    }
    return { receipt: { status: "unchanged" as const, postId: existing.postId } };
  }
  const now = Date.now();
  if (
    !Number.isSafeInteger(post.startedAt)
    || !Number.isSafeInteger(post.endedAt)
    || post.startedAt < now - VISIT_LOOKBACK_MS
    || post.endedAt <= post.startedAt
    || post.endedAt > now
    || post.endedAt - post.startedAt > MAX_VISIT_MS
  ) {
    throw invalidActivity("visit");
  }
  const reflection = post.reflection.trim();
  if (!reflection || reflection.length > LIMITS.note) throw invalidActivity("reflection");
  const photoIds = post.artworks.flatMap((artwork) => artwork.photoIds);
  if (
    post.artworks.length === 0
    || post.artworks.length > MAX_POST_ARTWORKS
    || new Set(post.artworks.map((artwork) => artwork.objectKey)).size !== post.artworks.length
    || post.artworks.some(
      (artwork) =>
        artwork.photoIds.length === 0
        || artwork.photoIds.length > MAX_ARTWORK_PHOTOS
        || (artwork.note?.length ?? 0) > LIMITS.note,
    )
    || new Set(photoIds).size !== photoIds.length
  ) {
    throw invalidActivity("artworks");
  }
  const venue = await venueByKey(ctx, post.venueKey);
  if (!venue) throw new ConvexError({ code: "invalid_venue", venueKey: post.venueKey });
  const artworks = [];
  for (const { objectKey, photoIds } of post.artworks) {
    const object = await usableObject(ctx, objectKey);
    const artwork = object?.ownerId === venue._id ? await ctx.db.get("artworks", object.artworkId) : null;
    if (!artwork) throw new ConvexError({ code: "invalid_object", objectKey });
    const photos = [];
    for (const id of photoIds) photos.push(await requireDemoPhoto(ctx, id));
    artworks.push({ title: artwork.title, photos });
  }
  await requireDemoMentions(ctx, [reflection, ...post.artworks.map((artwork) => artwork.note ?? "")]);
  return { profile, venue, reflection, artworks };
}

const demoNote = (note: string | undefined) => note?.trim() || undefined;

// Photo IDs are left out: a retry after the upload lease ran out sends the same post with new uploads.
async function isSamePost(ctx: QueryCtx, existing: Doc<"sharedVisits">, authorId: Id<"profiles">, post: PostActivity) {
  const visit = await ctx.db.get("visits", existing.visitId);
  const venue = visit && (await ctx.db.get("museums", visit.venueId));
  const artworks = [];
  for (const item of await publicationItems(ctx, existing._id)) {
    const save = await ctx.db.get("collections", item.saveId);
    const object = save?.objectId ? await ctx.db.get("objects", save.objectId) : null;
    artworks.push({ objectKey: object?.key, note: save?.note });
  }
  const stored = {
    authorId: existing.profileId,
    venueKey: venue?.key,
    startedAt: visit?.startedAt,
    endedAt: visit?.endedAt,
    audience: existing.audience,
    reflection: existing.reflection,
    artworks,
  };
  const submitted = {
    authorId,
    venueKey: post.venueKey,
    startedAt: post.startedAt,
    endedAt: post.endedAt,
    audience: post.audience,
    reflection: post.reflection.trim(),
    artworks: post.artworks.map((artwork) => ({ objectKey: artwork.objectKey, note: demoNote(artwork.note) })),
  };
  return JSON.stringify(stored) === JSON.stringify(submitted);
}

export const prepareComment = internalMutation({
  args: commentActivity.fields,
  returns: prepared,
  handler: async (ctx, comment) => {
    const request = await readCommentRequest(ctx, comment);
    if (request.receipt) return { receipt: request.receipt, titles: [] };
    await limitDemoActivity(ctx, "commentVisit", request.profile.accountId);
    return { titles: await publicationRecordTitles(ctx, request.publication._id) };
  },
});
export const insertComment = internalMutation({
  args: commentActivity.fields,
  returns: receipt,
  handler: async (ctx, comment) => {
    const request = await readCommentRequest(ctx, comment);
    if (request.receipt) return request.receipt;
    const { profile, publication, body } = request;
    const commentId = await insertVisitComment(ctx, {
      publicationId: publication._id,
      profileId: profile._id,
      body,
      requestId: comment.submissionId,
      mentions: await resolveMentions(ctx, body, profile._id),
    });
    return { status: "created" as const, postId: publication.postId, commentId };
  },
});

async function readCommentRequest(ctx: QueryCtx, comment: CommentActivity) {
  if (!isUuid(comment.submissionId)) throw invalidActivity("submissionId");
  const body = comment.body.trim();
  if (!body || body.length > MAX_COMMENT_LENGTH) throw new ConvexError({ code: "invalid_comment" });
  const { profile, publication } = await demoPost(ctx, comment.author, comment.postId);
  const existing = await ctx.db
    .query("visitComments")
    .withIndex("by_requestId", (q) => q.eq("requestId", comment.submissionId))
    .first();
  if (existing) {
    if (existing.profileId !== profile._id || existing.publicationId !== publication._id || existing.body !== body) {
      throw new ConvexError({ code: "conflict", submissionId: comment.submissionId });
    }
    return { receipt: { status: "unchanged" as const, postId: publication.postId, commentId: existing._id } };
  }
  await requireDemoMentions(ctx, [body]);
  return { profile, publication, body };
}

export const like = internalMutation({
  args: likeActivity.fields,
  returns: receipt,
  handler: async (ctx, activity) => {
    const { profile, publication } = await demoPost(ctx, activity.author, activity.postId);
    const existing = await ctx.db
      .query("visitLikes")
      .withIndex("by_publication_profile", (q) => q.eq("publicationId", publication._id).eq("profileId", profile._id))
      .unique();
    if (existing) return { status: "unchanged" as const, postId: publication.postId };
    await limitDemoActivity(ctx, "likeVisit", profile.accountId);
    await insertVisitLike(ctx, publication._id, profile._id);
    return { status: "created" as const, postId: publication.postId };
  },
});

export const registerPhoto = internalMutation({
  args: { photoId: v.id("files"), width: v.number(), height: v.number() },
  returns: v.null(),
  handler: async (ctx, { photoId, width, height }) => {
    await ctx.db.insert("demoPhotos", { fileId: photoId, width, height });
    return null;
  },
});

/** A post a demo account may react to: a demo account's, and readable by the reacting one. */
async function demoPost(ctx: QueryCtx, username: string, postId: string) {
  const { profile, publication, author } = await readableBy(ctx, username, postId);
  if (!(await demoPerson(ctx, author._id))) throw new ConvexError({ code: "not_found", username, postId });
  return { profile, publication };
}

// Mention notices go to everyone named, so naming anyone but a demo account would reach a real person.
async function requireDemoMentions(ctx: QueryCtx, texts: string[]) {
  for (const username of new Set(texts.flatMap(extractMentions))) {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (!profile || !(await demoPerson(ctx, profile._id))) {
      throw new ConvexError({ code: "invalid_mention", username });
    }
  }
}

async function limitDemoActivity(ctx: MutationCtx, name: RateLimitName, accountId: Id<"accounts">) {
  await limitKey(ctx, name, accountId);
  await limitKey(ctx, "demoActivity", ALL_DEMO_ACCOUNTS);
}
