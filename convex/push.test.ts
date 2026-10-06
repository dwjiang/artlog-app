import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { befriend, socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { seedDevice } from "./lib/testFactories";
import { LIKE_PUSH_INTERVAL_MS } from "./push";
import { harness, type Harness } from "./test.helpers";

type Sent = { to: string; body: string; badge: number; data: { url: string }; collapseId?: string };
type Ticket = { status: "ok"; id: string } | { status: "error"; details: { error: string } };

const token = (name: string) => `ExponentPushToken[${name}]`;
const everything = { friends: true, reactions: true, companions: true };

function stubExpo({
  tickets = (messages: Sent[]): Ticket[] => messages.map((_, index) => ({ status: "ok", id: `ticket-${index}` })),
  receipts = {} as Record<string, Ticket>,
  sendStatus = [] as number[],
  beforeFailure = async () => {},
} = {}) {
  const sent: Sent[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (url.endsWith("/getReceipts")) return Response.json({ data: receipts });
      const status = sendStatus.shift();
      if (status) {
        await beforeFailure();
        return new Response("unavailable", { status });
      }
      sent.push(body);
      return Response.json({ data: tickets(body) });
    }),
  );
  return sent;
}

const flush = (t: Harness) => t.finishAllScheduledFunctions(vi.runAllTimers);
const pushTokens = (t: Harness) => t.run((ctx) => ctx.db.query("pushTokens").collect());

async function publishedVisit(t: Harness, author: SocialUser) {
  const visit = await socialVisit(t, author);
  return (await author.as.action(api.sharedVisits.publish, visit.selection)).postId!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("push notifications", () => {
  it("tells every device signed in to the account that allows friend notifications", async () => {
    const t = harness();
    const sent = stubExpo();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await ana.as.mutation(api.push.register, { token: token("ana"), ...everything });
    await ben.as.mutation(api.push.register, { token: token("ben-phone"), ...everything });
    const quiet = await seedDevice(t);
    const signedOut = await seedDevice(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("devices", quiet.deviceId, { accountId: ben.accountId });
    });
    await quiet.as.mutation(api.push.register, {
      token: token("ben-ipad"),
      friends: false,
      reactions: true,
      companions: true,
    });
    await signedOut.as.mutation(api.push.register, { token: token("old-phone"), ...everything });

    await ana.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 0 });
    await flush(t);
    expect(sent).toEqual([
      [
        {
          to: token("ben-phone"),
          body: "Ana (@u_ana) sent you a friend request.",
          badge: 1,
          sound: "default",
          data: { url: `/profile/${ana.profileId}` },
        },
      ],
    ]);

    await ben.as.mutation(api.friendships.accept, { profileId: ana.profileId, revision: 1 });
    await flush(t);
    expect(sent[1]).toEqual([
      expect.objectContaining({
        to: token("ana"),
        body: "Ben (@u_ben) accepted your friend request.",
        data: { url: `/profile/${ben.profileId}` },
      }),
    ]);
  });

  it("stays silent for a like taken back within the grace period and for people who turned reactions off", async () => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });

    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: false });
    await flush(t);
    expect(sent).toEqual([]);

    await author.as.mutation(api.push.register, {
      token: token("author"),
      friends: true,
      reactions: false,
      companions: true,
    });
    await ana.as.action(api.visitReactions.addComment, { postId, body: "Lovely.", requestId: crypto.randomUUID() });
    await flush(t);
    expect(sent).toEqual([]);
  });

  it("quotes a comment and opens the visit's comments", async () => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });

    await ana.as.action(api.visitReactions.addComment, {
      postId,
      body: "The Seurat is huge.",
      requestId: crypto.randomUUID(),
    });
    await flush(t);
    expect(sent).toEqual([
      [
        expect.objectContaining({
          body: expect.stringMatching(/^Ana \(@u_ana\) commented on your visit to .+: “The Seurat is huge\.”$/),
          data: { url: `/visit/${postId}?comments=1` },
        }),
      ],
    ]);
  });

  it("tells a companion they were added, under their own switch", async () => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(author, ana);
    await befriend(author, ben);
    await ana.as.mutation(api.push.register, { token: token("ana"), ...everything });
    await ben.as.mutation(api.push.register, { token: token("ben"), ...everything, companions: false });
    await flush(t);
    sent.length = 0;
    const visit = await socialVisit(t, author);
    const { postId } = await author.as.action(api.sharedVisits.publish, {
      ...visit.selection,
      companionIds: [ana.profileId, ben.profileId],
    });

    await flush(t);
    expect(sent).toEqual([
      [
        expect.objectContaining({
          to: token("ana"),
          body: expect.stringMatching(/^Author \(@u_author\) added you to a visit to .+\.$/),
          data: { url: `/visit/${postId}` },
        }),
      ],
    ]);
  });

  it("sends one like push per visit an hour and counts every like since the last one", async () => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const [ana, ben, cy] = [await socialUser(t, "Ana"), await socialUser(t, "Ben"), await socialUser(t, "Cy")];
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });

    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await flush(t);
    await ben.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await flush(t);
    expect(sent.map((batch) => batch[0].body)).toEqual([expect.stringMatching(/^Ana \(@u_ana\) liked your visit to /)]);

    vi.advanceTimersByTime(LIKE_PUSH_INTERVAL_MS);
    await cy.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await flush(t);
    expect(sent).toHaveLength(2);
    expect(sent[1][0]).toMatchObject({
      body: expect.stringMatching(/^Cy \(@u_cy\) and Ben \(@u_ben\) liked your visit to /),
      badge: 1,
      collapseId: expect.stringMatching(/^like:/),
      data: { url: `/visit/${postId}` },
    });
  });

  it("forgets tokens Expo reports as unregistered and retries when Expo is briefly unavailable", async () => {
    const t = harness();
    const sent = stubExpo({
      sendStatus: [503],
      tickets: (messages) =>
        messages.map((message, index): Ticket =>
          message.to === token("gone")
            ? { status: "error", details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: `ticket-${index}` },
        ),
      receipts: { "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } } },
    });
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await ben.as.mutation(api.push.register, { token: token("gone"), ...everything });
    const second = await seedDevice(t);
    const third = await seedDevice(t);
    await t.run(async (ctx) => {
      for (const device of [second, third]) {
        await ctx.db.patch("devices", device.deviceId, { accountId: ben.accountId });
      }
    });
    await second.as.mutation(api.push.register, { token: token("kept"), ...everything });
    await third.as.mutation(api.push.register, { token: token("lapsed"), ...everything });

    await ana.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 0 });
    await flush(t);
    expect(sent).toHaveLength(1);
    expect((await pushTokens(t)).map((row) => row.token)).toEqual([token("kept")]);
  });

  it("moves a token to the installation that registered it last and rejects anything that is not an Expo token", async () => {
    const t = harness();
    const first = await seedDevice(t);
    const second = await seedDevice(t);
    await first.as.mutation(api.push.register, { token: token("shared"), ...everything });
    await second.as.mutation(api.push.register, {
      token: token("shared"),
      friends: false,
      reactions: true,
      companions: true,
    });
    expect(await pushTokens(t)).toEqual([
      expect.objectContaining({ deviceId: second.deviceId, token: token("shared"), friends: false }),
    ]);

    await expect(second.as.mutation(api.push.register, { token: "not-a-token", ...everything })).rejects.toThrow(
      /invalid_push_token/,
    );
  });

  it.each(["sign out", "switch account", "sign out and back in", "opt out", "replace token", "ban", "delete account"])(
    "rechecks each device before a retry after %s, while still delivering to eligible devices",
    async (change) => {
      const t = harness();
      const author = await socialUser(t, "Author");
      const ana = await socialUser(t, "Ana");
      const other = await seedDevice(t);
      await t.run((ctx) => ctx.db.patch("devices", other.deviceId, { accountId: author.accountId }));
      await other.as.mutation(api.push.register, { token: token("other"), ...everything });
      await author.as.mutation(api.push.register, { token: token("author"), ...everything });
      const postId = await publishedVisit(t, author);
      const sent = stubExpo({
        sendStatus: [503],
        beforeFailure: async () => {
          switch (change) {
            case "sign out":
            case "switch account":
            case "sign out and back in":
              await author.as.mutation(api.accounts.unlink, {});
              if (change !== "sign out") {
                await t.run((ctx) =>
                  ctx.db.patch("devices", author.deviceId, {
                    accountId: change === "switch account" ? ana.accountId : author.accountId,
                  }),
                );
              }
              break;
            case "opt out":
              await author.as.mutation(api.push.register, {
                token: token("author"),
                friends: true,
                reactions: false,
                companions: true,
              });
              break;
            case "replace token":
              await author.as.mutation(api.push.register, { token: token("replacement"), ...everything });
              break;
            case "ban":
              await t.run((ctx) => ctx.db.patch("devices", author.deviceId, { banned: true }));
              break;
            case "delete account":
              await author.as.mutation(api.accounts.deleteAccount, {});
              break;
          }
        },
      });
      await ana.as.action(api.visitReactions.addComment, { postId, body: "Lovely.", requestId: crypto.randomUUID() });
      await flush(t);
      expect(sent.flat().map(({ to }) => to)).toEqual(change === "delete account" ? [] : [token("other")]);
    },
  );

  it("counts only visible notifications in the push badge", async () => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    await ben.as.action(api.visitReactions.addComment, { postId, body: "Hidden.", requestId: crypto.randomUUID() });
    await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: ben.profileId });
    await ana.as.mutation(api.friendships.request, { profileId: author.profileId, revision: 0 });
    expect((await author.as.query(api.notifications.unseen, {})).page).toHaveLength(1);
    await flush(t);
    expect(sent.flat().map(({ badge }) => badge)).toEqual([1]);
  });

  it.each(["block", "delete comment"])("drops a queued comment after %s before a retry", async (change) => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    const commentId = await ana.as.action(api.visitReactions.addComment, {
      postId,
      body: "Lovely.",
      requestId: crypto.randomUUID(),
    });
    const sent = stubExpo({
      sendStatus: [503],
      beforeFailure: async () => {
        if (change === "block") {
          await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: ana.profileId });
        } else {
          await ana.as.mutation(api.visitReactions.deleteComment, { postId, commentId });
        }
      },
    });

    await flush(t);

    expect((await author.as.query(api.notifications.unseen, {})).page).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refreshes the badge when notifications are read before a retry", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    await ana.as.action(api.visitReactions.addComment, { postId, body: "Lovely.", requestId: crypto.randomUUID() });
    const sent = stubExpo({
      sendStatus: [503],
      beforeFailure: async () => {
        const { page } = await author.as.query(api.notifications.list, {});
        await author.as.mutation(api.notifications.markSeen, { through: page[0].createdAt });
      },
    });

    await flush(t);

    expect((await author.as.query(api.notifications.unseen, {})).page).toEqual([]);
    expect(sent.flat().map(({ badge }) => badge)).toEqual([0]);
  });

  it.each(["accept", "cancel"] as const)("drops a queued friend request after %s before a retry", async (change) => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await ben.as.mutation(api.push.register, { token: token("ben"), ...everything });
    const requested = await ana.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 0 });
    const sent = stubExpo({
      sendStatus: [503],
      beforeFailure: async () => {
        if (change === "accept") {
          await ben.as.mutation(api.friendships.accept, { profileId: ana.profileId, revision: requested.revision });
        } else {
          await ana.as.mutation(api.friendships.cancel, { profileId: ben.profileId, revision: requested.revision });
        }
      },
    });

    await flush(t);

    expect(sent).toEqual([]);
  });

  it.each(["block", "unlike"])("rebuilds grouped likes after %s before a retry", async (change) => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await ben.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    const sent = stubExpo({
      sendStatus: [503],
      beforeFailure: async () => {
        if (change === "block") {
          await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: ana.profileId });
        } else {
          await ana.as.mutation(api.visitReactions.setLike, { postId, liked: false });
        }
      },
    });

    await flush(t);

    expect(sent.flat().map(({ body }) => body)).toEqual([expect.stringMatching(/^Ben \(@u_ben\) liked/)]);
  });

  it("keeps newer likes for the next batch when retrying an earlier batch", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cy = await socialUser(t, "Cy");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    const sent = stubExpo({
      sendStatus: [503],
      beforeFailure: async () => {
        await ben.as.mutation(api.visitReactions.setLike, { postId, liked: true });
      },
    });

    await flush(t);
    expect(sent.flat().map(({ body }) => body)).toEqual([expect.stringMatching(/^Ana \(@u_ana\) liked/)]);

    vi.advanceTimersByTime(LIKE_PUSH_INTERVAL_MS);
    await cy.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await flush(t);
    expect(sent).toHaveLength(2);
    expect(sent[1][0].body).toMatch(/^Cy \(@u_cy\) and Ben \(@u_ben\) liked/);
  });

  it.each([true, false])("waits out every grouped like's grace period (newer like withdrawn: %s)", async (withdraw) => {
    const t = harness();
    const sent = stubExpo();
    const author = await socialUser(t, "Author");
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cy = await socialUser(t, "Cy");
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.push.register, { token: token("author"), ...everything });
    await ana.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await ben.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await vi.advanceTimersByTimeAsync(11_000);
    await t.finishInProgressScheduledFunctions();
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    expect(sent.flat().map(({ body }) => body)).toEqual([expect.stringMatching(/^Ana \(@u_ana\) liked/)]);
    await vi.advanceTimersByTimeAsync(10_000);
    if (withdraw) await ben.as.mutation(api.visitReactions.setLike, { postId, liked: false });
    await flush(t);
    await vi.advanceTimersByTimeAsync(LIKE_PUSH_INTERVAL_MS);
    await cy.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    await flush(t);
    expect(sent).toHaveLength(2);
    expect(sent[1][0].body).toMatch(withdraw ? /^Cy \(@u_cy\) liked/ : /^Cy \(@u_cy\) and Ben \(@u_ben\) liked/);
  });
});
