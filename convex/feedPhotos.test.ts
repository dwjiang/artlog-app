// @vitest-environment node
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness, type Harness } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Noise keeps the JPEG from compressing to almost nothing, like a camera photo.
const jpeg = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
const runScheduled = (t: Harness) => t.finishAllScheduledFunctions(vi.runAllTimers);
const workRuns = (t: Harness) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name === "feedPhotosPrepare:work",
    ),
  );

async function sharedPhotoFixture({ width = 600, height = 1200 } = {}) {
  const t = harness();
  const owner = await socialUser(t);
  const viewer = await socialUser(t);
  const draft = await socialVisit(t, owner, 1);
  const save = draft.saves[0];
  const photo = {
    localId: crypto.randomUUID(),
    savedLocalId: save.localId,
    kind: "full" as const,
    capturedAt: 1,
    visitLocalId: draft.visit.localId,
  };
  const syncPhoto = (input: typeof photo & { deletedAt?: number } = photo) =>
    owner.as.mutation(api.artworkAlbums.sync, { scope: owner.scope, since: 0, photos: [input], encounters: [] });
  await syncPhoto();
  const original = await jpeg(width, height);
  const upload = await owner.as.fetch(
    `/collection-photo?scope=${encodeURIComponent(owner.scope)}&localId=${save.localId}&photoId=${photo.localId}&kind=photo`,
    {
      method: "POST",
      body: new Uint8Array(original),
      headers: { "Content-Type": "image/jpeg", "X-Photo-Width": String(width), "X-Photo-Height": String(height) },
    },
  );
  expect(upload.status).toBe(200);
  const { postId } = await owner.as.action(api.sharedVisits.publish, {
    ...draft.selection,
    photoSelections: [{ saveLocalId: save.localId, photoLocalIds: [photo.localId] }],
  });
  const card = async () => (await viewer.as.query(api.sharedVisits.get, { postId: postId! })).artworks.page[0];
  const path = `/display-media?kind=sharedVisit&postId=${postId}&itemId=${(await card()).itemId}&photoLocalId=${photo.localId}`;
  const stored = () =>
    t.run(async (ctx) =>
      ctx.db
        .query("artworkPhotos")
        .withIndex("by_owner_localId", (q) =>
          q.eq("owner", { kind: "account", accountId: owner.accountId }).eq("localId", photo.localId),
        )
        .unique(),
    );
  const read = async (as: Pick<Harness, "fetch">, url: string) => {
    const response = await as.fetch(url);
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), response };
  };
  return { t, owner, viewer, draft, photo, original, card, path, stored, read, syncPhoto };
}

it("serves the feed copy only where asked, falling back to the original until it exists", async () => {
  const f = await sharedPhotoFixture();
  expect((await f.card()).photos?.[0]).not.toHaveProperty("feedSize");
  expect((await f.read(f.viewer.as, `${f.path}&size=feed`)).bytes).toEqual(f.original);
  await runScheduled(f.t);
  expect((await f.card()).photos?.[0]).toMatchObject({ kind: "photo", width: 600, height: 1200, feedSize: true });
  expect((await f.read(f.viewer.as, f.path)).bytes).toEqual(f.original);
  const feed = await f.read(f.viewer.as, `${f.path}&size=feed`);
  expect(feed.response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await sharp(feed.bytes).metadata()).toMatchObject({ format: "jpeg", width: 300, height: 600 });
  expect(feed.bytes.length).toBeLessThan(f.original.length / 2);
  const copy = (await f.stored())!.feedStorageId!;
  expect(await f.t.run((ctx) => ctx.db.get("files", copy))).toMatchObject({
    refCount: 1,
    ownerPhoto: true,
    publicDownload: false,
  });
  // A derivative has no feed size, and only `feed` is a size.
  await socialDerivative(f.t, f.owner, f.draft.saves[0].id);
  const derivativePath = f.path.replace(/&photoLocalId=[^&]+/, "");
  expect((await f.read(f.viewer.as, derivativePath)).status).toBe(200);
  for (const url of [`${f.path}&size=small`, `${f.path}&size=`, `${derivativePath}&size=feed`]) {
    expect((await f.read(f.viewer.as, url)).status).toBe(404);
  }
});

it("authorizes the feed copy exactly like the original", async () => {
  const f = await sharedPhotoFixture();
  await runScheduled(f.t);
  const statuses = async (as: Pick<Harness, "fetch">) => [
    (await f.read(as, f.path)).status,
    (await f.read(as, `${f.path}&size=feed`)).status,
  ];
  expect(await statuses(f.t)).toEqual([200, 200]);
  await setVisitVisibility(f.t, f.owner, f.draft.visit._id, "friends");
  expect(await statuses(f.t)).toEqual([404, 404]);
  expect(await statuses(f.viewer.as)).toEqual([404, 404]);
  await befriend(f.owner, f.viewer);
  expect(await statuses(f.viewer.as)).toEqual([200, 200]);
  const { get } = fileStorage;
  vi.spyOn(fileStorage, "get").mockImplementationOnce(async (ctx, id) => {
    const blob = await get(ctx, id);
    await setVisitVisibility(f.t, f.owner, f.draft.visit._id, "private");
    return blob;
  });
  expect((await f.read(f.viewer.as, `${f.path}&size=feed`)).status).toBe(404);
  expect(await statuses(f.viewer.as)).toEqual([404, 404]);
  await setVisitVisibility(f.t, f.owner, f.draft.visit._id, "friends");
  expect(await statuses(f.viewer.as)).toEqual([200, 200]);
  await f.owner.as.action(api.sharedVisits.publish, {
    ...f.draft.selection,
    audience: "friends",
    revision: (await f.owner.as.query(api.sharedVisits.getState, { visitLocalId: f.draft.visit.localId })).revision,
    photoSelections: [],
  });
  expect(await statuses(f.viewer.as)).toEqual([404, 404]);
});

it.each(["photo", "account"] as const)(
  "deletes the feed copy with the original when the %s is deleted",
  async (kind) => {
    const f = await sharedPhotoFixture();
    await runScheduled(f.t);
    const { storageId, feedStorageId } = (await f.stored())!;
    if (kind === "photo") await f.syncPhoto({ ...f.photo, deletedAt: Date.now() });
    else await f.owner.as.mutation(api.accounts.deleteAccount, {});
    expect((await f.read(f.viewer.as, `${f.path}&size=feed`)).status).toBe(404);
    await runScheduled(f.t);
    for (const id of [storageId!, feedStorageId!]) {
      expect(await f.t.run((ctx) => ctx.db.get("files", id))).toBeNull();
    }
  },
);

it("discards a copy finished after its photo was deleted", async () => {
  const f = await sharedPhotoFixture();
  const original = (await f.stored())!.storageId;
  const { get } = fileStorage;
  vi.spyOn(fileStorage, "get").mockImplementation(async (ctx, id) => {
    const blob = await get(ctx, id);
    if (id === original) await f.syncPhoto({ ...f.photo, deletedAt: Date.now() });
    return blob;
  });
  const store = vi.spyOn(fileStorage, "store");
  await runScheduled(f.t);
  expect(store).toHaveBeenCalledOnce();
  expect((await f.stored())?.feedStorageId).toBeUndefined();
  expect(await f.t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
});

it("leaves photos already within the feed size alone", async () => {
  const f = await sharedPhotoFixture({ width: 400, height: 500 });
  expect(await f.t.run((ctx) => ctx.db.query("feedPhotoJobs").collect())).toEqual([]);
  await runScheduled(f.t);
  expect((await f.stored())?.feedStorageId).toBeUndefined();
  expect((await f.read(f.viewer.as, `${f.path}&size=feed`)).bytes).toEqual(f.original);
});

async function albumPhotos(t: Harness, count: number) {
  const owner = await socialUser(t);
  const { saves } = await socialVisit(t, owner, 1);
  const bytes = await jpeg(60, 700);
  return t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", saves[0].id))!;
    const ids: Id<"artworkPhotos">[] = [];
    for (let i = 0; i < count; i++) {
      const storageId = await fileStorage.store(ctx, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
      ids.push(
        await ctx.db.insert("artworkPhotos", {
          owner: save.owner,
          saveId: save._id,
          savedLocalId: save.localId,
          localId: crypto.randomUUID(),
          kind: "full",
          capturedAt: i,
          storageId,
          updatedAt: 1,
          changeVersion: 1,
        }),
      );
    }
    return ids;
  });
}

it("backfills through one chained worker that stops when the queue is empty", async () => {
  const t = harness();
  const ids = await albumPhotos(t, 30);
  await t.mutation(internal.feedPhotos.backfill, {});
  await t.mutation(internal.feedPhotos.backfill, {});
  await t.mutation(internal.feedPhotos.wake, {});
  expect(await t.run((ctx) => ctx.db.query("feedPhotoJobs").collect())).toHaveLength(30);
  expect(await workRuns(t)).toHaveLength(1);
  await runScheduled(t);
  const photos = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get("artworkPhotos", id))));
  expect(photos.every((photo) => photo?.feedStorageId)).toBe(true);
  // Two batches, then an empty claim that ends the chain.
  expect((await workRuns(t)).map((job) => job.state.kind)).toEqual(["success", "success", "success"]);
  expect(await t.run((ctx) => ctx.db.query("feedPhotoJobs").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("feedPhotoWorker").collect())).toEqual([]);
  await t.mutation(internal.feedPhotos.backfill, {});
  await t.mutation(internal.feedPhotos.wake, {});
  expect(await workRuns(t)).toHaveLength(3);
});

it("replaces a worker whose lease ran out, and the stale run stops", async () => {
  const t = harness();
  const [id] = await albumPhotos(t, 1);
  await t.mutation(internal.feedPhotos.backfill, {});
  vi.setSystemTime(Date.now() + 32 * 60_000);
  await t.mutation(internal.feedPhotos.wake, {});
  expect(await workRuns(t)).toHaveLength(2);
  await runScheduled(t);
  // The stale run stops at its claim; the new one copies the photo and then finds the queue empty.
  expect(await workRuns(t)).toHaveLength(3);
  expect((await t.run((ctx) => ctx.db.get("artworkPhotos", id)))?.feedStorageId).toBeDefined();
  expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(2);
});
