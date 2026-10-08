import { afterEach, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = harness();
  const owner = await socialUser(t);
  const outsider = await socialUser(t);
  const first = await socialVisit(t, owner, 1);
  const second = await socialVisit(t, owner, 0);
  const savedLocalId = first.saves[0].localId;
  const photos = ["full", "detail", "label"].map((kind, i) => ({
    localId: crypto.randomUUID(),
    savedLocalId,
    kind: kind as "full" | "detail" | "label",
    capturedAt: i + 1,
    visitLocalId: first.visit.localId,
  }));
  const encounters = [first.visit, second.visit].map((visit) => ({
    savedLocalId,
    visitLocalId: visit.localId,
    // Builds from before artwork notes were removed still send one.
    note: "PRIVATE ENCOUNTER NOTE",
  }));
  const input = { scope: owner.scope, since: 0, photos, encounters };
  return { t, owner, outsider, first, second, photos, input };
}

it("syncs three private photos and two unique encounters on one artwork", async () => {
  const { owner, input } = await fixture();
  const first = await owner.as.mutation(api.artworkAlbums.sync, input);
  expect(first.photos).toHaveLength(3);
  expect(first.encounters).toHaveLength(2);
  for (const row of first.encounters) expect(row).not.toHaveProperty("note");
  expect(first.saves).toHaveLength(1);
  const repeated = await owner.as.mutation(api.artworkAlbums.sync, input);
  expect(repeated.photos).toHaveLength(3);
  expect(repeated.encounters).toHaveLength(2);
  expect(repeated.checkpoint).toBe(first.checkpoint);
});

it("rejects foreign parents and never returns another owner’s album", async () => {
  const { owner, outsider, input } = await fixture();
  await owner.as.mutation(api.artworkAlbums.sync, input);
  await expect(
    outsider.as.mutation(api.artworkAlbums.sync, {
      ...input,
      scope: outsider.scope,
    }),
  ).rejects.toThrow("not_found");
  expect(
    (
      await outsider.as.mutation(api.artworkAlbums.sync, {
        scope: outsider.scope,
        since: 0,
        photos: [],
        encounters: [],
      })
    ).photos,
  ).toEqual([]);
});

it("assigns unvisited photos once and preserves that assignment through stale and competing syncs", async () => {
  const { t, owner, outsider, first, second, photos, input } = await fixture();
  const photo = { ...photos[0], visitLocalId: undefined };
  const sync = (next: typeof photo | (typeof photos)[number], since = 0) =>
    owner.as.mutation(api.artworkAlbums.sync, { ...input, since, photos: [next], encounters: [] });
  await sync(photo);
  const assigned = await sync({ ...photo, visitLocalId: second.visit.localId });
  expect(assigned.photos[0].visitLocalId).toBe(second.visit.localId);
  const stale = await sync(photo, assigned.checkpoint);
  expect(stale.photos[0].visitLocalId).toBe(second.visit.localId);
  const competing = await sync({ ...photo, visitLocalId: first.visit.localId }, stale.checkpoint);
  expect(competing.photos[0].visitLocalId).toBe(second.visit.localId);
  await expect(sync({ ...photo, capturedAt: photo.capturedAt + 1 })).rejects.toThrow("invalid_photo");
  const foreign = await socialVisit(t, outsider, 0);
  await expect(sync({ ...photo, visitLocalId: foreign.visit.localId })).rejects.toThrow("not_found");
});

it("makes a recovered photo available for explicit sharing in its assigned visit", async () => {
  const { owner, second, photos, input } = await fixture();
  const photo = { ...photos[0], visitLocalId: undefined };
  await owner.as.mutation(api.artworkAlbums.sync, { ...input, photos: [photo], encounters: [] });
  const upload = await owner.as.fetch(
    `/collection-photo?scope=${encodeURIComponent(owner.scope)}&localId=${photo.savedLocalId}&photoId=${photo.localId}&kind=photo`,
    { method: "POST", body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), headers: { "Content-Type": "image/jpeg" } },
  );
  expect(upload.status).toBe(200);
  const recovered = await owner.as.mutation(api.artworkAlbums.sync, {
    ...input,
    photos: [{ ...photo, visitLocalId: second.visit.localId }],
    encounters: [{ savedLocalId: photo.savedLocalId, visitLocalId: second.visit.localId }],
  });
  expect(recovered.visits).toContainEqual(expect.objectContaining({ localId: second.visit.localId }));
  const published = await owner.as.action(api.sharedVisits.publish, {
    ...second.selection,
    saveLocalIds: [photo.savedLocalId],
    photoSelections: [{ saveLocalId: photo.savedLocalId, photoLocalIds: [photo.localId] }],
  });
  const post = await owner.as.query(api.sharedVisits.get, { postId: published.postId! });
  expect(post.artworks.page[0].photos).toHaveLength(1);
});

it("serves each private photo only to its owner and revokes bytes when the artwork is deleted", async () => {
  vi.useFakeTimers();
  const { t, owner, outsider, first, photos, input } = await fixture();
  await owner.as.mutation(api.artworkAlbums.sync, input);
  const path = (scope: string) =>
    `/collection-photo?scope=${encodeURIComponent(scope)}&localId=${first.saves[0].localId}&photoId=${photos[0].localId}&kind=photo`;
  const uploaded = await owner.as.fetch(path(owner.scope), {
    method: "POST",
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    headers: { "Content-Type": "image/jpeg" },
  });
  expect(uploaded.status).toBe(200);
  expect((await owner.as.fetch(path(owner.scope))).status).toBe(200);
  expect((await outsider.as.fetch(path(outsider.scope))).status).toBe(404);
  await owner.as.mutation(api.collections.remove, {
    scope: owner.scope,
    localId: first.saves[0].localId,
  });
  expect((await owner.as.fetch(path(owner.scope))).status).toBe(404);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("files")
        .collect()
        .then((files) => files.filter((file) => file.state === "ready")),
    ),
  ).toEqual([]);
  const deleted = await owner.as.mutation(api.artworkAlbums.sync, {
    ...input,
    photos: [],
    encounters: [],
  });
  expect(deleted.photos.every((row) => row.deletedAt !== undefined)).toBe(true);
  expect(deleted.encounters.every((row) => row.deletedAt !== undefined)).toBe(true);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it("publishes only explicitly selected photos, permits repeated wall placements, and revokes deleted photos", async () => {
  const { t, owner, first, photos, input } = await fixture();
  await owner.as.mutation(api.artworkAlbums.sync, input);
  for (const photo of photos) {
    const response = await owner.as.fetch(
      `/collection-photo?scope=${encodeURIComponent(owner.scope)}&localId=${photo.savedLocalId}&photoId=${photo.localId}&kind=photo`,
      {
        method: "POST",
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        headers: { "Content-Type": "image/jpeg" },
      },
    );
    expect(response.status).toBe(200);
  }
  const items = photos.slice(0, 2).map((photo, i) => ({
    placementId: crypto.randomUUID(),
    saveLocalId: photo.savedLocalId,
    photoLocalId: photo.localId,
    layout: { x: i * 0.4, y: 0, width: 0.3, layer: i, frame: "oak" as const },
  }));
  const wall = await owner.as.mutation(api.walls.setLayout, {
    scope: owner.scope,
    revision: 0,
    color: "#45524B",
    items,
  });
  expect(wall.items).toHaveLength(2);
  const url = (photoId: string) =>
    `/display-media?kind=wallItem&itemId=${wall.items[0].itemId}&photoLocalId=${photoId}`;
  expect((await t.fetch(url(photos[0].localId))).status).toBe(200);
  expect((await t.fetch(url(photos[2].localId))).status).toBe(404);
  const published = await owner.as.action(api.sharedVisits.publish, {
    ...first.selection,
    photoSelections: [
      {
        saveLocalId: photos[0].savedLocalId,
        photoLocalIds: [photos[0].localId],
      },
    ],
  });
  const post = await owner.as.query(api.sharedVisits.get, {
    postId: published.postId!,
  });
  expect(post.artworks.page[0].photos).toHaveLength(1);
  expect(JSON.stringify(post)).not.toMatch(/PRIVATE|caption|capturedAt|storageId/);
  await owner.as.mutation(api.artworkAlbums.sync, {
    ...input,
    photos: [{ ...photos[0], deletedAt: Date.now() }],
    encounters: [],
  });
  expect((await t.fetch(url(photos[0].localId))).status).toBe(404);
  const remainingWall = await owner.as.query(api.walls.getMine, {});
  expect(remainingWall.items).toHaveLength(1);
  expect(remainingWall.revision).toBe(2);
  expect(await owner.as.query(api.profiles.getPublic, { profileId: owner.profileId })).toMatchObject({
    publishedWallCount: 1,
  });
  expect((await owner.as.query(api.sharedVisits.get, { postId: published.postId! })).artworks.page).toEqual([]);
});

it("merges only on explicit owner request and preserves photos and encounters", async () => {
  const { t, owner, outsider, first, second, input } = await fixture();
  await owner.as.mutation(api.artworkAlbums.sync, input);
  const target = await socialVisit(t, owner, 1);
  await owner.as.mutation(api.walls.setLayout, {
    scope: owner.scope,
    revision: 0,
    color: "#45524B",
    items: [
      {
        placementId: crypto.randomUUID(),
        saveLocalId: target.saves[0].localId,
        layout: { x: 0, y: 0, width: 0.3, layer: 0, frame: "oak" },
      },
    ],
  });
  const args = {
    scope: owner.scope,
    sourceLocalId: first.saves[0].localId,
    targetLocalId: target.saves[0].localId,
  };
  await expect(
    outsider.as.mutation(api.artworkAlbums.merge, {
      ...args,
      scope: outsider.scope,
    }),
  ).rejects.toThrow("not_found");
  const result = await owner.as.mutation(api.artworkAlbums.merge, args);
  expect(result.photos.filter((row) => row.savedLocalId === target.saves[0].localId)).toHaveLength(3);
  expect(
    result.encounters.filter((row) => row.savedLocalId === target.saves[0].localId && row.deletedAt === undefined),
  ).toHaveLength(2);
  expect(result.saves[0].deletedAt).toBeDefined();
  expect(await t.run((ctx) => ctx.db.get("visits", second.visit._id))).not.toBeNull();
});

it("reuses capacity after deletion and refuses moving a photo into a full album", async () => {
  const { t, owner, first, photos, input } = await fixture();
  await owner.as.mutation(api.artworkAlbums.sync, input);
  const target = await socialVisit(t, owner, 1);
  const targetPhotos = Array.from({ length: 100 }, () => crypto.randomUUID());
  await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", target.saves[0].id))!;
    for (const localId of targetPhotos) {
      await ctx.db.insert("artworkPhotos", {
        owner: save.owner,
        saveId: save._id,
        savedLocalId: save.localId,
        localId,
        kind: "full",
        capturedAt: 1,
        updatedAt: 1,
        changeVersion: 1,
      });
    }
  });
  const moved = { ...photos[0], savedLocalId: target.saves[0].localId };
  await expect(
    owner.as.mutation(api.artworkAlbums.sync, {
      ...input,
      photos: [moved],
      encounters: [],
    }),
  ).rejects.toThrow("album_full");
  await owner.as.mutation(api.artworkAlbums.sync, {
    ...input,
    photos: [
      {
        localId: targetPhotos[0],
        savedLocalId: target.saves[0].localId,
        kind: "full",
        capturedAt: 1,
        deletedAt: 2,
      },
    ],
    encounters: [],
  });
  await owner.as.mutation(api.artworkAlbums.sync, {
    ...input,
    photos: [moved],
    encounters: [],
  });
  const rows = await t.run((ctx) => ctx.db.query("artworkPhotos").collect());
  expect(rows.filter((row) => row.saveId === target.saves[0].id && row.deletedAt === undefined)).toHaveLength(100);
  expect(rows.filter((row) => row.saveId === first.saves[0].id && row.deletedAt === undefined)).toHaveLength(2);
});

it("merges and deletes live photos even after more than 100 older photos were deleted", async () => {
  const { t, owner, first, input } = await fixture();
  await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", first.saves[0].id))!;
    for (let i = 0; i < 110; i++) {
      await ctx.db.insert("artworkPhotos", {
        owner: save.owner,
        saveId: save._id,
        savedLocalId: save.localId,
        localId: crypto.randomUUID(),
        kind: "full",
        capturedAt: 1,
        deletedAt: 2,
        updatedAt: 2,
        changeVersion: 1,
      });
    }
  });
  await owner.as.mutation(api.artworkAlbums.sync, input);
  const target = await socialVisit(t, owner, 1);
  const result = await owner.as.mutation(api.artworkAlbums.merge, {
    scope: owner.scope,
    sourceLocalId: first.saves[0].localId,
    targetLocalId: target.saves[0].localId,
  });
  expect(result.photos.filter((row) => row.saveId === target.saves[0].id && row.deletedAt === undefined)).toHaveLength(
    3,
  );
  await owner.as.mutation(api.collections.remove, {
    scope: owner.scope,
    localId: target.saves[0].localId,
  });
  expect(
    (await t.run((ctx) => ctx.db.query("artworkPhotos").collect())).every((row) => row.deletedAt !== undefined),
  ).toBe(true);
});
