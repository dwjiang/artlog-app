import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { requirePublicWallItem } from "./lib/publicationAccess";
import { befriend, setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedDevice } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

it("accepts public reports from registered devices, deduplicates account reporters, and requires shared-visit access", async () => {
  const t = harness();
  const author = await socialUser(t);
  const guest = await seedDevice(t);
  const stranger = await socialUser(t);
  const target = { kind: "profile" as const, profileId: author.profileId };
  await expect(t.mutation(api.reports.submit, { target, reason: "spam" })).rejects.toThrow("unauthenticated");
  const unregistered = await signIn(t);
  await expect(unregistered.as.mutation(api.reports.submit, { target, reason: "spam" })).rejects.toMatchObject({
    data: { code: "device_not_registered" },
  });
  const id = await guest.as.mutation(api.reports.submit, {
    target,
    reason: "spam",
  });
  expect(await guest.as.mutation(api.reports.submit, { target, reason: "harassment" })).toBe(id);
  const first = await stranger.as.mutation(api.reports.submit, {
    target,
    reason: "spam",
  });
  const sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: stranger.accountId }));
  expect(await sibling.as.mutation(api.reports.submit, { target, reason: "spam" })).toBe(first);
  const draft = await socialVisit(t, author);
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection: "Public evidence" }));
  const post = await author.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    reflection: "Public evidence",
  });
  const sharedTarget = { kind: "sharedVisit" as const, postId: post.postId! };
  const reportId = await stranger.as.mutation(api.reports.submit, {
    target: sharedTarget,
    reason: "harassment",
  });
  const report = await t.query(internal.review.getReport, { reportId });
  expect(report?.evidence).toEqual({
    kind: "sharedVisit",
    profileId: author.profileId,
    postId: post.postId,
    reflection: "Public evidence",
  });
  expect(JSON.stringify(report?.evidence)).not.toMatch(/PRIVATE|visitId|saveId|accountId|storage/);
  await setVisitVisibility(t, author, draft.visit._id, "private");
  await expect(
    stranger.as.mutation(api.reports.submit, {
      target: sharedTarget,
      reason: "harassment",
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect((await t.query(internal.review.getReport, { reportId }))?.evidence).toEqual(report?.evidence);
});

it("records operator decisions and permanently removes a publication without changing its private journal", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const draft = await socialVisit(t, a);
  await befriend(a, b);
  const post = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const reportId = await b.as.mutation(api.reports.submit, {
    target: { kind: "sharedVisit", postId: post.postId! },
    reason: "harassment",
  });
  expect((await t.query(internal.review.listReports, {})).rows.map((r) => r.reportId)).toEqual([reportId]);
  const decision = {
    reportId,
    operator: "operator@example.test",
    decision: "remove" as const,
    reason: "Confirmed abuse",
  };
  await t.mutation(internal.review.decideReport, decision);
  await t.mutation(internal.review.decideReport, decision);
  expect((await t.query(internal.review.getReport, { reportId }))?.review).toEqual({
    operator: decision.operator,
    decision: "remove",
    reason: decision.reason,
    reviewedAt: expect.any(Number),
  });
  expect((await t.query(internal.review.listReports, {})).rows).toEqual([]);
  await expect(a.as.query(api.sharedVisits.get, { postId: post.postId! })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  const state = await a.as.query(api.sharedVisits.getState, {
    visitLocalId: draft.visit.localId,
  });
  expect(state).toMatchObject({
    removed: true,
    status: "private",
    revision: 2,
  });
  await expect(
    a.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      revision: state.revision,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect((await t.run((ctx) => ctx.db.get("visits", draft.visit._id)))?.reflection).toBe(draft.visit.reflection);
  expect((await t.run((ctx) => ctx.db.get("collections", draft.saves[0].id)))?.note).toBe("PRIVATE NOTE");
  await expect(
    t.mutation(internal.review.decideReport, {
      ...decision,
      decision: "dismiss",
    }),
  ).rejects.toMatchObject({ data: { code: "conflict" } });
});

it("captures only published wall text and retains removal even if an active flag is later changed", async () => {
  const t = harness();
  const a = await socialUser(t);
  const reporter = await seedDevice(t);
  const draft = await socialVisit(t, a);
  const itemId = await t.run(async (ctx) => {
    const wallId = await ctx.db.insert("walls", {
      profileId: a.profileId,
      color: "#fff",
      layoutRevision: 1,
    });
    await ctx.db.patch("profiles", a.profileId, { publishedWallCount: 1 });
    return ctx.db.insert("wallItems", {
      profileId: a.profileId,
      wallId,
      saveId: draft.saves[0].id,
      placementId: draft.saves[0].localId,
      saveLocalId: draft.saves[0].localId,
      active: true,
      noteVisible: false,
      noteRevision: 0,
      layout: { x: 0, y: 0, width: 1, layer: 0, frame: "none" },
    });
  });
  const reportId = await reporter.as.mutation(api.reports.submit, {
    target: { kind: "wallItem", itemId },
    reason: "harassment",
  });
  const report = await t.query(internal.review.getReport, { reportId });
  expect(report?.evidence).toEqual({
    kind: "wallItem",
    profileId: a.profileId,
    itemId,
    title: "Work 0",
    artist: "Artist",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "op",
    decision: "remove",
    reason: "Confirmed",
  });
  await t.run((ctx) => ctx.db.patch("wallItems", itemId, { active: true }));
  await expect(t.run((ctx) => requirePublicWallItem(ctx, itemId))).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  const item = await t.run((ctx) => ctx.db.get("wallItems", itemId));
  expect(item?.noteRevision).toBe(1);
  expect((await t.run((ctx) => ctx.db.get("walls", item!.wallId)))?.layoutRevision).toBe(2);
  expect((await t.run((ctx) => ctx.db.get("profiles", a.profileId)))?.publishedWallCount).toBe(0);
});

it("dismisses without removing content and prevents a disabled profile from recreating itself", async () => {
  const t = harness();
  const a = await socialUser(t);
  const reporter = await seedDevice(t);
  const target = { kind: "profile" as const, profileId: a.profileId };
  const first = await reporter.as.mutation(api.reports.submit, {
    target,
    reason: "harassment",
  });
  await t.mutation(internal.review.decideReport, {
    reportId: first,
    operator: "op",
    decision: "dismiss",
    reason: "Allowed",
  });
  expect(await t.query(api.profiles.getPublic, { profileId: a.profileId })).not.toBeNull();
  const reportId = await reporter.as.mutation(api.reports.submit, {
    target,
    reason: "harassment",
  });
  expect(reportId).not.toBe(first);
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "op",
    decision: "remove",
    reason: "Confirmed",
  });
  await expect(
    a.as.mutation(api.profiles.create, {
      username: "another_name",
      name: "New",
    }),
  ).rejects.toMatchObject({ data: { code: "profile_required" } });
  await t.run((ctx) => ctx.db.patch("profiles", a.profileId, { active: true }));
  expect(await t.query(api.profiles.getPublic, { profileId: a.profileId })).toBeNull();
  await expect(
    a.as.mutation(internal.profilePhotoData.save, {
      profileId: a.profileId,
      name: "New",
    }),
  ).rejects.toMatchObject({ data: { code: "profile_required" } });
});

it("enforces ten daily reports per account across devices without charging duplicate open reports", async () => {
  const t = harness();
  const reporter = await socialUser(t);
  const sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: reporter.accountId }));
  for (let i = 0; i < 10; i++) {
    const author = await socialUser(t);
    const input = {
      target: { kind: "profile" as const, profileId: author.profileId },
      reason: "spam" as const,
    };
    const first = await reporter.as.mutation(api.reports.submit, input);
    expect(await sibling.as.mutation(api.reports.submit, input)).toBe(first);
  }
  const author = await socialUser(t);
  await expect(
    sibling.as.mutation(api.reports.submit, {
      target: { kind: "profile", profileId: author.profileId },
      reason: "spam",
    }),
  ).rejects.toMatchObject({ data: { code: "rate_limited", name: "report" } });
});

it("reports a visible comment with its text as evidence, and removal deletes it", async () => {
  const t = harness();
  const author = await socialUser(t);
  const commenter = await socialUser(t);
  const guest = await seedDevice(t);
  const draft = await socialVisit(t, author);
  const { postId } = await author.as.mutation(api.sharedVisits.publish, draft.selection);
  const commentId = await commenter.as.mutation(api.visitReactions.addComment, {
    postId: postId!,
    body: "Rude words",
    requestId: crypto.randomUUID(),
  });
  const target = { kind: "comment" as const, commentId };
  const reportId = await guest.as.mutation(api.reports.submit, { target, reason: "harassment" });
  expect((await t.query(internal.review.getReport, { reportId }))?.evidence).toEqual({
    kind: "comment",
    profileId: commenter.profileId,
    postId,
    commentId,
    body: "Rude words",
  });
  await author.as.mutation(api.friendships.block, {
    profileId: commenter.profileId,
    revision: 0,
    blockRevision: 0,
  });
  await expect(author.as.mutation(api.reports.submit, { target, reason: "harassment" })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "op",
    decision: "remove",
    reason: "Confirmed",
  });
  expect(await t.run((ctx) => ctx.db.get("visitComments", commentId))).toBeNull();
  expect(await guest.as.query(api.visitReactions.getSummary, { postId: postId! })).toMatchObject({
    commentCount: 0,
  });
  expect((await t.query(internal.review.getReport, { reportId }))?.evidence).toMatchObject({ body: "Rude words" });
});

it("rejects reports of the reporter's own content and a bare “other” reason", async () => {
  const t = harness();
  const author = await socialUser(t);
  const reporter = await socialUser(t);
  const draft = await socialVisit(t, author);
  const { postId } = await author.as.mutation(api.sharedVisits.publish, draft.selection);
  const commentId = await author.as.mutation(api.visitReactions.addComment, {
    postId: postId!,
    body: "My own note",
    requestId: crypto.randomUUID(),
  });
  for (const target of [
    { kind: "profile" as const, profileId: author.profileId },
    { kind: "sharedVisit" as const, postId: postId! },
    { kind: "comment" as const, commentId },
  ]) {
    await expect(author.as.mutation(api.reports.submit, { target, reason: "spam" })).rejects.toMatchObject({
      data: { code: "invalid_report" },
    });
  }
  const target = { kind: "comment" as const, commentId };
  await expect(
    reporter.as.mutation(api.reports.submit, { target, reason: "other", details: "  " }),
  ).rejects.toMatchObject({ data: { code: "invalid_report" } });
  const reportId = await reporter.as.mutation(api.reports.submit, {
    target,
    reason: "other",
    details: "  Links to a scam site  ",
  });
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    reason: "other",
    details: "Links to a scam site",
  });
});
