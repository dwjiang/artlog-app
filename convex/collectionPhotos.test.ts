import { expect, it } from "vitest";

import { api } from "./_generated/api";
import { fileStorage } from "./lib/fileStorage";
import { seedDevice } from "./lib/testFactories";
import { harness } from "./test.helpers";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
async function fixture() {
  const t = harness();
  const owner = await seedDevice(t);
  const sibling = await seedDevice(t);
  const outsider = await seedDevice(t);
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("accounts", {
      appleUserId: "owner",
    });
    for (const device of [owner, sibling]) {
      await ctx.db.patch("devices", device.deviceId, { accountId });
    }
  });
  const work = {
    localId: crypto.randomUUID(),
    snapshot: { title: "Water Lilies", artist: "Monet" },
    savedAt: 1,
  };
  const scope = async (device = owner) => (await device.as.query(api.accounts.me, {})).scope;
  const path = async (device = owner, query = "kind=crop") =>
    `/collection-photo?localId=${work.localId}&${query}&scope=${encodeURIComponent(await scope(device))}`;
  await owner.as.mutation(api.collections.saveToCollection, {
    ...work,
    suggested: null,
    scope: await scope(),
  });
  const upload = async (device = owner, query = "kind=crop", body = jpeg, headers = {}) =>
    device.as.fetch(await path(device, query), {
      method: "POST",
      body,
      headers: { "Content-Type": "image/jpeg", ...headers },
    });
  const sync = async (device = sibling, since = 0) =>
    device.as.mutation(api.sync.syncJournal, {
      scope: await scope(device),
      since,
      visits: [],
      saves: [],
    });
  return { t, owner, sibling, outsider, work, scope, path, upload, sync };
}

it("serves private bytes to the canonical account and denies other owners or anonymous callers", async () => {
  const { t, owner, sibling, outsider, path, upload } = await fixture();
  expect((await upload()).status).toBe(200);
  const image = await owner.as.fetch(await path());
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
  expect(image.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await sibling.as.fetch(await path(sibling))).status).toBe(200);
  expect((await outsider.as.fetch(await path(outsider))).status).toBe(404);
  expect((await t.fetch(await path())).status).toBe(401);
});

it("keeps only the latest crop under concurrent uploads and validates content and ownership", async () => {
  const { t, owner, outsider, work, scope, path, upload } = await fixture();
  expect((await upload(outsider)).status).toBe(404);
  expect((await upload(owner, "kind=crop", new Uint8Array())).status).toBe(400);
  expect((await upload(owner, "kind=crop", jpeg, { "Content-Length": "20000000" })).status).toBe(413);
  // The full photo is an album row: kind=photo needs its photoId and the crop never takes one.
  expect((await upload(owner, "kind=photo")).status).toBe(400);
  expect((await upload(owner, `kind=crop&photoId=${crypto.randomUUID()}`)).status).toBe(400);
  expect((await upload(owner, `kind=photo&photoId=${crypto.randomUUID()}`)).status).toBe(404);
  const responses = await Promise.all([upload(), upload()]);
  const ids = await Promise.all(responses.map((r) => r.json()));
  expect(ids[0].storageId).not.toEqual(ids[1].storageId);
  expect(responses.every((response) => response.status === 200)).toBe(true);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("files")
        .collect()
        .then((files) => files.filter((file) => file.state === "ready")),
    ),
  ).toHaveLength(1);
  await outsider.as.mutation(api.collections.saveToCollection, {
    ...work,
    scope: await scope(outsider),
    suggested: null,
  });
  expect((await outsider.as.fetch(await path(outsider))).status).toBe(404);
});

it("advances sync for late photos without changing note edit stamps, and survives source sign-out", async () => {
  const { owner, sibling, path, upload, sync } = await fixture();
  const first = await sync();
  const stamp = first.saves[0].updatedAt;
  await upload();
  const next = await sync(sibling, first.checkpoint);
  expect(next.saves[0]).toMatchObject({
    updatedAt: stamp,
    cropStorageId: expect.any(String),
  });
  expect(next.saves[0]).not.toHaveProperty("photoStorageId");
  expect(next.checkpoint).toBeGreaterThan(first.checkpoint);
  const stalePath = await path();
  await owner.as.mutation(api.accounts.unlink, {});
  expect((await owner.as.fetch(stalePath)).status).toBe(409);
  expect((await owner.as.fetch(await path())).status).toBe(404);
  expect((await sibling.as.fetch(await path(sibling))).status).toBe(200);
});

it("deletion revokes every account device and cleans bytes immediately", async () => {
  const { t, owner, sibling, work, scope, path, upload } = await fixture();
  await upload();
  await owner.as.mutation(api.collections.remove, {
    scope: await scope(),
    localId: work.localId,
  });
  expect((await upload()).status).toBe(404);
  expect((await sibling.as.fetch(await path(sibling))).status).toBe(404);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("files")
        .collect()
        .then((files) => files.filter((file) => file.state === "ready")),
    ),
  ).toEqual([]);
});

it("replaces a crop for every account device, advances photo sync, and removes obsolete private bytes", async () => {
  const { t, owner, sibling, path, upload, sync } = await fixture();
  const first = await (await upload()).json();
  const before = await sync();
  const changed = new Uint8Array([...jpeg, 42]);
  const next = await (await upload(owner, "kind=crop", changed)).json();
  expect(next.storageId).not.toBe(first.storageId);
  expect(next.photoUpdatedAt).toBeGreaterThan(first.photoUpdatedAt);
  expect(new Uint8Array(await (await sibling.as.fetch(await path(sibling))).arrayBuffer())).toEqual(changed);
  const after = await sync(sibling, before.checkpoint);
  expect(after.saves[0]).toMatchObject({
    cropStorageId: next.storageId,
    photoUpdatedAt: next.photoUpdatedAt,
  });
  expect(await t.run((ctx) => fileStorage.get(ctx, first.storageId))).toBeNull();
});
