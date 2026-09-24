import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

it("updates only the authenticated profile and deletes replaced public photos", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await socialUser(t);
  const photo = await t.run((ctx) => ctx.storage.store(new Blob(["photo"], { type: "image/jpeg" })));
  await expect(
    other.as.mutation(internal.profilePhotoData.save, {
      profileId: owner.profileId,
      name: "Changed",
      photo,
    }),
  ).rejects.toThrow("sync_scope_changed");
  const updated = await owner.as.mutation(internal.profilePhotoData.save, {
    profileId: owner.profileId,
    name: "Mira",
    bio: " Art ",
    photo,
  });
  expect(updated).toMatchObject({
    name: "Mira",
    bio: "Art",
    photoUrl: expect.any(String),
  });
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toEqual(updated);
  await owner.as.mutation(internal.profilePhotoData.save, {
    profileId: owner.profileId,
    name: "Mira",
    photo: null,
  });
  expect(await t.run((ctx) => ctx.storage.get(photo))).toBeNull();
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).not.toHaveProperty("photoUrl");
});

it("lists only accepted, available friends of the caller", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  const stranger = await socialUser(t);
  await befriend(owner, friend);
  await owner.as.mutation(api.friendships.request, {
    profileId: stranger.profileId,
    revision: 0,
  });
  expect((await owner.as.query(api.profiles.friends, {})).map((p) => p.profileId)).toEqual([friend.profileId]);
  expect(await stranger.as.query(api.profiles.friends, {})).toEqual([]);
  await expect(t.query(api.profiles.friends, {})).rejects.toThrow("unauthenticated");
});
