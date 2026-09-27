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
/** The visits metric counts museum days: a visit scores when it is the first at its museum that day. */
export async function recordVisitScore(
  ctx: MutationCtx,
  owner: JournalOwner,
  visit: Pick<JournalVisit, "venueId" | "visitedOn">,
  previous?: Pick<JournalVisit, "venueId" | "visitedOn">,
) {
  if (owner.kind !== "account") return;
  if (previous && previous.venueId === visit.venueId && previous.visitedOn === visit.visitedOn) return;
  const onDay = ({ venueId, visitedOn }: Pick<JournalVisit, "venueId" | "visitedOn">) =>
    ctx.db
      .query("visits")
      .withIndex("by_owner_venue_history", (q) =>
        q.eq("owner", owner).eq("venueId", venueId).eq("visitedOn", visitedOn),
      )
      .take(2);
  if (previous && (await onDay(previous)).length === 0) {
    await increment(ctx, owner.accountId, "visits", -1);
  }
  if ((await onDay(visit)).length === 1) {
    await increment(ctx, owner.accountId, "visits", 1);
  }
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
