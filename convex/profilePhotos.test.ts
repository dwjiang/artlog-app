import { expect, it } from "vitest";

import { defaultAvatar } from "../shared/social/avatars";
import { api, internal } from "./_generated/api";
import { fileStorage } from "./lib/fileStorage";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

it("updates only the authenticated profile and deletes replaced public photos", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await socialUser(t);
  const photo = await t.run((ctx) => fileStorage.store(ctx, new Blob(["photo"], { type: "image/jpeg" })));
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
  expect(await t.run((ctx) => fileStorage.get(ctx, photo))).toBeNull();
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).not.toHaveProperty("photoUrl");
});

it("shows a default painting until the owner picks one, and a picked painting replaces the photo", async () => {
  const t = harness();
  const owner = await socialUser(t);
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toMatchObject({
    avatar: defaultAvatar(owner.profileId),
  });
  const photo = await t.run((ctx) => fileStorage.store(ctx, new Blob(["photo"], { type: "image/jpeg" })));
  await owner.as.mutation(internal.profilePhotoData.save, { profileId: owner.profileId, name: "Mira", photo });
  const picked = await owner.as.mutation(internal.profilePhotoData.save, {
    profileId: owner.profileId,
    name: "Mira",
    avatar: "klee",
    photo: null,
  });
  expect(picked.avatar).toBe("klee");
  expect(picked).not.toHaveProperty("photoUrl");
  expect(await t.run((ctx) => fileStorage.get(ctx, photo))).toBeNull();
  await owner.as.mutation(internal.profilePhotoData.save, { profileId: owner.profileId, name: "Mira M" });
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toMatchObject({
    name: "Mira M",
    avatar: "klee",
  });
  await expect(
    owner.as.mutation(internal.profilePhotoData.save, {
      profileId: owner.profileId,
      name: "Mira",
      avatar: "retired-painting",
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_profile" } });
});

it("renames the profile, releases the old username, and rejects a taken or invalid one", async () => {
  const t = harness();
  const owner = await socialUser(t, "Mira");
  const other = await socialUser(t, "Theo");
  expect(
    await owner.as.mutation(internal.profilePhotoData.save, {
      profileId: owner.profileId,
      name: "Mira",
      username: "miralooks",
    }),
  ).toMatchObject({ username: "miralooks", name: "Mira" });
  expect((await t.query(api.profiles.search, { query: "miralooks" })).page.map((p) => p.profileId)).toEqual([
    owner.profileId,
  ]);
  await expect(
    other.as.mutation(internal.profilePhotoData.save, {
      profileId: other.profileId,
      name: "Theo",
      username: "miralooks",
    }),
  ).rejects.toMatchObject({ data: { code: "username_taken" } });
  expect(
    await other.as.mutation(internal.profilePhotoData.save, {
      profileId: other.profileId,
      name: "Theo",
      username: "u_mira",
    }),
  ).toMatchObject({ username: "u_mira" });
  expect(
    await owner.as.mutation(internal.profilePhotoData.save, {
      profileId: owner.profileId,
      name: "Mira M",
      username: "miralooks",
    }),
  ).toMatchObject({ username: "miralooks", name: "Mira M" });
  await expect(
    owner.as.mutation(internal.profilePhotoData.save, {
      profileId: owner.profileId,
      name: "Mira",
      username: "Mira_Looks",
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_profile" } });
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
