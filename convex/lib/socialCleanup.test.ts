import { expect, it, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { harness } from "../test.helpers";
import { fileStorage } from "./fileStorage";
import { befriend, socialDerivative, socialUser, socialVisit } from "./socialTestFixtures";

it("revokes immediately, purges social references in batches, and deletes files after the last reference", async () => {
  vi.useFakeTimers();
  try {
    const t = harness({ transactionLimits: true });
    const a = await socialUser(t);
    const b = await socialUser(t);
    const draft = await socialVisit(t, a, 50);
    await befriend(a, b);
    const post = await a.as.mutation(api.sharedVisits.publish, draft.selection);
    const { reportId } = await a.as.mutation(api.reports.submit, {
      target: { kind: "profile", profileId: b.profileId },
      reason: "spam",
    });
    const asset = await socialDerivative(t, a, draft.saves[0].id);
    const storageId = await t.run(async (ctx) => {
      const storageId = await fileStorage.store(ctx, new Blob(["derivative"]));
      const wall = await ctx.db
        .query("walls")
        .withIndex("by_profileId", (q) => q.eq("profileId", a.profileId))
        .unique();
      const wallId = wall!._id;
      await ctx.db.patch("walls", wallId, { layoutRevision: 1, color: "#fff" });
      await ctx.db.insert("leaderboardScores", {
        visibility: "global",
        accountId: a.accountId,
        metric: "visits",
        score: 1,
      });
      for (let i = 0; i < 75; i++) {
        await ctx.db.insert("mediaAssets", {
          saveId: draft.saves[0].id,
          storageId,
          provenance: asset.provenance,
          source: {
            kind: "derivative",
            rights: "contributor_consent",
            width: 10,
            height: 10,
          },
        });
      }
      await ctx.db.insert("wallItems", {
        wallId,
        profileId: a.profileId,
        saveId: draft.saves[0].id,
        placementId: draft.saves[0].localId,
        saveLocalId: draft.saves[0].localId,
        active: true,
        noteVisible: false,
        noteRevision: 0,
        layout: { x: 0, y: 0, width: 1, layer: 0, frame: "black" },
      });
      await ctx.db.insert("blocks", {
        blockerId: b.profileId,
        blockedId: a.profileId,
        active: false,
        revision: 2,
      });
      return storageId;
    });
    // A live account cannot be purged by accidentally invoking the internal cleanup.
    await t.mutation(internal.accounts.purgeJournal, {
      accountId: a.accountId,
    });
    expect(await t.run((ctx) => ctx.db.get("profiles", a.profileId))).not.toBeNull();
    await a.as.mutation(api.accounts.deleteAccount, {});
    await expect(b.as.query(api.sharedVisits.get, { postId: post.postId! })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, storageId))).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const table of [
      "sharedVisits",
      "sharedVisitItems",
      "wallItems",
      "friendships",
      "blocks",
      "mediaAssets",
      "collections",
      "visits",
    ] as const) {
      expect(await t.run((ctx) => ctx.db.query(table).collect())).toEqual([]);
    }
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("walls")
          .withIndex("by_profileId", (q) => q.eq("profileId", a.profileId))
          .collect(),
      ),
    ).toEqual([]);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("walls")
          .withIndex("by_profileId", (q) => q.eq("profileId", b.profileId))
          .collect(),
      ),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("leaderboardScores")
          .withIndex("by_account_metric", (q) => q.eq("accountId", a.accountId))
          .collect(),
      ),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("profiles", a.profileId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("profiles", b.profileId))).not.toBeNull();
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, storageId))).toBeNull();
    const report = await t.query(internal.review.getReport, { reportId });
    expect(report?.reporter).toBeUndefined();
    expect(report?.evidence.kind).toBe("profile");
  } finally {
    vi.useRealTimers();
  }
});
