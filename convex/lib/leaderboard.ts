import type { JournalOwner, JournalSave, JournalVisit } from "../../shared/journal/contracts";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function increment(ctx: MutationCtx, accountId: Id<"accounts">, metric: "visits" | "artworks", amount: number) {
  if (amount === 0) return;
  const score = await ctx.db
    .query("leaderboardScores")
    .withIndex("by_account_metric", (q) => q.eq("accountId", accountId).eq("metric", metric))
    .unique();
  if (score) {
    await ctx.db.patch("leaderboardScores", score._id, {
      score: Math.max(0, score.score + amount),
    });
  } else if (amount > 0) {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .unique();
    await ctx.db.insert("leaderboardScores", {
      visibility: profile?.active && !profile.removal ? profile.leaderboardVisibility : "off",
      accountId,
      metric,
      score: amount,
    });
  }
}
type MuseumDay = Pick<JournalVisit, "venueId" | "visitedOn">;
/** The account's journal visits plus the posts it is named on as a companion, at one museum on one day; two suffice. */
async function museumDayEntries(ctx: MutationCtx, accountId: Id<"accounts">, { venueId, visitedOn }: MuseumDay) {
  const owner = { kind: "account" as const, accountId };
  const own = await ctx.db
    .query("visits")
    .withIndex("by_owner_venue_history", (q) => q.eq("owner", owner).eq("venueId", venueId).eq("visitedOn", visitedOn))
    .take(2);
  if (own.length === 2) return 2;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .unique();
  const named = profile
    ? await ctx.db
        .query("visitCompanions")
        .withIndex("by_profile_venue_day", (q) =>
          q.eq("profileId", profile._id).eq("venueId", venueId).eq("visitedOn", visitedOn),
        )
        .take(2)
    : [];
  return own.length + named.length;
}
/** The visits metric counts museum days: a day scores with its first entry and stops when its last one goes. */
async function moveMuseumDay(ctx: MutationCtx, accountId: Id<"accounts">, day?: MuseumDay, previous?: MuseumDay) {
  if (day && previous && previous.venueId === day.venueId && previous.visitedOn === day.visitedOn) return;
  if (previous && (await museumDayEntries(ctx, accountId, previous)) === 0) {
    await increment(ctx, accountId, "visits", -1);
  }
  if (day && (await museumDayEntries(ctx, accountId, day)) === 1) {
    await increment(ctx, accountId, "visits", 1);
  }
}
/** Runs after the visit is written, with the museum day it held before. */
export async function recordVisitScore(ctx: MutationCtx, owner: JournalOwner, visit: MuseumDay, previous?: MuseumDay) {
  if (owner.kind === "account") await moveMuseumDay(ctx, owner.accountId, visit, previous);
}
/** Runs after a companion row is written or deleted, with the museum day it holds now and held before. */
export async function recordCompanionScore(
  ctx: MutationCtx,
  profileId: Id<"profiles">,
  day?: MuseumDay,
  previous?: MuseumDay,
) {
  const profile = await ctx.db.get("profiles", profileId);
  if (profile) await moveMuseumDay(ctx, profile.accountId, day, previous);
}
export async function recordArtworkScore(
  ctx: MutationCtx,
  owner: JournalOwner,
  save: JournalSave,
  previous?: JournalSave | null,
) {
  if (owner.kind !== "account") return;
  if (previous && previous.deletedAt === save.deletedAt) return;
  // The save is already persisted. Two rows suffice to find another live entry.
  const matches = save.artworkId
    ? await ctx.db
        .query("collections")
        .withIndex("by_owner_artwork_savedAt", (q) =>
          q.eq("owner", owner).eq("artworkId", save.artworkId).eq("deletedAt", undefined),
        )
        .take(2)
    : [];
  if (matches.some((row) => row.localId !== save.localId)) return;
  const before = previous != null && previous.deletedAt === undefined;
  const after = save.deletedAt === undefined;
  await increment(ctx, owner.accountId, "artworks", Number(after) - Number(before));
}
