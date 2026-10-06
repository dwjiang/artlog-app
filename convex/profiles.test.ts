import { expect, it, vi } from "vitest";

import {
  validateLayout,
  validateMedia,
  validateReport,
  validateSelection,
  validateWallItems,
  validateProfile,
  validateGeography,
} from "../shared/social/contracts";
import { STARTER_WALLS } from "../shared/wall/defaults";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { projectArtwork, projectSharedVisitCard, projectWallArtwork } from "./lib/projections";
import { requirePublicWallItem, requireSharedVisit } from "./lib/publicationAccess";
import { befriend, type SocialUser, socialUser } from "./lib/socialTestFixtures";
import { seedDevice } from "./lib/testFactories";
import { harness } from "./test.helpers";

async function fixture() {
  const t = harness();
  async function account(sub: string) {
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
      /* bounded claim phases */
    }
    return { ...device, accountId, scope };
  }
  return { t, account };
}

it("requires Apple linkage; signing in alone creates no profile or publication", async () => {
  const { t, account } = await fixture();
  const anonymous = await seedDevice(t);
  await expect(
    anonymous.as.action(api.profiles.create, {
      username: "reader",
      name: "Reader",
    }),
  ).rejects.toMatchObject({ data: { code: "sign_in_required" } });
  await account("a");
  expect(await t.run((ctx) => ctx.db.query("profiles").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("walls").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toEqual([]);
});

it("starts a new profile on the painting it brings, and rejects an unknown one", async () => {
  const { account } = await fixture();
  const owner = await account("carried-avatar");
  await expect(
    owner.as.action(api.profiles.create, { username: "carried", name: "Carried", avatar: "retired-painting" }),
  ).rejects.toMatchObject({ data: { code: "invalid_profile" } });
  expect(
    await owner.as.action(api.profiles.create, { username: "carried", name: "Carried", avatar: "great-wave" }),
  ).toMatchObject({ avatar: "great-wave" });
});

it("persists a random starter color and design once when a profile is created", async () => {
  const { t, account } = await fixture();
  const owner = await account("starter-wall");
  const input = { username: "starter_wall", name: "Starter" };
  const profile = await owner.as.action(api.profiles.create, input);
  const first = await owner.as.query(api.walls.getMine, {});
  expect(first.items).toEqual([]);
  expect(first.revision).toBe(0);
  expect(STARTER_WALLS).toContainEqual({ color: first.color, pattern: first.pattern });
  expect(await t.query(api.walls.getPublic, { profileId: profile.profileId })).toMatchObject({
    color: first.color,
    pattern: first.pattern,
    items: [],
    artworkCount: 0,
  });
  await owner.as.mutation(api.walls.setLayout, {
    scope: owner.scope,
    revision: 0,
    color: "#6C2F2B",
    pattern: "grid",
    items: [],
  });
  await owner.as.action(api.profiles.create, input);
  expect(await owner.as.query(api.walls.getMine, {})).toMatchObject({ color: "#6C2F2B", pattern: "grid", revision: 1 });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("walls")
        .withIndex("by_profileId", (q) => q.eq("profileId", profile.profileId))
        .collect(),
    ),
  ).toHaveLength(1);
});

it("has one winner for simultaneous username requests and never replaces an existing profile username", async () => {
  const { account } = await fixture();
  const a = await account("a");
  const b = await account("b");
  const requests = await Promise.allSettled(
    [a, b].map((user) =>
      user.as.action(api.profiles.create, {
        username: "same_reader",
        name: " Reader ",
      }),
    ),
  );
  expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(requests.find((r) => r.status === "rejected")).toMatchObject({
    reason: { data: { code: "username_taken" } },
  });
  const winner = requests[0].status === "fulfilled" ? a : b;
  const again = await winner.as.action(api.profiles.create, {
    username: "new_name",
    name: "Other",
  });
  expect(again).toMatchObject({
    username: "same_reader",
    name: "Reader",
    publishedWallCount: 0,
  });
  expect(
    await winner.as.mutation(internal.profilePhotoData.save, {
      profileId: again.profileId,
      name: "New display",
      bio: " Short bio ",
    }),
  ).toMatchObject({
    username: "same_reader",
    name: "New display",
    bio: "Short bio",
  });
});

it("normalizes accents, case, and whitespace; paginates bounded public allowlists", async () => {
  const { t, account } = await fixture();
  const a = await account("a");
  const profile = await a.as.action(api.profiles.create, {
    username: "elodie_art",
    name: " Élodie  Martin ",
    bio: "Art",
  });
  const publicResult = await t.query(api.profiles.getPublic, {
    profileId: profile.profileId,
  });
  expect(Object.keys(publicResult!).sort()).toEqual([
    "avatar",
    "bio",
    "bioMentions",
    "name",
    "profileId",
    "publishedWallCount",
    "username",
  ]);
  const found = await t.query(api.profiles.search, {
    query: "  ÉLODiE  ",
    limit: 1,
  });
  expect(found.page).toEqual([profile]);
  expect((await t.query(api.profiles.search, { query: "é", limit: 1 })).page).toEqual([profile]);
  for (const query of [" ", "x".repeat(101)]) {
    await expect(t.query(api.profiles.search, { query })).rejects.toThrow("invalid_profile");
  }
  for (const page of [{ limit: 51 }, { cursor: "x".repeat(8193) }]) {
    await expect(t.query(api.profiles.search, { query: "elo", ...page })).rejects.toThrow("invalid_pagination");
  }
});

it.each(["ab", "abc-d", "Abcd", "a.bcd", "élodie", "a".repeat(31)])("rejects invalid username %s", async (username) => {
  const { account } = await fixture();
  const user = await account("a");
  await expect(user.as.action(api.profiles.create, { username, name: "Reader" })).rejects.toMatchObject({
    data: { code: "invalid_profile" },
  });
});

it.each([
  { username: "fuck_you", name: "Reader" },
  { username: "artlog_support", name: "Reader" },
  { username: "reader", name: "N1gger" },
  { username: "reader", name: "Artlog Team" },
])("refuses a name or username that is offensive or poses as staff: %o", async (input) => {
  const { account } = await fixture();
  const user = await account("a");
  await expect(user.as.action(api.profiles.create, input)).rejects.toMatchObject({
    data: { code: "profile_not_allowed" },
  });
  const profile = await user.as.action(api.profiles.create, { username: "dick_van_dyke", name: "Dick Van Dyke" });
  expect(profile).toMatchObject({ username: "dick_van_dyke" });
  await expect(
    user.as.mutation(internal.profilePhotoData.save, { profileId: profile.profileId, ...input }),
  ).rejects.toMatchObject({ data: { code: "profile_not_allowed" } });
});

it("lets OpenAI judge bios when creating and editing a profile, with the word list as fallback", async () => {
  const { account } = await fixture();
  const user = await account("a");
  await expect(
    user.as.action(api.profiles.create, { username: "reader", name: "Reader", bio: "shit art only" }),
  ).rejects.toMatchObject({ data: { code: "profile_not_allowed" } });
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const [bio] = JSON.parse(String(init?.body)).input as string[];
    return Response.json({ results: [{ flagged: bio.includes("hate") }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const hateful = "I hate people like you";
    await expect(
      user.as.action(api.profiles.create, { username: "reader", name: "Reader", bio: hateful }),
    ).rejects.toMatchObject({ data: { code: "profile_not_allowed" } });
    await user.as.action(api.profiles.create, { username: "reader", name: "Reader" });
    await expect(user.as.action(api.profilePhotos.save, { name: "Reader", bio: hateful })).rejects.toMatchObject({
      data: { code: "profile_not_allowed" },
    });
    const bio = "Writing about the vagina imagery in The Dinner Party";
    await expect(user.as.action(api.profilePhotos.save, { name: "Reader", bio })).resolves.toMatchObject({ bio });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("deletion revokes profile and publication access immediately", async () => {
  const { t, account } = await fixture();
  const user = await account("a");
  const profile = await user.as.action(api.profiles.create, {
    username: "reader",
    name: "Reader",
  });
  const postId = crypto.randomUUID();
  await t.run(async (ctx) => {
    const venueId = await ctx.db.insert("museums", {
      key: "v",
      name: "Museum",
      lat: 0,
      lng: 0,
      seedSource: "manual",
      region: "US",
      optOut: false,
      contributionRevision: 0,
    });
    const localId = crypto.randomUUID();
    const visitId = await ctx.db.insert("visits", {
      visibility: "public" as const,
      owner: { kind: "account", accountId: user.accountId },
      localId,
      venueId,
      venueName: "Museum",
      visitedOn: "2026-09-01",
      timeZone: "UTC",
      updatedAt: 1,
      updatedBy: user.deviceId,
      changeVersion: 1,
    });
    await ctx.db.insert("sharedVisits", {
      audience: "public",
      postId,
      profileId: profile.profileId,
      visitId,
      visitLocalId: localId,
      visitedOn: "2026-09-01",
      status: "active",
      reflection: "",
      publishedAt: 1,
      updatedAt: 1,
      publicationRevision: 0,
    });
  });
  expect(await t.run((ctx) => requireSharedVisit(ctx, postId, profile.profileId))).toMatchObject({
    publication: { postId },
  });
  await user.as.mutation(api.accounts.deleteAccount, {});
  expect(await t.query(api.profiles.getPublic, { profileId: profile.profileId })).toBeNull();
  expect((await t.query(api.profiles.search, { query: "reader" })).page).toEqual([]);
  await expect(t.run((ctx) => requireSharedVisit(ctx, postId, profile.profileId))).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});

it("projects only permitted artwork fields, no artwork notes on shared cards, and a square placeholder", () => {
  const save = {
    snapshot: {
      title: "Work",
      artist: "Artist",
      date: "1900",
      medium: "Oil",
      institution: "Private context",
    },
    localId: "private-save",
    note: "Private note",
    cropStorageId: "private-storage",
    scanId: "private-scan",
  } as never;
  const artwork = projectArtwork(save);
  expect(artwork).toEqual({
    title: "Work",
    artist: "Artist",
    date: "1900",
    medium: "Oil",
    media: { kind: "placeholder", width: 1, height: 1 },
  });
  expect(projectSharedVisitCard({ _id: "item" } as never, save)).toEqual({
    itemId: "item",
    artwork,
  });
  expect(projectWallArtwork({ _id: "wall", noteVisible: false, layout: {} } as never, save)).not.toHaveProperty("note");
  expect(projectWallArtwork({ _id: "wall", noteVisible: true, layout: {} } as never, save)).toHaveProperty(
    "note",
    "Private note",
  );
});

it("invalidates reverse save references, consent and revisions while keeping the visit and empty post", async () => {
  const { t, account } = await fixture();
  const user = await account("a");
  const profile = await user.as.action(api.profiles.create, {
    username: "reader",
    name: "Reader",
  });
  const ids = await t.run(async (ctx) => {
    const venueId = await ctx.db.insert("museums", {
      key: "v",
      name: "Museum",
      lat: 0,
      lng: 0,
      seedSource: "manual",
      region: "US",
      optOut: false,
      contributionRevision: 0,
    });
    const visitId = await ctx.db.insert("visits", {
      visibility: "public" as const,
      owner: { kind: "account", accountId: user.accountId },
      localId: crypto.randomUUID(),
      venueId,
      venueName: "Museum",
      visitedOn: "2026-09-01",
      timeZone: "UTC",
      updatedAt: 1,
      updatedBy: user.deviceId,
      changeVersion: 1,
    });
    const localId = crypto.randomUUID();
    const saveId = await ctx.db.insert("collections", {
      owner: { kind: "account", accountId: user.accountId },
      localId,
      snapshot: { title: "Work", artist: "" },
      savedAt: 1,
      note: "Note",
      updatedAt: 1,
      updatedBy: user.deviceId,
      changeVersion: 2,
    });
    const wall = await ctx.db
      .query("walls")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile.profileId))
      .unique();
    const wallId = wall!._id;
    await ctx.db.patch("walls", wallId, { color: "#fff", layoutRevision: 3 });
    const itemId = await ctx.db.insert("wallItems", {
      wallId,
      profileId: profile.profileId,
      saveId,
      placementId: localId,
      saveLocalId: localId,
      active: true,
      noteVisible: true,
      noteRevision: 2,
      layout: { x: 0, y: 0, width: 1, layer: 0, frame: "black" },
    });
    const post = await ctx.db.insert("sharedVisits", {
      audience: "public",
      profileId: profile.profileId,
      visitId,
      visitLocalId: "visit",
      postId: crypto.randomUUID(),
      visitedOn: "2026-09-01",
      status: "active",
      reflection: "",
      publishedAt: 1,
      updatedAt: 1,
      publicationRevision: 5,
    });
    await ctx.db.insert("sharedVisitItems", {
      publicationId: post,
      saveId,
      saveLocalId: localId,
      position: 0,
    });
    await ctx.db.patch("profiles", profile.profileId, { publishedWallCount: 1 });
    return { localId, visitId, wallId, itemId, post };
  });
  await user.as.mutation(api.collections.remove, {
    scope: user.scope,
    localId: ids.localId,
  });
  await expect(t.run((ctx) => requirePublicWallItem(ctx, ids.itemId))).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  expect(await t.run((ctx) => ctx.db.get("wallItems", ids.itemId))).toMatchObject({
    active: false,
    noteVisible: false,
    noteRevision: 3,
  });
  expect(await t.run((ctx) => ctx.db.get("walls", ids.wallId))).toMatchObject({
    layoutRevision: 4,
  });
  expect(await t.run((ctx) => ctx.db.get("sharedVisits", ids.post))).toMatchObject({
    publicationRevision: 6,
    status: "active",
  });
  expect(await t.run((ctx) => ctx.db.get("visits", ids.visitId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.query("sharedVisitItems").collect())).toEqual([]);
});

it("validates shared layout, dimensions, and reporting boundaries", () => {
  expect(() => validateLayout({ x: 0, y: 3, width: 0.5, layer: 2, frame: "oak" })).not.toThrow();
  for (const width of [0, -1, 2, Infinity]) {
    expect(() => validateLayout({ x: 0, y: 0, width, layer: 0, frame: "black" })).toThrow("invalid_wall");
  }
  expect(() =>
    validateMedia({
      kind: "catalog",
      url: "https://museum.test/art",
      sourceUrl: "https://museum.test",
      rights: "public_domain",
      width: 0,
      height: 2,
    }),
  ).toThrow("invalid_media");
  expect(() =>
    validateReport({
      target: { kind: "profile", profileId: "profile" as never },
      reason: "other",
      details: " ",
    }),
  ).toThrow("invalid_report");
});

it("publishes eligible media with an allowlist and binds derivatives to a public context", () => {
  const save = {
    _id: "save",
    snapshot: { title: "Work", artist: "Artist" },
  } as never;
  const source = {
    kind: "catalog",
    url: "https://museum.example/image.jpg",
    sourceUrl: "https://museum.example/art",
    rights: "public_domain",
    width: 800,
    height: 600,
    owner: "private",
    storageId: "private",
  };
  const asset = { saveId: "save", storageId: "private-storage", source };
  expect(projectArtwork(save, asset as never).media).toEqual({
    kind: "catalog",
    url: source.url,
    sourceUrl: source.sourceUrl,
    rights: source.rights,
    width: 800,
    height: 600,
  });
  for (const url of [
    "https://dev.convex.cloud/api/storage/private",
    "https://app.example/collection-photos?localId=private",
  ]) {
    expect(projectArtwork(save, { ...asset, source: { ...source, url } } as never).media.kind).toBe("placeholder");
  }
  const derivative = {
    ...asset,
    source: {
      kind: "derivative",
      rights: "contributor_consent",
      width: 128,
      height: 256,
      url: "https://private.example/raw",
    },
  } as never;
  expect(projectArtwork(save, derivative).media.kind).toBe("placeholder");
  const projected = projectWallArtwork({ _id: "wall-item", layout: {}, noteVisible: false } as never, save, derivative);
  expect(projected.artwork.media).toMatchObject({
    kind: "derivative",
    reference: { kind: "wallItem", itemId: "wall-item" },
  });
  expect(JSON.stringify(projected)).not.toContain("private");
  expect(projectArtwork(save, { ...asset, saveId: "other" } as never).media.kind).toBe("placeholder");
  expect(projectArtwork(save, { ...asset, revokedAt: 1 } as never).media.kind).toBe("placeholder");
});

it("enforces shared selection, profile, and geography boundaries", () => {
  const id = crypto.randomUUID();
  expect(() =>
    validateSelection({
      audience: "public",
      saveLocalIds: [id],
      reflection: "",
      revision: 0,
      color: "#cdd0ca",
      companionIds: [],
    }),
  ).not.toThrow();
  const friend = "friend" as Id<"profiles">;
  for (const input of [
    { saveLocalIds: [id, id], reflection: "", revision: 0 },
    { saveLocalIds: [], reflection: "", revision: 0, companionIds: [friend, friend] },
    {
      saveLocalIds: [],
      reflection: "",
      revision: 0,
      companionIds: Array.from({ length: 11 }, (_, index) => `friend-${index}` as Id<"profiles">),
    },
    { saveLocalIds: [], reflection: "x".repeat(20_001), revision: 0 },
    { saveLocalIds: ["bad"], reflection: "", revision: 0 },
    { saveLocalIds: [], reflection: "", revision: -1 },
    { saveLocalIds: [], reflection: "", revision: 0, color: "sage" },
  ]) {
    expect(() => validateSelection({ color: "#CDD0CA", companionIds: [], ...input, audience: "public" })).toThrow(
      "invalid_post",
    );
  }
  expect(() => validateWallItems([], Infinity)).toThrow("invalid_wall");
  for (const input of [{ name: " " }, { name: "x".repeat(61) }, { name: "Reader", bio: "x".repeat(161) }]) {
    expect(() => validateProfile(input)).toThrow("invalid_profile");
  }
  expect(() => validateGeography({})).not.toThrow();
  expect(() => validateGeography({ city: "Reykjavík", country: "IS" })).not.toThrow();
  for (const input of [{ city: "x".repeat(121) }, { country: "ZZ" }, { country: "usa" }]) {
    expect(() => validateGeography(input)).toThrow("invalid_venue");
  }
});

it("checks username availability for an account without reserving it", async () => {
  const { t, account } = await fixture();
  const a = await account("availability-a");
  const b = await account("availability-b");
  expect(
    await a.as.query(api.profiles.usernameAvailable, {
      username: "available_name",
    }),
  ).toBe(true);
  await b.as.action(api.profiles.create, {
    username: "available_name",
    name: "B",
  });
  expect(
    await a.as.query(api.profiles.usernameAvailable, {
      username: "available_name",
    }),
  ).toBe(false);
  await expect(a.as.query(api.profiles.usernameAvailable, { username: "Invalid_Name" })).rejects.toThrow(
    "invalid_profile",
  );
  await expect(t.query(api.profiles.usernameAvailable, { username: "available_name" })).rejects.toThrow(
    "unauthenticated",
  );
});

it("suggests the first free username for a display name without reserving it", async () => {
  const { t, account } = await fixture();
  const a = await account("suggest-a");
  const b = await account("suggest-b");
  expect(await a.as.query(api.profiles.suggestUsername, { name: " Élodie Martin " })).toBe("elodie_martin");
  await b.as.action(api.profiles.create, { username: "elodie_martin", name: "B" });
  expect(await a.as.query(api.profiles.suggestUsername, { name: "Élodie Martin" })).toBe("elodie_martin_2");
  expect(await a.as.query(api.profiles.suggestUsername, { name: "张伟" })).toBeNull();
  expect(await a.as.query(api.profiles.suggestUsername, { name: "x".repeat(61) })).toBeNull();
  await expect(t.query(api.profiles.suggestUsername, { name: "Élodie Martin" })).rejects.toThrow("unauthenticated");
});

it("lists incoming requests only, removing accepted and blocked connections", async () => {
  const { t, account } = await fixture();
  const a = await account("requests-a");
  const b = await account("requests-b");
  const c = await account("requests-c");
  const pa = await a.as.action(api.profiles.create, {
    name: "A",
    username: "requests_a",
  });
  const pb = await b.as.action(api.profiles.create, {
    name: "B",
    username: "requests_b",
  });
  const pc = await c.as.action(api.profiles.create, {
    name: "C",
    username: "requests_c",
  });
  await b.as.mutation(api.friendships.request, {
    profileId: pa.profileId,
    revision: 0,
  });
  await a.as.mutation(api.friendships.request, {
    profileId: pc.profileId,
    revision: 0,
  });
  expect(await a.as.query(api.profiles.requests, {})).toEqual([
    {
      ...pb,
      relationship: {
        state: "pending",
        revision: 1,
        requesterId: pb.profileId,
        blocked: false,
        blockRevision: 0,
      },
    },
  ]);
  expect(await b.as.query(api.profiles.requests, {})).toEqual([]);
  await a.as.mutation(api.friendships.accept, {
    profileId: pb.profileId,
    revision: 1,
  });
  expect(await a.as.query(api.profiles.requests, {})).toEqual([]);
  await c.as.mutation(api.friendships.block, {
    scope: c.scope,
    profileId: pa.profileId,
  });
  expect(await c.as.query(api.profiles.requests, {})).toEqual([]);
  await expect(t.query(api.profiles.requests, {})).rejects.toThrow("unauthenticated");
});

it("lists a person’s friends with the viewer’s relationship, leaving out blocked people", async () => {
  const t = harness();
  const jamie = await socialUser(t, "Jamie");
  const viewer = await socialUser(t, "Ada");
  const mutual = await socialUser(t, "Ben");
  const other = await socialUser(t, "Cy");
  const hidden = await socialUser(t, "Dee");
  const requester = await socialUser(t, "Eve");
  for (const friend of [viewer, mutual, other, hidden]) await befriend(jamie, friend);
  await befriend(viewer, mutual);
  await requester.as.mutation(api.friendships.request, { profileId: jamie.profileId, revision: 0 });
  await viewer.as.mutation(api.friendships.block, { scope: viewer.scope, profileId: hidden.profileId });
  const friendsOf = async (user: SocialUser, profileId = jamie.profileId) => {
    const people = await user.as.query(api.profiles.friends, { profileId });
    return people === null ? null : people.map((p) => [p.name, p.relationship?.state]);
  };

  expect(await friendsOf(viewer)).toEqual([
    ["Ada", undefined],
    ["Ben", "accepted"],
    ["Cy", "none"],
  ]);
  expect(await friendsOf(jamie)).toEqual([
    ["Ada", "accepted"],
    ["Ben", "accepted"],
    ["Cy", "accepted"],
    ["Dee", "accepted"],
  ]);
  expect(await friendsOf(requester, requester.profileId)).toEqual([]);

  // A block in either direction hides the whole list, as it hides the wall.
  await jamie.as.mutation(api.friendships.block, { scope: jamie.scope, profileId: requester.profileId });
  expect(await friendsOf(requester)).toBeNull();
  expect(await friendsOf(jamie, requester.profileId)).toBeNull();
  await expect(t.query(api.profiles.friends, { profileId: jamie.profileId })).rejects.toThrow("unauthenticated");
});

it("excludes the viewer's saved dismissals from discovery recommendations and supports Undo", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const otherViewer = await socialUser(t, "other_viewer");
  const monica = await socialUser(t, "Monica");
  const input = { excludeDismissed: true, limit: 10 };
  const containsMonica = (result: { page: { profileId: string }[] }) =>
    result.page.some((person) => person.profileId === monica.profileId);
  expect(containsMonica(await viewer.as.query(api.profiles.discover, input))).toBe(true);

  await viewer.as.mutation(api.suggestions.dismiss, { profileId: monica.profileId });

  expect(containsMonica(await viewer.as.query(api.profiles.discover, input))).toBe(false);
  expect(containsMonica(await otherViewer.as.query(api.profiles.discover, input))).toBe(true);
  expect(containsMonica(await t.query(api.profiles.discover, input))).toBe(true);
  expect(containsMonica(await viewer.as.query(api.profiles.discover, {}))).toBe(true);
  expect(containsMonica(await viewer.as.query(api.profiles.search, { query: "Monica" }))).toBe(true);

  await viewer.as.mutation(api.suggestions.restore, { profileId: monica.profileId });
  expect(containsMonica(await viewer.as.query(api.profiles.discover, input))).toBe(true);
});

it("embeds the viewer’s relationship in browse lists and leaves guests without one", async () => {
  const { t, account } = await fixture();
  const a = await account("browse-a");
  const b = await account("browse-b");
  const pa = await a.as.action(api.profiles.create, {
    name: "A",
    username: "browse_a",
  });
  const pb = await b.as.action(api.profiles.create, {
    name: "B",
    username: "browse_b",
  });
  await b.as.mutation(api.friendships.request, {
    profileId: pa.profileId,
    revision: 0,
  });
  const seen = (page: { profileId: string; relationship?: object }[]) =>
    Object.fromEntries(page.map((row) => [row.profileId, row.relationship]));
  expect(seen((await a.as.query(api.profiles.discover, {})).page)).toEqual({
    [pa.profileId]: undefined,
    [pb.profileId]: {
      state: "pending",
      revision: 1,
      requesterId: pb.profileId,
      blocked: false,
      blockRevision: 0,
    },
  });
  expect(seen((await a.as.query(api.profiles.search, { query: "browse" })).page)).toMatchObject({
    [pb.profileId]: { state: "pending" },
  });
  expect(seen((await t.query(api.profiles.discover, {})).page)).toEqual({
    [pa.profileId]: undefined,
    [pb.profileId]: undefined,
  });
});
