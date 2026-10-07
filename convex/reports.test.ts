import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { readArtworkContent } from "./lib/artworkContent";
import { requirePublicWallItem } from "./lib/publicationAccess";
import { befriend, setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice, seedScan } from "./lib/testFactories";
import { wallFixture } from "./lib/wallFixtures";
import { harness, signIn } from "./test.helpers";

it("upgrades an automatic block report with explicit details and keeps retries idempotent", async () => {
  const t = harness();
  const reporter = await socialUser(t);
  const author = await socialUser(t);
  const target = { kind: "profile" as const, profileId: author.profileId };
  await reporter.as.mutation(api.friendships.block, { scope: reporter.scope, profileId: author.profileId });
  const [automatic] = (await t.query(internal.review.listReports, {})).rows;
  await t.run((ctx) => ctx.db.patch("profiles", author.profileId, { bio: "Current public bio" }));
  const input = { target, reason: "harassment" as const, details: "  This profile is targeting my friends.  " };
  const submitted = await reporter.as.mutation(api.reports.submit, input);
  expect(submitted.reportId).toBe(automatic.reportId);
  expect(await t.query(internal.review.getReport, submitted)).toMatchObject({
    reason: "harassment",
    details: input.details.trim(),
    evidence: { kind: "profile", profileId: author.profileId, bio: "Current public bio" },
    status: "open",
  });
  expect(await reporter.as.mutation(api.reports.submit, input)).toEqual(submitted);
  expect((await t.query(internal.review.listReports, {})).rows).toHaveLength(1);
  expect(await reporter.as.query(api.friendships.getState, { profileId: author.profileId })).toMatchObject({
    blocked: true,
  });
});

it("counts explicit reports after blocking toward the daily limit, but not their retries", async () => {
  const t = harness();
  const reporter = await socialUser(t);
  for (let i = 0; i < 10; i++) {
    const author = await socialUser(t);
    await reporter.as.mutation(api.friendships.block, { scope: reporter.scope, profileId: author.profileId });
    const input = { target: { kind: "profile" as const, profileId: author.profileId }, reason: "spam" as const };
    const submitted = await reporter.as.mutation(api.reports.submit, input);
    expect(await reporter.as.mutation(api.reports.submit, input)).toEqual(submitted);
  }
  const author = await socialUser(t);
  await reporter.as.mutation(api.friendships.block, { scope: reporter.scope, profileId: author.profileId });
  await expect(
    reporter.as.mutation(api.reports.submit, {
      target: { kind: "profile", profileId: author.profileId },
      reason: "spam",
    }),
  ).rejects.toMatchObject({ data: { code: "rate_limited", name: "report" } });
  expect((await t.query(internal.review.listReports, {})).rows).toContainEqual(
    expect.objectContaining({ target: { kind: "profile", profileId: author.profileId }, reason: "blocked" }),
  );
});

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
  const { reportId: id } = await guest.as.mutation(api.reports.submit, {
    target,
    reason: "spam",
  });
  expect((await guest.as.mutation(api.reports.submit, { target, reason: "harassment" })).reportId).toBe(id);
  const { reportId: first } = await stranger.as.mutation(api.reports.submit, {
    target,
    reason: "spam",
  });
  const sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: stranger.accountId }));
  expect((await sibling.as.mutation(api.reports.submit, { target, reason: "spam" })).reportId).toBe(first);
  const draft = await socialVisit(t, author);
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection: "Public evidence" }));
  const post = await author.as.action(api.sharedVisits.publish, {
    ...draft.selection,
    reflection: "Public evidence",
  });
  const sharedTarget = { kind: "sharedVisit" as const, postId: post.postId! };
  const { reportId } = await stranger.as.mutation(api.reports.submit, {
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
  const post = await a.as.action(api.sharedVisits.publish, draft.selection);
  const { reportId } = await b.as.mutation(api.reports.submit, {
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
    a.as.action(api.sharedVisits.publish, {
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
      layout: { x: 0, y: 0, width: 1, layer: 0, frame: "black" },
    });
  });
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
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
  expect((await t.run((ctx) => ctx.db.get("walls", item!.wallId)))?.layoutRevision).toBe(2);
  expect((await t.run((ctx) => ctx.db.get("profiles", a.profileId)))?.publishedWallCount).toBe(0);
});

it.each([false, true])("preserves the displayed wall title in report evidence when linked=%s", async (linked) => {
  const t = harness();
  const owner = await wallFixture(t, "owner");
  const reporter = await socialUser(t, "Reporter");
  const record = { title: "Pay Attention Motherfuckers", artist: "Bruce Nauman" };
  await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx, { artwork: record });
    await ctx.db.patch("collections", owner.saveId, { artworkId: linked ? artworkId : undefined, snapshot: record });
  });
  const wall = await owner.as.mutation(api.walls.setLayout, owner.input);
  const { itemId } = wall.items[0];
  const visible = await t.query(api.walls.getArtwork, { itemId });
  expect(visible?.artwork.title).toBe(linked ? record.title : "Untitled");
  const report = await reporter.as.mutation(api.reports.submit, {
    target: { kind: "wallItem", itemId },
    reason: "other",
    details: "Please review this title.",
  });
  await t.run((ctx) => ctx.db.patch("collections", owner.saveId, { snapshot: { ...record, title: "Edited" } }));
  expect(await t.query(internal.review.getReport, report)).toMatchObject({
    evidence: { title: visible!.artwork.title, artist: visible!.artwork.artist },
  });
});

it("dismisses without removing content and prevents a disabled profile from recreating itself", async () => {
  const t = harness();
  const a = await socialUser(t);
  const reporter = await seedDevice(t);
  const target = { kind: "profile" as const, profileId: a.profileId };
  const { reportId: first } = await reporter.as.mutation(api.reports.submit, {
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
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
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
    a.as.action(api.profiles.create, {
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
    const { reportId: first } = await reporter.as.mutation(api.reports.submit, input);
    expect((await sibling.as.mutation(api.reports.submit, input)).reportId).toBe(first);
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
  const { postId } = await author.as.action(api.sharedVisits.publish, draft.selection);
  const commentId = await commenter.as.action(api.visitReactions.addComment, {
    postId: postId!,
    body: "Rude words",
    requestId: crypto.randomUUID(),
  });
  const target = { kind: "comment" as const, commentId };
  const { reportId } = await guest.as.mutation(api.reports.submit, { target, reason: "offensive" });
  expect((await t.query(internal.review.getReport, { reportId }))?.evidence).toEqual({
    kind: "comment",
    profileId: commenter.profileId,
    postId,
    commentId,
    body: "Rude words",
  });
  await author.as.mutation(api.friendships.block, {
    scope: author.scope,
    profileId: commenter.profileId,
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
  const { postId } = await author.as.action(api.sharedVisits.publish, draft.selection);
  const commentId = await author.as.action(api.visitReactions.addComment, {
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
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
    target,
    reason: "other",
    details: "  Links to a scam site  ",
  });
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    reason: "other",
    details: "Links to a scam site",
  });
});

const docentFixture = [{ sentence: "Monet painted this pond at Giverny in 1916.", factIds: ["f1"] }];
const factSheetFixture = [
  {
    id: "f1",
    text: "Painted at Giverny in 1916.",
    sourceUrl: "https://museum.example/lilies",
    sourceLabel: "Test Museum",
    sourceScore: 1,
  },
];
const seedDescribed = (t: ReturnType<typeof harness>) =>
  t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { factSheetUpdatedAt: 5 },
      artworkContent: { docent: { en: docentFixture }, factSheet: factSheetFixture },
    }),
  );

it.each(["wrongFacts", "wrongArtwork", "offensive", "other"] as const)(
  "saves a %s description report without changing content or scheduling generation",
  async (reason) => {
    const t = harness();
    const reporter = await seedDevice(t);
    const { artworkId } = await seedDescribed(t);
    const target = { kind: "docent" as const, artworkId };
    const state = () =>
      t.run(async (ctx) => {
        const artwork = (await ctx.db.get("artworks", artworkId))!;
        return {
          artwork,
          content: await readArtworkContent(ctx, artwork),
          scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
        };
      });
    const before = await state();
    const { reportId } = await reporter.as.mutation(api.reports.submit, {
      target,
      reason,
      details: "  Please review this description.  ",
    });
    expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
      target,
      reason,
      details: "Please review this description.",
      reporter: { kind: "device", deviceId: reporter.deviceId },
      evidence: { kind: "docent", artworkId, sentences: [docentFixture[0].sentence] },
      status: "open",
    });
    expect(await state()).toEqual(before);
    expect((await reporter.as.query(api.artworks.enrichment, { artworkId }))?.docent).toEqual(docentFixture);
  },
);

it("deduplicates open generated-content reports per reporter while accepting other reporters", async () => {
  const t = harness();
  const reporter = await seedDevice(t);
  const other = await seedDevice(t);
  const { artworkId } = await seedDescribed(t);
  const target = { kind: "docent" as const, artworkId };
  const first = await reporter.as.mutation(api.reports.submit, { target, reason: "wrongFacts" });
  expect(await reporter.as.mutation(api.reports.submit, { target, reason: "wrongFacts" })).toEqual(first);
  const second = await other.as.mutation(api.reports.submit, { target, reason: "offensive" });
  expect(second.reportId).not.toBe(first.reportId);
  expect((await t.query(internal.review.listReports, {})).rows).toHaveLength(2);
});

it("uses the existing report limit for generated content", async () => {
  const t = harness();
  const reporter = await seedDevice(t);
  for (let index = 0; index < 10; index++) {
    const { artworkId } = await seedDescribed(t);
    await reporter.as.mutation(api.reports.submit, { target: { kind: "docent", artworkId }, reason: "offensive" });
  }
  const { artworkId } = await seedDescribed(t);
  await expect(
    reporter.as.mutation(api.reports.submit, {
      target: { kind: "docent", artworkId },
      reason: "offensive",
    }),
  ).rejects.toMatchObject({ data: { code: "rate_limited" } });
  expect((await t.query(internal.review.listReports, {})).rows).toHaveLength(10);
});

it("accepts only the reasons that fit generated content and needs something to report", async () => {
  const t = harness();
  const reporter = await seedDevice(t);
  const { artworkId } = await seedDescribed(t);
  for (const [kind, reason] of [
    ["docent", "spam"],
    ["transcript", "glitches"],
    ["audio", "wrongFacts"],
  ] as const) {
    await expect(
      reporter.as.mutation(api.reports.submit, {
        target: kind === "audio" ? { kind, artworkId, renderId: "missing" } : { kind, artworkId },
        reason,
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_report" } });
  }
  for (const kind of ["transcript", "audio"] as const) {
    await expect(
      reporter.as.mutation(api.reports.submit, {
        target: kind === "audio" ? { kind, artworkId, renderId: "missing" } : { kind, artworkId },
        reason: "other",
        details: "Wrong",
      }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
  }
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetNeedsReview: true }));
  await expect(
    reporter.as.mutation(api.reports.submit, { target: { kind: "docent", artworkId }, reason: "offensive" }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
});

it("holds an artwork's generated content for review when an operator removes a reported description", async () => {
  const t = harness();
  const reporter = await seedDevice(t);
  const { artworkId } = await seedDescribed(t);
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
    target: { kind: "docent", artworkId },
    reason: "offensive",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "operator@example.test",
    decision: "remove",
    reason: "Confirmed",
  });
  const artwork = await t.run((ctx) => ctx.db.get("artworks", artworkId));
  expect(artwork?.factSheetNeedsReview).toBe(true);
  expect(await reporter.as.query(api.artworks.enrichment, { artworkId })).toMatchObject({
    docentWriting: false,
    narrationWriting: false,
  });
});

it("accepts a report on a scan's private description only from the scan's own device, and removal hides it", async () => {
  const t = harness();
  const owner = await seedDevice(t);
  const other = await seedDevice(t);
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: owner.deviceId,
      confirmed: {
        source: "manual",
        fields: { title: "Water Lilies", artist: "Claude Monet" },
        confirmedAt: 1,
        generation: 1,
        docent: docentFixture,
        factSheet: factSheetFixture,
      },
    }),
  );
  const target = { kind: "scanDocent" as const, scanId };
  await expect(other.as.mutation(api.reports.submit, { target, reason: "wrongFacts" })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  const { reportId } = await owner.as.mutation(api.reports.submit, { target, reason: "wrongArtwork" });
  expect(await t.query(internal.review.getReport, { reportId })).toMatchObject({
    target,
    evidence: { kind: "scanDocent", scanId, sentences: [docentFixture[0].sentence] },
    status: "open",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "ops",
    decision: "remove",
    reason: "Describes another work",
  });
  expect(await owner.as.query(api.scans.get, { scanId })).toMatchObject({ docentStatus: "unavailable" });
  expect((await owner.as.query(api.scans.get, { scanId }))?.docent).toBeUndefined();
});
