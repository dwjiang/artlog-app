import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { seedDevice } from "./lib/testFactories";
import { harness } from "./test.helpers";

const conflict = { data: { code: "conflict" } };

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
  ).rejects.toMatchObject({ data: { code: "apple_sign_in_required" } });
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
    profileId: b.profileId,
    revision: 3,
    blockRevision: 0,
  });
  await expect(
    b.as.mutation(api.friendships.request, {
      profileId: a.profileId,
      revision: 4,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  await a.as.mutation(api.friendships.unblock, {
    profileId: b.profileId,
    blockRevision: 1,
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
  await expect(
    a.as.mutation(api.friendships.block, {
      profileId: b.profileId,
      revision: 4,
      blockRevision: 0,
    }),
  ).rejects.toMatchObject(conflict);
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
        appleUserId: `cap-${i}`,
        createdAt: 1,
      });
      const other = await ctx.db.insert("profiles", {
        accountId,
        username: `cap_${i}`,
        name: "Friend",
        searchText: "friend",
        active: true,
        publishedWallCount: 0,
        leaderboardVisibility: "global",
        createdAt: 1,
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
    profileId: b.profileId,
    revision: revision + 1,
    blockRevision: 0,
  });
});

it("limits other relationship changes to 60 per minute", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  for (let i = 0; i < 30; i++) {
    await a.as.mutation(api.friendships.block, {
      profileId: b.profileId,
      revision: i,
      blockRevision: i * 2,
    });
    await a.as.mutation(api.friendships.unblock, {
      profileId: b.profileId,
      blockRevision: i * 2 + 1,
    });
  }
  await expect(
    a.as.mutation(api.friendships.block, {
      profileId: b.profileId,
      revision: 30,
      blockRevision: 60,
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
  const reportId = await reporter.as.mutation(api.reports.submit, {
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
      profileId: b.profileId,
      revision: 3,
      blockRevision: 0,
    }),
  ).toMatchObject({ blocked: true, blockRevision: 1 });
  expect(
    await a.as.mutation(api.friendships.unblock, {
      profileId: b.profileId,
      blockRevision: 1,
    }),
  ).toMatchObject({ blocked: false, blockRevision: 2 });
  const { acceptedRelationships } = await import("./lib/friendships");
  expect(await t.run((ctx) => acceptedRelationships(ctx, a.profileId))).toEqual([]);
});
