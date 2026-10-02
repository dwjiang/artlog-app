import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { seedDevice } from "./lib/testFactories";
import { wallFixture } from "./lib/wallFixtures";
import { harness } from "./test.helpers";

const conflict = { data: { code: "conflict" } };

it("keeps a newer block when an old unblock is retried", async () => {
  const t = harness();
  const actor = await socialUser(t);
  const other = await socialUser(t);
  const input = { scope: actor.scope, profileId: other.profileId };
  const first = await actor.as.mutation(api.friendships.block, input);
  const unblock = { ...input, blockRevision: first.blockRevision };
  const cleared = await actor.as.mutation(api.friendships.unblock, unblock);
  expect(await actor.as.mutation(api.friendships.unblock, unblock)).toEqual(cleared);
  const newer = await actor.as.mutation(api.friendships.block, input);
  await expect(actor.as.mutation(api.friendships.unblock, unblock)).rejects.toMatchObject(conflict);
  expect(await actor.as.query(api.friendships.getState, { profileId: other.profileId })).toEqual(newer);
  const [listed] = (await actor.as.query(api.friendships.listBlocked, {})).page;
  expect(listed).toMatchObject({ profileId: other.profileId, blockRevision: newer.blockRevision });
  await actor.as.mutation(api.friendships.unblock, { ...input, blockRevision: listed.blockRevision });
  expect((await actor.as.query(api.friendships.listBlocked, {})).page).toEqual([]);
});

it.each(["block", "unblock"] as const)("rejects a delayed %s after the device changes accounts", async (action) => {
  const t = harness();
  const original = await socialUser(t);
  const replacement = await socialUser(t);
  const target = await socialUser(t);
  if (action === "unblock") {
    await replacement.as.mutation(api.friendships.block, { scope: replacement.scope, profileId: target.profileId });
  }
  const before = await replacement.as.query(api.friendships.getState, { profileId: target.profileId });
  const input = {
    scope: original.scope,
    profileId: target.profileId,
    ...(action === "unblock" ? { blockRevision: before.blockRevision } : {}),
  };
  await t.run((ctx) =>
    ctx.db.patch("devices", original.deviceId, { accountId: replacement.accountId, scopeRevision: 2 }),
  );
  await expect(original.as.mutation(api.friendships[action], input)).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  expect(await replacement.as.query(api.friendships.getState, { profileId: target.profileId })).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(action === "block" ? 0 : 1);
});

it("derives the actor and restricts each pending transition to its participant", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const guest = await seedDevice(t);
  await expect(
    guest.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 0,
    }),
  ).rejects.toMatchObject({ data: { code: "sign_in_required" } });
  await expect(
    a.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 0,
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_relationship" } });
  await a.as.mutation(api.friendships.request, {
    profileId: b.profileId,
    revision: 0,
  });
  for (const fn of [api.friendships.accept, api.friendships.decline]) {
    await expect(a.as.mutation(fn, { profileId: b.profileId, revision: 1 })).rejects.toMatchObject({
      data: { code: "invalid_relationship" },
    });
  }
  await expect(
    b.as.mutation(api.friendships.cancel, {
      profileId: a.profileId,
      revision: 1,
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_relationship" } });
  await expect(
    b.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 1,
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_relationship" } });
  expect(
    await b.as.mutation(api.friendships.decline, {
      profileId: a.profileId,
      revision: 1,
    }),
  ).toMatchObject({ state: "none", revision: 2 });
});

it("serializes concurrent reverse requests without duplicate edges or implicit acceptance", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const result = await Promise.allSettled([
    a.as.mutation(api.friendships.request, {
      profileId: b.profileId,
      revision: 0,
    }),
    b.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 0,
    }),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rows = await t.run((ctx) => ctx.db.query("friendships").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("pending");
  expect(rows[0].firstProfileId < rows[0].secondProfileId).toBe(true);
});

it("keeps revocation revisions and rejects delayed writes across remove and block/unblock", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  await befriend(a, b);
  await a.as.mutation(api.friendships.remove, {
    profileId: b.profileId,
    revision: 2,
  });
  await expect(
    b.as.mutation(api.friendships.accept, {
      profileId: a.profileId,
      revision: 1,
    }),
  ).rejects.toMatchObject(conflict);
  expect(
    await a.as.mutation(api.friendships.remove, {
      profileId: b.profileId,
      revision: 2,
    }),
  ).toMatchObject({ revision: 3, state: "none" });
  await a.as.mutation(api.friendships.block, {
    scope: a.scope,
    profileId: b.profileId,
  });
  await expect(
    b.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 4,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  await a.as.mutation(api.friendships.unblock, {
    scope: a.scope,
    blockRevision: 1,
    profileId: b.profileId,
  });
  await expect(
    a.as.mutation(api.friendships.request, {
      profileId: b.profileId,
      revision: 3,
    }),
  ).rejects.toMatchObject(conflict);
  expect(await a.as.query(api.friendships.getState, { profileId: b.profileId })).toMatchObject({
    state: "none",
    revision: 4,
    blocked: false,
    blockRevision: 2,
  });
  expect(await a.as.mutation(api.friendships.block, { scope: a.scope, profileId: b.profileId })).toMatchObject({
    revision: 5,
    blocked: true,
    blockRevision: 3,
  });
});

it("enforces the 200-friend cap for both participants and concurrent acceptances", async () => {
  const t = harness({ transactionLimits: true });
  const a = await socialUser(t);
  const b = await socialUser(t);
  const c = await socialUser(t);
  const { canonicalPair } = await import("./lib/friendships");
  await t.run(async (ctx) => {
    for (let i = 0; i < 199; i++) {
      const accountId = await ctx.db.insert("accounts", {
        provider: "apple",
        providerUserId: `cap-${i}`,
      });
      const other = await ctx.db.insert("profiles", {
        accountId,
        username: `cap_${i}`,
        name: "Friend",
        searchText: "friend",
        active: true,
        publishedWallCount: 0,
        leaderboardVisibility: "global",
        updatedAt: 1,
      });
      const [firstProfileId, secondProfileId] = canonicalPair(a.profileId, other);
      await ctx.db.insert("friendships", {
        firstProfileId,
        secondProfileId,
        requesterId: a.profileId,
        state: "accepted",
        revision: 2,
        updatedAt: 1,
      });
    }
  });
  await a.as.mutation(api.friendships.request, {
    profileId: b.profileId,
    revision: 0,
  });
  await a.as.mutation(api.friendships.request, {
    profileId: c.profileId,
    revision: 0,
  });
  const result = await Promise.allSettled(
    [b, c].map((user) =>
      user.as.mutation(api.friendships.accept, {
        profileId: a.profileId,
        revision: 1,
      }),
    ),
  );
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find((r) => r.status === "rejected")).toMatchObject({
    reason: { data: { code: "friend_limit" } },
  });
  const d = await socialUser(t);
  await d.as.mutation(api.friendships.request, {
    profileId: a.profileId,
    revision: 0,
  });
  await expect(
    a.as.mutation(api.friendships.accept, {
      profileId: d.profileId,
      revision: 1,
    }),
  ).rejects.toMatchObject({ data: { code: "friend_limit" } });
});

it("keeps account request and change quotas separate across devices and leaves revocations available", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const c = await socialUser(t);
  const sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: a.accountId }));
  let revision = 0;
  for (let i = 0; i < 20; i++) {
    const requested = await a.as.mutation(api.friendships.request, {
      profileId: b.profileId,
      revision,
    });
    revision = requested.revision;
    if (i < 19) {
      revision = (
        await a.as.mutation(api.friendships.cancel, {
          profileId: b.profileId,
          revision,
        })
      ).revision;
    }
  }
  await expect(
    sibling.as.mutation(api.friendships.request, {
      profileId: c.profileId,
      revision: 0,
    }),
  ).rejects.toMatchObject({
    data: { code: "rate_limited", name: "friendRequest" },
  });
  await sibling.as.mutation(api.friendships.cancel, {
    profileId: b.profileId,
    revision,
  });
  await sibling.as.mutation(api.friendships.block, {
    scope: a.scope,
    profileId: b.profileId,
  });
});

it("limits other relationship changes to 60 per minute", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  for (let i = 0; i < 30; i++) {
    await a.as.mutation(api.friendships.block, {
      scope: a.scope,
      profileId: b.profileId,
    });
    await a.as.mutation(api.friendships.unblock, {
      scope: a.scope,
      blockRevision: i * 2 + 1,
      profileId: b.profileId,
    });
  }
  await expect(
    a.as.mutation(api.friendships.block, {
      scope: a.scope,
      profileId: b.profileId,
    }),
  ).rejects.toMatchObject({
    data: { code: "rate_limited", name: "relationshipChange" },
  });
});

it("lets friends drop a moderation-removed profile so it stops holding a friend slot", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const reporter = await seedDevice(t);
  await befriend(a, b);
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
    target: { kind: "profile", profileId: b.profileId },
    reason: "harassment",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "op",
    decision: "remove",
    reason: "Confirmed",
  });
  await expect(a.as.query(api.friendships.getState, { profileId: b.profileId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  expect(
    await a.as.mutation(api.friendships.remove, {
      profileId: b.profileId,
      revision: 2,
    }),
  ).toMatchObject({ state: "none", revision: 3 });
  await expect(
    a.as.mutation(api.friendships.request, {
      profileId: b.profileId,
      revision: 3,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect(
    await a.as.mutation(api.friendships.block, {
      scope: a.scope,
      profileId: b.profileId,
    }),
  ).toMatchObject({ blocked: true, blockRevision: 1 });
  expect(
    await a.as.mutation(api.friendships.unblock, {
      scope: a.scope,
      blockRevision: 1,
      profileId: b.profileId,
    }),
  ).toMatchObject({ blocked: false, blockRevision: 2 });
  const { acceptedRelationships } = await import("./lib/friendships");
  expect(await t.run((ctx) => acceptedRelationships(ctx, a.profileId))).toEqual([]);
});

it("hides a blocked pair’s profiles, walls, and search results from each other but not from signed-out visitors", async () => {
  const t = harness();
  const author = await wallFixture(t, "author");
  const viewer = await wallFixture(t, "viewer");
  const {
    items: [item],
  } = await author.as.mutation(api.walls.setLayout, author.input);
  const ids = (page: { profileId: string }[]) => page.map((person) => person.profileId);
  expect(ids((await viewer.as.query(api.profiles.search, { query: "reader" })).page)).toContain(
    author.profile.profileId,
  );
  await viewer.as.mutation(api.friendships.block, { scope: viewer.scope, profileId: author.profile.profileId });

  // The blocker keeps the profile to unblock from; the blocked person loses it.
  expect(await viewer.as.query(api.profiles.getPublic, { profileId: author.profile.profileId })).toMatchObject({
    profileId: author.profile.profileId,
  });
  expect(await author.as.query(api.profiles.getPublic, { profileId: viewer.profile.profileId })).toBeNull();
  for (const [person, other] of [
    [viewer, author],
    [author, viewer],
  ]) {
    expect(await person.as.query(api.walls.getPublic, { profileId: other.profile.profileId })).toBeNull();
    expect(ids((await person.as.query(api.profiles.search, { query: "reader" })).page)).not.toContain(
      other.profile.profileId,
    );
    expect(ids((await person.as.query(api.profiles.discover, {})).page)).not.toContain(other.profile.profileId);
  }
  expect(await viewer.as.query(api.walls.getArtwork, { itemId: item.itemId })).toBeNull();
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toMatchObject({ itemId: item.itemId });
  expect(await t.query(api.walls.getPublic, { profileId: author.profile.profileId })).toMatchObject({
    artworkCount: 1,
  });

  await viewer.as.mutation(api.friendships.unblock, {
    scope: viewer.scope,
    blockRevision: 1,
    profileId: author.profile.profileId,
  });
  expect(await author.as.query(api.profiles.getPublic, { profileId: viewer.profile.profileId })).not.toBeNull();
  expect(await viewer.as.query(api.walls.getArtwork, { itemId: item.itemId })).toMatchObject({ itemId: item.itemId });
});

it("sends each new block to moderation once and lists active blocks until they are lifted", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const c = await socialUser(t);
  const reports = () => t.run((ctx) => ctx.db.query("reports").collect());
  const ids = (page: { profileId: string }[]) => page.map((person) => person.profileId);
  await a.as.mutation(api.reports.submit, { target: { kind: "profile", profileId: c.profileId }, reason: "spam" });
  await a.as.mutation(api.friendships.block, { scope: a.scope, profileId: b.profileId });
  await a.as.mutation(api.friendships.block, { scope: a.scope, profileId: b.profileId });
  await a.as.mutation(api.friendships.block, { scope: a.scope, profileId: c.profileId });
  expect(await reports()).toEqual([
    expect.objectContaining({ target: { kind: "profile", profileId: c.profileId }, reason: "spam" }),
    expect.objectContaining({
      reporter: { kind: "account", accountId: a.accountId },
      target: { kind: "profile", profileId: b.profileId },
      reason: "blocked",
      status: "open",
      evidence: expect.objectContaining({ kind: "profile", profileId: b.profileId }),
    }),
  ]);
  await expect(
    a.as.mutation(api.reports.submit, {
      target: { kind: "profile", profileId: b.profileId },
      reason: "blocked" as never,
    }),
  ).rejects.toThrow('got `"blocked"`');

  expect(await a.as.query(api.friendships.listBlocked, {})).toMatchObject({
    page: [{ profileId: c.profileId }, { profileId: b.profileId }],
    isDone: true,
  });
  expect((await b.as.query(api.friendships.listBlocked, {})).page).toEqual([]);
  await a.as.mutation(api.friendships.unblock, { scope: a.scope, blockRevision: 1, profileId: b.profileId });
  expect(ids((await a.as.query(api.friendships.listBlocked, {})).page)).toEqual([c.profileId]);
  await a.as.mutation(api.friendships.block, { scope: a.scope, profileId: b.profileId });
  expect(await reports()).toHaveLength(2);
});
