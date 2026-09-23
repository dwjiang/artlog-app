import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { JournalOwner, JournalSave } from "../../shared/journal/contracts";

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
    if (score) await ctx.db.patch(score._id, { score: Math.max(0, score.score + amount) });
    else if (amount > 0)
      await ctx.db.insert("leaderboardScores", { accountId, metric, period, score: amount });
  }
}
export async function recordVisitScore(
  ctx: MutationCtx,
  owner: JournalOwner,
  venueId: Id<"museums">,
  day: string,
  previousDay?: string,
) {
  if (owner.kind !== "account" || day === previousDay) return;
  const onDay = (date: string) =>
    ctx.db
      .query("visits")
      .withIndex("by_owner_venue_history", (q) =>
        q.eq("owner", owner).eq("venueId", venueId).eq("visitedOn", date),
      )
      .take(2);
  if (previousDay && !(await onDay(previousDay)).length)
    await increment(ctx, owner.accountId, "visits", previousDay, -1);
  if ((await onDay(day)).length === 1) await increment(ctx, owner.accountId, "visits", day, 1);
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
    const dates = [other, row].flatMap((entry) =>
      entry && entry.deletedAt === undefined ? [entry.savedAt] : [],
    );
    return dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 7) : undefined;
  };
  const before = firstMonth(previous),
    after = firstMonth(save);
  if (before === after) return;
  if (before) await increment(ctx, owner.accountId, "artworks", before, -1);
  if (after) await increment(ctx, owner.accountId, "artworks", after, 1);
}
