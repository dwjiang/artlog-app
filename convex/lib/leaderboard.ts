import type { JournalOwner, JournalSave, JournalVisit } from "../../shared/journal/contracts";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function increment(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  metric: "visits" | "artworks",
  day: string,
  amount: number,
) {
  for (const period of ["all", day.slice(0, 7)]) {
    const score = await ctx.db
      .query("leaderboardScores")
      .withIndex("by_account_metric_period", (q) =>
        q.eq("accountId", accountId).eq("metric", metric).eq("period", period),
      )
      .unique();
    if (score) {
      await ctx.db.patch("leaderboardScores", score._id, {
        score: Math.max(0, score.score + amount),
      });
    } else if (amount > 0) {
      await ctx.db.insert("leaderboardScores", {
        accountId,
        metric,
        period,
        score: amount,
      });
    }
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
    await increment(ctx, owner.accountId, "visits", previous.visitedOn, -1);
  }
  if ((await onDay(visit)).length === 1) {
    await increment(ctx, owner.accountId, "visits", visit.visitedOn, 1);
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
  // The save is already persisted. Two rows suffice to find the earliest other live entry.
  const matches = save.artworkId
    ? await ctx.db
        .query("collections")
        .withIndex("by_owner_artwork_savedAt", (q) =>
          q.eq("owner", owner).eq("artworkId", save.artworkId).eq("deletedAt", undefined),
        )
        .take(2)
    : [];
  const other = matches.find((row) => row.localId !== save.localId);
  const firstMonth = (row?: JournalSave | null) => {
    const dates = [other, row].flatMap((entry) => (entry && entry.deletedAt === undefined ? [entry.savedAt] : []));
    return dates.length > 0 ? new Date(Math.min(...dates)).toISOString().slice(0, 7) : undefined;
  };
  const before = firstMonth(previous);
  const after = firstMonth(save);
  if (before === after) return;
  if (before) await increment(ctx, owner.accountId, "artworks", before, -1);
  if (after) await increment(ctx, owner.accountId, "artworks", after, 1);
}
