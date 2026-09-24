import { v } from "convex/values";
import { leaderboardMetric, leaderboardVisibility, rankScores } from "../shared/social/leaderboard";
import { publicProfile } from "../shared/social/contracts";
import { mutation, query } from "./_generated/server";
import { activeProfile, optionalProfile, requireProfile } from "./lib/ownership";
import { acceptedRelationships, findBlock } from "./lib/friendships";
import { projectProfile } from "./lib/projections";

export const preference = query({
  args: {},
  returns: leaderboardVisibility,
  handler: async (ctx) => (await requireProfile(ctx)).profile.leaderboardVisibility,
});
export const setPreference = mutation({
  args: { visibility: leaderboardVisibility },
  returns: v.null(),
  handler: async (ctx, { visibility }) => {
    const { profile } = await requireProfile(ctx);
    await ctx.db.patch(profile._id, {
      leaderboardVisibility: visibility,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const list = query({
  args: {
    metric: leaderboardMetric,
    audience: v.union(v.literal("friends"), v.literal("global")),
    period: v.union(v.literal("month"), v.literal("all")),
  },
  returns: v.object({
    visibility: leaderboardVisibility,
    rows: v.array(v.object({ profile: publicProfile, score: v.number(), rank: v.number() })),
  }),
  handler: async (ctx, args) => {
    const viewer = args.audience === "friends" ? (await requireProfile(ctx)).profile : await optionalProfile(ctx);
    const visibility = viewer?.leaderboardVisibility ?? "off";
    const period = args.period === "all" ? "all" : new Date().toISOString().slice(0, 7);
    const edges = args.audience === "friends" && viewer ? await acceptedRelationships(ctx, viewer._id) : [];
    // The global board reads at most the first 1000 opted-in profiles so it keeps answering as participation grows.
    const candidates =
      args.audience === "global"
        ? await ctx.db
            .query("profiles")
            .withIndex("by_leaderboard", (q) => q.eq("leaderboardVisibility", "global"))
            .take(1000)
        : viewer
          ? (
              await Promise.all(
                [
                  viewer._id,
                  ...edges.map((edge) =>
                    edge.firstProfileId === viewer._id ? edge.secondProfileId : edge.firstProfileId,
                  ),
                ].map((id) => activeProfile(ctx, id)),
              )
            ).filter((row) => row !== null)
          : [];
    const rows = [];
    for (const person of candidates) {
      if (
        !person.active
        || person.removal
        || person.leaderboardVisibility === "off"
        || !(await ctx.db.get(person.accountId))
      ) {
        continue;
      }
      if (
        viewer
        && ((await findBlock(ctx, viewer._id, person._id))?.active
          || (await findBlock(ctx, person._id, viewer._id))?.active)
      ) {
        continue;
      }
      const score = await ctx.db
        .query("leaderboardScores")
        .withIndex("by_account_metric_period", (q) =>
          q.eq("accountId", person.accountId).eq("metric", args.metric).eq("period", period),
        )
        .unique();
      rows.push({
        profile: await projectProfile(ctx, person),
        score: score?.score ?? 0,
        name: person.name,
        username: person.username,
      });
    }
    return {
      visibility,
      rows: rankScores(rows).map(({ profile, score, rank }) => ({
        profile,
        score,
        rank,
      })),
    };
  },
});
