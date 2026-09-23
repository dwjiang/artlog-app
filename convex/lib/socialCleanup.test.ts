import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { harness } from "../test.helpers";
import { befriend, socialDerivative, socialUser, socialVisit } from "./socialTestFixtures";

it("revokes immediately, purges social references in batches, and deletes files after the last reference", async () => {
  vi.useFakeTimers();
  try {
    const t = harness({ transactionLimits: true }),
      a = await socialUser(t),
      b = await socialUser(t),
      draft = await socialVisit(t, a, 50);
    await befriend(a, b);
    const post = await a.as.mutation(api.sharedVisits.publish, draft.selection);
    const reportId = await a.as.mutation(api.reports.submit, {
      target: { kind: "profile", profileId: b.profileId },
      reason: "Report",
    });
    const asset = await socialDerivative(t, a, draft.saves[0].id);
    const storageId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["derivative"]));
      const wallId = await ctx.db.insert("walls", {
        profileId: a.profileId,
        layoutRevision: 1,
        color: "#fff",
      });
      await ctx.db.insert("leaderboardScores", {
        accountId: a.accountId,
        metric: "visits",
        period: "all",
        score: 1,
      });
      for (let i = 0; i < 75; i++) {
        await ctx.db.insert("mediaAssets", {
          saveId: draft.saves[0].id,
          storageId,
          provenance: asset.provenance,
          createdAt: i,
          source: { kind: "derivative", rights: "contributor_consent", width: 10, height: 10 },
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
        layout: { x: 0, y: 0, width: 1, layer: 0, frame: "none" },
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
    await t.mutation(internal.accounts.purgeJournal, { accountId: a.accountId });
    expect(await t.run((ctx) => ctx.db.get(a.profileId))).not.toBeNull();
    await a.as.mutation(api.accounts.deleteAccount, {});
    await expect(b.as.query(api.sharedVisits.get, { postId: post.postId! })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    expect(await t.run((ctx) => ctx.db.system.get("_storage", storageId))).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const table of [
      "sharedVisits",
      "sharedVisitItems",
      "wallItems",
      "walls",
      "friendships",
      "blocks",
      "mediaAssets",
      "collections",
      "visits",
      "leaderboardScores",
    ] as const) {
      expect(await t.run((ctx) => ctx.db.query(table).collect())).toEqual([]);
    }
    expect(await t.run((ctx) => ctx.db.get(a.profileId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(b.profileId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get("_storage", storageId))).toBeNull();
    const report = await t.query(internal.review.getReport, { reportId });
    expect(report?.reporter).toBeUndefined();
    expect(report?.evidence.kind).toBe("profile");
  } finally {
    vi.useRealTimers();
  }
});
