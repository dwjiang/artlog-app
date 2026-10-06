import type { Triggers } from "convex-helpers/server/triggers";
import type { Infer } from "convex/values";

import { LIMITS } from "../../shared/journal/limits";
import type { publicProfile } from "../../shared/social/contracts";
import { internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { blockedEitherWay, findRelationship } from "./friendships";
import { recordCompanionScore } from "./leaderboard";
import { activeProfile } from "./ownership";
import { projectProfile } from "./projections";

type Selection = NonNullable<Doc<"sharedVisits">["companionSelections"]>[number];
type Revocation = { authorId: Id<"profiles">; profileId: Id<"profiles">; throughRevision: number };
const CLEANUP_BATCH = 10;

async function companionFriendship(ctx: QueryCtx, authorId: Id<"profiles">, profileId: Id<"profiles">) {
  if (profileId === authorId) return null;
  const profile = await activeProfile(ctx, profileId);
  if (!profile) return null;
  const friendship = await findRelationship(ctx, authorId, profileId);
  if (friendship?.state !== "accepted" || (await blockedEitherWay(ctx, authorId, profileId))) return null;
  return { profile, friendship };
}

export async function selectCompanions(ctx: QueryCtx, authorId: Id<"profiles">, ids: readonly Id<"profiles">[]) {
  const selections: Selection[] = [];
  for (const profileId of new Set(ids)) {
    if (selections.length === LIMITS.companions) break;
    const match = await companionFriendship(ctx, authorId, profileId);
    if (match) selections.push({ profileId, friendshipRevision: match.friendship.revision });
  }
  return selections;
}

/** The picked companions who can still be named on the author's post: active friends neither side has blocked. */
async function qualifyingCompanions(
  ctx: QueryCtx,
  authorId: Id<"profiles">,
  selections: readonly Selection[],
): Promise<Doc<"profiles">[]> {
  const people = [];
  for (const selection of selections) {
    const match = await companionFriendship(ctx, authorId, selection.profileId);
    if (match?.friendship.revision === selection.friendshipRevision) people.push(match.profile);
  }
  return people;
}

export async function isSelectedCompanion(ctx: QueryCtx, publication: Doc<"sharedVisits">, profileId: Id<"profiles">) {
  const selection = publication.companionSelections?.find((person) => person.profileId === profileId);
  return !!selection && (await qualifyingCompanions(ctx, publication.profileId, [selection])).length > 0;
}

/** The companions a viewer of the post sees; one the viewer blocked, or who blocked the viewer, is left out. */
export async function visibleCompanions(
  ctx: QueryCtx,
  publication: Doc<"sharedVisits">,
  viewerId: Id<"profiles"> | undefined,
): Promise<Infer<typeof publicProfile>[]> {
  const shown = [];
  for (const person of await qualifyingCompanions(ctx, publication.profileId, publication.companionSelections ?? [])) {
    if (viewerId && viewerId !== person._id && (await blockedEitherWay(ctx, person._id, viewerId))) continue;
    shown.push(await projectProfile(ctx, person));
  }
  return shown;
}

/** Companions are listed, notified and credited only while their friends can read the post. */
function listsCompanions(publication: Doc<"sharedVisits">) {
  return publication.status === "active" && !publication.removal && publication.audience !== "private";
}

function companionRows(ctx: QueryCtx, publicationId: Id<"sharedVisits">) {
  return ctx.db
    .query("visitCompanions")
    .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
    .take(LIMITS.companions);
}

export async function isListedCompanion(
  ctx: QueryCtx,
  publicationId: Id<"sharedVisits">,
  profileId: Id<"profiles">,
): Promise<boolean> {
  const row = (await companionRows(ctx, publicationId)).find((row) => row.profileId === profileId);
  if (!row) return false;
  const match = await companionFriendship(ctx, row.authorId, profileId);
  return match?.friendship.revision === row.friendshipRevision;
}

// Score each write synchronously: recursive triggers run after the whole batch and cannot count its intermediate days.
export async function removeVisitCompanion(ctx: MutationCtx, row: Doc<"visitCompanions">) {
  await ctx.db.delete("visitCompanions", row._id);
  await recordCompanionScore(ctx, row.profileId, undefined, row);
}

export async function removeCompanionBatch(ctx: MutationCtx, args: Revocation) {
  const rows = await ctx.db
    .query("visitCompanions")
    .withIndex("by_author_profile_revision", (q) =>
      q.eq("authorId", args.authorId).eq("profileId", args.profileId).lte("friendshipRevision", args.throughRevision),
    )
    .take(CLEANUP_BATCH);
  for (const row of rows) await removeVisitCompanion(ctx, row);
  if (rows.length === CLEANUP_BATCH) {
    await ctx.scheduler.runAfter(0, internal.visitCompanions.revoke, args);
  }
  return null;
}

// Publishing, audience and date changes, a museum move, review removal, a companion leaving, and account deletion all
// write the post, so the rows follow it without each path knowing about companions.
export function registerVisitCompanions(triggers: Triggers<DataModel>) {
  triggers.register("sharedVisits", async (ctx, { id, newDoc, oldDoc }) => {
    const visit = newDoc && listsCompanions(newDoc) ? await ctx.db.get("visits", newDoc.visitId) : null;
    const rows = await companionRows(ctx, id);
    // Artwork deletion updates many post revisions. Reuse unchanged companions, but still detect museum moves.
    if (
      oldDoc
      && newDoc
      && visit
      && listsCompanions(oldDoc)
      && oldDoc.visitedOn === newDoc.visitedOn
      && JSON.stringify(oldDoc.companionSelections ?? []) === JSON.stringify(newDoc.companionSelections ?? [])
      && rows.every((row) => row.venueId === visit.venueId)
    ) {
      return;
    }
    const wanted =
      newDoc && visit ? await qualifyingCompanions(ctx, newDoc.profileId, newDoc.companionSelections ?? []) : [];
    for (const row of rows) {
      const selection = newDoc?.companionSelections?.find((person) => person.profileId === row.profileId);
      if (
        !wanted.some((person) => person._id === row.profileId)
        || selection?.friendshipRevision !== row.friendshipRevision
      ) {
        await removeVisitCompanion(ctx, row);
      }
    }
    if (!newDoc || !visit) return;
    const day = { venueId: visit.venueId, visitedOn: newDoc.visitedOn };
    for (const person of wanted) {
      const { friendshipRevision } = newDoc.companionSelections!.find(
        (selection) => selection.profileId === person._id,
      )!;
      const row = rows.find(
        (existing) => existing.profileId === person._id && existing.friendshipRevision === friendshipRevision,
      );
      if (!row) {
        await ctx.db.insert("visitCompanions", {
          publicationId: id,
          authorId: newDoc.profileId,
          profileId: person._id,
          postId: newDoc.postId,
          friendshipRevision,
          ...day,
        });
        await recordCompanionScore(ctx, person._id, day);
      } else if (row.venueId !== day.venueId || row.visitedOn !== day.visitedOn) {
        await ctx.db.patch("visitCompanions", row._id, day);
        await recordCompanionScore(ctx, person._id, day, row);
      }
    }
  });
  triggers.register("friendships", async (ctx, { newDoc, oldDoc }) => {
    if (oldDoc?.state !== "accepted" || newDoc?.state === "accepted") return;
    for (const [authorId, profileId] of [
      [oldDoc.firstProfileId, oldDoc.secondProfileId],
      [oldDoc.secondProfileId, oldDoc.firstProfileId],
    ]) {
      await removeCompanionBatch(ctx, { authorId, profileId, throughRevision: oldDoc.revision });
    }
  });
}
