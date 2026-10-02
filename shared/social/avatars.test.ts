import { AVATAR_GROUPS, AVATARS, defaultAvatar, isAvatarId } from "./avatars";

it("gives every preset a unique id inside a known group", () => {
  expect(new Set(AVATARS.map((avatar) => avatar.id)).size).toBe(AVATARS.length);
  expect(new Set(AVATARS.map((avatar) => avatar.group))).toEqual(new Set(AVATAR_GROUPS));
  expect(isAvatarId("vermeer")).toBe(true);
  expect(isAvatarId("retired-painting")).toBe(false);
});

it("keeps a person's default painting stable and spreads similar profile IDs across the set", () => {
  // Convex IDs of profiles created together share long prefixes.
  const ids = Array.from({ length: 720 }, (_, index) => `j57a9c${index.toString(36).padStart(4, "0")}xk2`);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(defaultAvatar(id), (counts.get(defaultAvatar(id)) ?? 0) + 1);
  expect(defaultAvatar(ids[0])).toBe(defaultAvatar(ids[0]));
  expect(counts.size).toBe(AVATARS.length);
  expect(Math.max(...counts.values())).toBeLessThan((ids.length / AVATARS.length) * 2);
});
