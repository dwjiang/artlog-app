import { v } from "convex/values";

import { publicProfile } from "../shared/social/contracts";
import { leaderboardMetric, leaderboardVisibility, rankScores } from "../shared/social/leaderboard";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { acceptedRelationships, findBlock } from "./lib/friendships";
import { activeProfile, optionalProfile, requireProfile } from "./lib/ownership";
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
    await ctx.db.patch("profiles", profile._id, {
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
  },
  returns: v.object({
    visibility: leaderboardVisibility,
    rows: v.array(v.object({ profile: publicProfile, score: v.number(), rank: v.number() })),
  }),
  handler: async (ctx, args) => {
    const viewer = args.audience === "friends" ? (await requireProfile(ctx)).profile : await optionalProfile(ctx);
    const visibility = viewer?.leaderboardVisibility ?? "off";
    const edges = args.audience === "friends" && viewer ? await acceptedRelationships(ctx, viewer._id) : [];
    const candidates: { person: Doc<"profiles">; score: number }[] = [];
    if (args.audience === "global") {
      const blocked = new Set<string>();
      if (viewer) {
        for await (const block of ctx.db.query("blocks").withIndex("by_pair", (q) => q.eq("blockerId", viewer._id))) {
          if (block.active) blocked.add(block.blockedId);
        }
        for await (const block of ctx.db
          .query("blocks")
          .withIndex("by_blockedId", (q) => q.eq("blockedId", viewer._id))) {
          if (block.active) blocked.add(block.blockerId);
        }
      }
      for await (const score of ctx.db
        .query("leaderboardScores")
        .withIndex("by_metric_visibility_score", (q) => q.eq("metric", args.metric).eq("visibility", "global"))
        .order("desc")) {
        const person = await ctx.db
          .query("profiles")
          .withIndex("by_accountId", (q) => q.eq("accountId", score.accountId))
          .unique();
        if (
          !person
          || !person.active
          || person.removal
          || blocked.has(person._id)
          || !(await ctx.db.get("accounts", score.accountId))
        ) {
          continue;
        }
        candidates.push({ person, score: score.score });
        if (candidates.length === 100) break;
      }
    } else if (viewer) {
      for (const id of [
        viewer._id,
        ...edges.map((edge) => (edge.firstProfileId === viewer._id ? edge.secondProfileId : edge.firstProfileId)),
      ]) {
        const person = await activeProfile(ctx, id);
        if (!person) continue;
        const score = await ctx.db
          .query("leaderboardScores")
          .withIndex("by_account_metric", (q) => q.eq("accountId", person.accountId).eq("metric", args.metric))
          .unique();
        candidates.push({ person, score: score?.score ?? 0 });
      }
    }
    const rows = [];
    for (const { person, score } of candidates) {
      if (
        !person.active
        || person.removal
        || person.leaderboardVisibility === "off"
        || !(await ctx.db.get("accounts", person.accountId))
      ) {
        continue;
      }
      if (
        args.audience === "friends"
        && viewer
        && ((await findBlock(ctx, viewer._id, person._id))?.active
          || (await findBlock(ctx, person._id, viewer._id))?.active)
      ) {
        continue;
      }
      rows.push({
        profile: await projectProfile(ctx, person),
        score,
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
