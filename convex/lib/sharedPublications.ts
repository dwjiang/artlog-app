import type { IndexRange } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";

import { pagination, type JournalOwner } from "../../shared/journal/contracts";
import { isCalendarDate, isRevision, isUuid, LIMITS, utf8Bytes } from "../../shared/journal/limits";
import {
  mention,
  visitAudience,
  publicProfile,
  sharedVisitCard,
  sharedPhotoSelection,
  type sharedSelection,
  validateSelection,
  wallPattern,
} from "../../shared/social/contracts";
import { DEFAULT_WALL_COLOR } from "../../shared/wall/defaults";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ownedAlbumPhoto, selectedPhotoMedia } from "./albumMedia";
import { resolveDisplayAsset } from "./displayMedia";
import { linkedMentions } from "./mentions";
import { findOwnedVisit, requireMembership, requireOwnedSave } from "./ownership";
import { matchesRecord, projectProfile, projectSharedVisitCard, recordTitles } from "./projections";
import { visibleCompanions } from "./visitCompanions";

export const publicationHeader = v.object({
  audience: visitAudience,
  postId: v.string(),
  author: publicProfile,
  venue: v.object({
    venueId: v.id("museums"),
    name: v.string(),
    city: v.optional(v.string()),
  }),
  artworkCount: v.optional(v.number()),
  visitedOn: v.string(),
  reflection: v.string(),
  publishedAt: v.number(),
  revision: v.number(),
  color: v.string(),
  pattern: v.optional(wallPattern),
  /** Friends the author went with, as this viewer may see them. */
  companions: v.array(publicProfile),
  /** The handles in `reflection` that open a profile for this viewer. */
  mentions: v.array(mention),
});
export const artworkPage = v.object({
  page: v.array(sharedVisitCard),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});
export const publicationView = v.object({
  ...publicationHeader.fields,
  artworks: artworkPage,
});
export const publicationState = v.object({
  audience: visitAudience,
  postId: v.union(v.string(), v.null()),
  status: v.union(v.literal("private"), v.literal("active")),
  photoSelections: v.optional(v.array(sharedPhotoSelection)),
  removed: v.boolean(),
  reflection: v.string(),
  saveLocalIds: v.array(v.string()),
  revision: v.number(),
  /** The published wallpaper; absent until the visit is first posted. */
  color: v.optional(v.string()),
  pattern: v.optional(wallPattern),
  companions: v.array(publicProfile),
});
export const PAGE_BYTES = 2 * 1024 * 1024;
export const PAGE_ARTWORKS = 50;
// Reserve for one more maximum-size save plus its media rows, so publishing stops before the read limit.
export const SAVE_READ_RESERVE = 1.1 * 1024 * 1024;

export async function readHeadroom(ctx: QueryCtx, reserve = 6 * 1024 * 1024) {
  const metrics = await ctx.meta.getTransactionMetrics();
  return metrics.bytesRead.remaining > reserve && metrics.databaseQueries.remaining > 100;
}
export function publicationForVisit(ctx: QueryCtx, profileId: Id<"profiles">, visitLocalId: string) {
  return ctx.db
    .query("sharedVisits")
    .withIndex("by_profile_visit", (q) => q.eq("profileId", profileId).eq("visitLocalId", visitLocalId))
    .unique();
}
export async function ownedVisit(ctx: QueryCtx, owner: JournalOwner, localId: string) {
  if (!isUuid(localId)) throw new ConvexError({ code: "not_found" });
  const visit = await findOwnedVisit(ctx, owner, localId);
  if (!visit || visit.deletedAt !== undefined) throw new ConvexError({ code: "not_found" });
  return visit;
}
export async function selectedSaves(
  ctx: QueryCtx,
  owner: JournalOwner,
  input: Infer<typeof sharedSelection> & { visitLocalId: string },
) {
  validateSelection(input);
  const visit = await ownedVisit(ctx, owner, input.visitLocalId);
  if (input.reflection !== (visit.reflection ?? "")) {
    throw new ConvexError({ code: "conflict" });
  }
  const saves = [];
  for (const localId of input.saveLocalIds) {
    if (!(await readHeadroom(ctx, SAVE_READ_RESERVE))) {
      throw new ConvexError({ code: "invalid_post" });
    }
    const save = await requireOwnedSave(ctx, owner, localId);
    await requireMembership(ctx, save, visit);
    for (const id of input.photoSelections?.find((row) => row.saveLocalId === localId)?.photoLocalIds ?? []) {
      await ownedAlbumPhoto(ctx, save, id);
    }
    saves.push(save);
  }
  return { visit, saves };
}
export function publicationItems(ctx: QueryCtx, publicationId: Id<"sharedVisits">) {
  return ctx.db
    .query("sharedVisitItems")
    .withIndex("by_publication_position", (q) => q.eq("publicationId", publicationId))
    .take(LIMITS.selectedSaves + 1);
}
/** The catalog titles of a post's works, which moderation reads as "the artwork". */
export async function publicationRecordTitles(ctx: QueryCtx, publicationId: Id<"sharedVisits">) {
  const saves = [];
  for (const item of await publicationItems(ctx, publicationId)) {
    const save = await ctx.db.get("collections", item.saveId);
    if (save) saves.push(save);
  }
  return recordTitles(ctx, saves);
}
export async function header(
  ctx: QueryCtx,
  publication: Doc<"sharedVisits">,
  profile: Doc<"profiles">,
  visit: Doc<"visits">,
  viewerId: Id<"profiles"> | undefined,
  artworkCount: number,
): Promise<Infer<typeof publicationHeader>> {
  const venue = await ctx.db.get("museums", visit.venueId);
  return {
    audience: publication.audience,
    artworkCount,
    postId: publication.postId,
    author: await projectProfile(ctx, profile),
    venue: {
      venueId: visit.venueId,
      name: visit.venueName,
      ...(venue?.city ? { city: venue.city } : {}),
    },
    visitedOn: publication.visitedOn,
    reflection: publication.reflection,
    publishedAt: publication.publishedAt,
    revision: publication.publicationRevision,
    ...publicationWallpaper(publication),
    companions: await visibleCompanions(ctx, publication, viewerId),
    mentions: await linkedMentions(ctx, publication.mentions, {
      viewerId,
      writerId: publication.profileId,
      post: publication,
    }),
  };
}
function publicationWallpaper({ color, pattern }: Doc<"sharedVisits">) {
  return { color: color ?? DEFAULT_WALL_COLOR, ...(pattern ? { pattern } : {}) };
}
export async function stateForPublication(
  ctx: QueryCtx,
  publication: Doc<"sharedVisits"> | null,
  visit: Doc<"visits">,
): Promise<Infer<typeof publicationState>> {
  const items = publication ? await publicationItems(ctx, publication._id) : [];
  return {
    audience: visit.visibility,
    photoSelections: items
      .filter((item) => item.photoLocalIds?.length)
      .map((item) => ({
        saveLocalId: item.saveLocalId,
        photoLocalIds: item.photoLocalIds!,
      })),
    postId: publication?.postId ?? null,
    status: publication?.status ?? "private",
    removed: !!publication?.removal,
    reflection: visit.reflection ?? "",
    revision: publication?.publicationRevision ?? 0,
    saveLocalIds: items.map((item) => item.saveLocalId),
    ...(publication ? publicationWallpaper(publication) : {}),
    companions: publication ? await visibleCompanions(ctx, publication, publication.profileId) : [],
  };
}
export function checkPublicationRevision(observed: number, current: number) {
  if (!isRevision(observed)) throw new ConvexError({ code: "invalid_post" });
  if (observed !== current) throw new ConvexError({ code: "conflict" });
}

function artworkCursor(publication: Doc<"sharedVisits">, position: number) {
  return JSON.stringify({
    kind: "artworks",
    postId: publication.postId,
    revision: publication.publicationRevision,
    position,
  });
}
function artworkPosition(publication: Doc<"sharedVisits">, cursor?: string | null): number {
  if (!cursor) return -1;
  try {
    const value = JSON.parse(cursor);
    if (
      Object.keys(value).sort().join(",") !== "kind,position,postId,revision"
      || value.kind !== "artworks"
      || value.postId !== publication.postId
      || !isRevision(value.revision)
      || !isRevision(value.position)
      || value.position >= LIMITS.selectedSaves
    ) {
      throw Error();
    }
    if (value.revision !== publication.publicationRevision) {
      throw new ConvexError({ code: "conflict" });
    }
    return value.position;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({ code: "invalid_pagination" });
  }
}
export async function projectArtworkPage(
  ctx: QueryCtx,
  publication: Doc<"sharedVisits">,
  visit: Doc<"visits">,
  input: { cursor?: string | null; limit?: number; highlightsOnly?: boolean },
  publicationSelection?: Doc<"sharedVisitItems">[],
): Promise<Infer<typeof artworkPage>> {
  const { numItems } = pagination(input);
  const start = artworkPosition(publication, input.cursor);
  const items = publicationSelection
    ? publicationSelection.filter((item) => item.position > start)
    : await ctx.db
        .query("sharedVisitItems")
        .withIndex("by_publication_position", (q) => q.eq("publicationId", publication._id).gt("position", start))
        .take(LIMITS.selectedSaves + 1);
  const page: Infer<typeof sharedVisitCard>[] = [];
  let position = start;
  let consumed = 0;
  let bytes = 0;
  for (const item of items) {
    if (page.length >= numItems || !(await readHeadroom(ctx))) break;
    const save = await ctx.db.get("collections", item.saveId);
    if (
      save
      && save.deletedAt === undefined
      && item.saveLocalId === save.localId
      && (!input.highlightsOnly || item.highlighted)
    ) {
      await requireMembership(ctx, save, visit);
      const card = await projectVisitAlbum(ctx, item, save, publication.postId);
      const size = utf8Bytes(card);
      if (page.length > 0 && bytes + size > PAGE_BYTES) break;
      page.push(card);
      bytes += size;
    }
    position = item.position;
    consumed++;
  }
  const isDone = consumed === items.length;
  return {
    page,
    isDone,
    cursor: isDone ? null : artworkCursor(publication, position),
  };
}

export type HistoryKey = { visitedOn: string; postId: string };
export const compareHistory = (a: HistoryKey, b: HistoryKey) =>
  a.visitedOn === b.visitedOn
    ? a.postId < b.postId
      ? -1
      : a.postId > b.postId
        ? 1
        : 0
    : a.visitedOn < b.visitedOn
      ? -1
      : 1;
export function historyCursor(scope: string, key: HistoryKey) {
  return JSON.stringify({
    kind: "history",
    scope,
    visitedOn: key.visitedOn,
    postId: key.postId,
  });
}
export function parseHistoryCursor(scope: string, cursor?: string | null): HistoryKey | null {
  if (cursor == null) return null;
  try {
    const value = JSON.parse(cursor);
    if (
      Object.keys(value).sort().join(",") !== "kind,postId,scope,visitedOn"
      || value.kind !== "history"
      || value.scope !== scope
      || typeof value.visitedOn !== "string"
      || !isCalendarDate(value.visitedOn)
      || typeof value.postId !== "string"
      || !isUuid(value.postId)
    ) {
      throw Error();
    }
    return { visitedOn: value.visitedOn, postId: value.postId };
  } catch {
    throw new ConvexError({ code: "invalid_pagination" });
  }
}
// Every history index ends in ['visitedOn', 'postId']; a range binds the prefix so one head query serves all of them.
type HistoryTail = IndexRange & {
  eq(field: "visitedOn", value: string): { lt(field: "postId", value: string): IndexRange };
  lt(field: "visitedOn", value: string): IndexRange;
};
type HistoryRange<D> = (bound: (tail: HistoryTail) => IndexRange) => {
  order(order: "desc"): { first(): Promise<D | null> };
};
/** A stream of posts, newest visit first: answers the next post before `before`, or the newest when it is null. */
export type HistoryStream = (before: HistoryKey | null) => Promise<Doc<"sharedVisits"> | null>;
async function historyHead<D>(range: HistoryRange<D>, before: HistoryKey | null): Promise<D | null> {
  if (!before) {
    return range((tail) => tail)
      .order("desc")
      .first();
  }
  const sameDate = await range((tail) => tail.eq("visitedOn", before.visitedOn).lt("postId", before.postId))
    .order("desc")
    .first();
  return (
    sameDate
    ?? range((tail) => tail.lt("visitedOn", before.visitedOn))
      .order("desc")
      .first()
  );
}
export const profileHistory =
  (ctx: QueryCtx, profileId: Id<"profiles">, audience?: Infer<typeof visitAudience>): HistoryStream =>
  (before) =>
    historyHead(
      (bound) =>
        audience
          ? ctx.db
              .query("sharedVisits")
              .withIndex("by_profile_audience_status_history", (q) =>
                bound(q.eq("profileId", profileId).eq("audience", audience).eq("status", "active")),
              )
          : ctx.db
              .query("sharedVisits")
              .withIndex("by_profile_status_history", (q) =>
                bound(q.eq("profileId", profileId).eq("status", "active")),
              ),
      before,
    );
export const publicHistory =
  (ctx: QueryCtx): HistoryStream =>
  (before) =>
    historyHead(
      (bound) =>
        ctx.db
          .query("sharedVisits")
          .withIndex("by_audience_status_history", (q) => bound(q.eq("audience", "public").eq("status", "active"))),
      before,
    );
// The sharedVisits trigger deletes a post's tag rows with the post, so every row still has its post.
export const tagHistory =
  (ctx: QueryCtx, tag: string): HistoryStream =>
  async (before) => {
    const row = await historyHead(
      (bound) => ctx.db.query("postTags").withIndex("by_tag_history", (q) => bound(q.eq("tag", tag))),
      before,
    );
    return row && ctx.db.get("sharedVisits", row.publicationId);
  };
// Posts that name the profile as a companion; the trigger keeps a row only while its post exists and lists them.
export const companionHistory =
  (ctx: QueryCtx, profileId: Id<"profiles">): HistoryStream =>
  async (before) => {
    const row = await historyHead(
      (bound) =>
        ctx.db.query("visitCompanions").withIndex("by_profile_history", (q) => bound(q.eq("profileId", profileId))),
      before,
    );
    return row && ctx.db.get("sharedVisits", row.publicationId);
  };

export async function projectVisitAlbum(
  ctx: QueryCtx,
  item: Doc<"sharedVisitItems">,
  save: Doc<"collections">,
  postId: string,
): Promise<Infer<typeof sharedVisitCard>> {
  const card = projectSharedVisitCard(
    item,
    save,
    await resolveDisplayAsset(ctx, save),
    postId,
    await matchesRecord(ctx, save),
  );
  const photos = [];
  for (const localId of item.photoLocalIds ?? []) {
    try {
      photos.push(
        await selectedPhotoMedia(ctx, save, localId, {
          kind: "sharedVisit",
          postId,
          itemId: item._id,
        }),
      );
    } catch (error) {
      if (!(error instanceof ConvexError && error.data.code === "not_found")) {
        throw error;
      }
    }
  }
  return photos.length > 0 ? { ...card, artwork: { ...card.artwork, media: photos[0] }, photos } : card;
}
