import { describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { seedDevice } from "./lib/testFactories";
import { harness, signIn, type Harness } from "./test.helpers";

const feedback = {
  message: "  The map froze after I picked a museum. ",
  appVersion: "1.0.0 (12)",
  osVersion: "iOS 26.0",
};

async function seedAccountUser(t: Harness) {
  const user = await seedDevice(t);
  const accountId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accounts", { appleUserId: "alex", deviceIds: [user.deviceId], createdAt: 1 });
    await ctx.db.patch("devices", user.deviceId, { accountId: id });
    return id;
  });
  return { ...user, accountId };
}

describe("appFeedback.submit", () => {
  it("stores trimmed feedback against a guest's device", async () => {
    const t = harness();
    const guest = await seedDevice(t);
    await guest.as.mutation(api.appFeedback.submit, feedback);
    expect(await t.query(internal.review.listFeedback, {})).toMatchObject([
      {
        owner: { kind: "device", deviceId: guest.deviceId },
        message: "The map froze after I picked a museum.",
        appVersion: "1.0.0 (12)",
        osVersion: "iOS 26.0",
      },
    ]);
  });

  it("stores a signed-in user's feedback against their account", async () => {
    const t = harness();
    const user = await seedAccountUser(t);
    await user.as.mutation(api.appFeedback.submit, feedback);
    expect(await t.query(internal.review.listFeedback, {})).toMatchObject([
      { owner: { kind: "account", accountId: user.accountId } },
    ]);
  });

  it("keeps the message but drops its owner when the account is deleted", async () => {
    vi.useFakeTimers();
    try {
      const t = harness();
      const user = await seedAccountUser(t);
      await user.as.mutation(api.appFeedback.submit, feedback);
      await user.as.mutation(api.accounts.deleteAccount, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const [stored] = await t.query(internal.review.listFeedback, {});
      expect(stored.message).toBe("The map froze after I picked a museum.");
      expect(stored.owner).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["an empty message", { message: "   " }],
    ["an oversized message", { message: "x".repeat(2001) }],
    ["an oversized version", { appVersion: "v".repeat(41) }],
  ])("rejects %s", async (_label, override) => {
    const t = harness();
    const user = await seedDevice(t);
    await expect(user.as.mutation(api.appFeedback.submit, { ...feedback, ...override })).rejects.toMatchObject({
      data: { code: "invalid_feedback" },
    });
    expect(await t.query(internal.review.listFeedback, {})).toEqual([]);
  });

  it("requires a registered device", async () => {
    const t = harness();
    const user = await signIn(t);
    await expect(user.as.mutation(api.appFeedback.submit, feedback)).rejects.toMatchObject({
      data: { code: "device_not_registered" },
    });
  });

  it("limits each user to ten messages a day", async () => {
    const t = harness();
    const user = await seedDevice(t);
    for (let sent = 0; sent < 10; sent++) {
      await user.as.mutation(api.appFeedback.submit, feedback);
    }
    await expect(user.as.mutation(api.appFeedback.submit, feedback)).rejects.toMatchObject({
      data: { code: "rate_limited", name: "appFeedback" },
    });
    const other = await seedDevice(t);
    await other.as.mutation(api.appFeedback.submit, feedback);
    expect(await t.query(internal.review.listFeedback, {})).toHaveLength(11);
  });
});
