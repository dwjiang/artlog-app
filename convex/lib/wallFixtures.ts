import { api } from "../_generated/api";
import type { Harness } from "../test.helpers";
import { seedDevice } from "./testFactories";

let readers = 0;
// Sequential defaults keep random hex out of usernames, where the profanity filter reads it as leetspeak.
export async function wallFixture(t: Harness, sub = String(++readers)) {
  const device = await seedDevice(t);
  await t.run((ctx) =>
    ctx.db.patch("devices", device.deviceId, {
      accountLinkProof: { provider: "apple", sub, expiresAt: Date.now() + 10000 },
    }),
  );
  const accountId = await device.as.mutation(api.accounts.linkAccount, {
    provider: "apple",
    providerUserId: sub,
    nonce: (
      await device.as.mutation(api.devices.createChallenge, {
        purpose: "assert",
      })
    ).nonce,
    assertionBase64: "",
  });
  const { scope } = await device.as.query(api.accounts.me, {});
  while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {
    /* Finish the fixture's claim. */
  }
  const profile = await device.as.action(api.profiles.create, {
    username: `reader_${sub}`,
    name: "Reader",
  });
  const saveLocalId = crypto.randomUUID();
  const saveId = await t.run((ctx) =>
    ctx.db.insert("collections", {
      owner: { kind: "account", accountId },
      localId: saveLocalId,
      snapshot: {
        title: "Saved title",
        artist: "Saved artist",
        date: "1900",
        medium: "Oil",
      },
      savedAt: 1,
      updatedAt: 1,
      updatedBy: device.deviceId,
      changeVersion: 1,
    }),
  );
  const layout = { x: 0, y: 0, width: 0.5, layer: 0, frame: "oak" as const };
  const selection = { placementId: crypto.randomUUID(), saveLocalId, layout };
  const input = { scope, revision: 0, color: "#45524B", items: [selection] };
  return {
    ...device,
    accountId,
    scope,
    profile,
    saveId,
    saveLocalId,
    layout,
    selection,
    input,
  };
}
