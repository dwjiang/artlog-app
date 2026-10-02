import { createHash } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import { fileStorage, FILE_LEASE_MS, reserveFile, retainFile } from "./lib/fileStorage";
import { r2 } from "./lib/r2";
import { seedDevice } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("uses the file document ID for server uploads and R2 reads", async () => {
  const t = harness();
  const blob = new Blob(["archive bytes"], { type: "application/octet-stream" });
  const id = await t.action((ctx) => fileStorage.store(ctx, blob));
  const file = await t.query(internal.files.metadata, { id });
  expect(file?._id).toBe(id);
  expect(r2.put).toHaveBeenCalledWith(id, blob);
  expect(await (await r2.get(id))?.text()).toBe("archive bytes");
  expect(await t.action(async (ctx) => (await fileStorage.get(ctx, id))?.text())).toBe("archive bytes");
});

it("stores an HTTP request body, which the Convex runtime streams only once", async () => {
  class StreamingBlob extends Blob {
    #read = false;
    override async arrayBuffer() {
      if (this.#read) throw new TypeError("Can't re-read streaming Blob");
      this.#read = true;
      return super.arrayBuffer();
    }
  }
  const uploaded: string[] = [];
  vi.mocked(r2.put).mockImplementationOnce(async (_key, blob) => {
    uploaded.push(new TextDecoder().decode(await blob.arrayBuffer()));
  });
  const t = harness();
  const id = await t.action((ctx) =>
    fileStorage.store(ctx, new StreamingBlob(["photo bytes"], { type: "image/jpeg" })),
  );
  expect(uploaded).toEqual(["photo bytes"]);
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({
    state: "ready",
    contentType: "image/jpeg",
    size: 11,
    sha256: createHash("sha256").update("photo bytes").digest("hex"),
  });
});

it("reserves direct uploads under the file document ID", async () => {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const id = await t.run((ctx) => reserveFile(ctx, "image/jpeg", 3, deviceId));
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({
    _id: id,
    state: "pending",
    uploadOwner: deviceId,
  });
});

it("keeps private files off the direct-download endpoint and redirects published bytes without proxying them", async () => {
  const t = harness();
  const id = await t.run((ctx) => fileStorage.store(ctx, new Blob(["audio"], { type: "audio/mpeg" })));
  expect(await t.run((ctx) => fileStorage.getUrl(ctx, id))).toBeNull();
  expect((await t.fetch(`/file?id=${id}`)).status).toBe(404);
  await t.run((ctx) => retainFile(ctx, id, true));
  const uri = await t.run((ctx) => fileStorage.getUrl(ctx, id));
  expect(uri).toBe(`https://test.convex.site/file?id=${id}`);
  const response = await t.fetch(`/file?id=${id}`);
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`https://r2.test/download/${id}`);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("");
  expect((await t.fetch("/file?id=not-a-file")).status).toBe(404);
});

it("revokes reads transactionally, retries a failed deletion, and eventually removes R2 bytes", async () => {
  vi.useFakeTimers();
  const t = harness();
  const id = await t.run((ctx) => fileStorage.store(ctx, new Blob(["photo"])));
  await t.run((ctx) => retainFile(ctx, id, true));
  const remove = vi.mocked(r2.remove).mockRejectedValueOnce(new Error("temporary R2 failure"));
  await t.run((ctx) => fileStorage.delete(ctx, id));
  expect(await t.run((ctx) => fileStorage.get(ctx, id))).toBeNull();
  expect((await t.fetch(`/file?id=${id}`)).status).toBe(404);
  expect(await r2.get(id)).not.toBeNull();
  await expect(t.run((ctx) => retainFile(ctx, id))).rejects.toMatchObject({ data: { code: "file_missing" } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(remove).toHaveBeenCalledWith(id);
  expect(await r2.get(id)).toBeNull();
  expect(await t.query(internal.files.metadata, { id })).toBeNull();
});

it("expires abandoned uploads and uncommitted files while retaining attached files", async () => {
  vi.useFakeTimers();
  const t = harness();
  const pending = await t.mutation(internal.files.reserve, { contentType: "image/jpeg", size: 3 });
  const orphan = await t.run((ctx) => fileStorage.store(ctx, new Blob(["orphan"])));
  const retained = await t.run((ctx) => fileStorage.store(ctx, new Blob(["retained"])));
  await t.run((ctx) => retainFile(ctx, retained));
  vi.setSystemTime(Date.now() + FILE_LEASE_MS + 1);
  await t.mutation(internal.files.expire, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.files.metadata, { id: pending })).toBeNull();
  expect(await t.query(internal.files.metadata, { id: orphan })).toBeNull();
  expect(await t.run(async (ctx) => (await fileStorage.get(ctx, retained)) !== null)).toBe(true);
});

it("delays physical deletion until a direct-upload URL has expired", async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const id = await t.run((ctx) => reserveFile(ctx, "image/jpeg", 3, user.deviceId));
  await r2.put(id, new Blob(["abc"]));
  await t.mutation(internal.files.discard, { id });
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(jobs[0].scheduledTime).toBeGreaterThanOrEqual(Date.now() + 15 * 60 * 1000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await r2.get(id)).toBeNull();
});

it("cleans a failed upload and recovers deletion jobs whose action never completed", async () => {
  vi.useFakeTimers();
  const t = harness();
  vi.mocked(r2.put).mockRejectedValueOnce(new Error("upload interrupted"));
  await expect(t.action((ctx) => fileStorage.store(ctx, new Blob(["photo"])))).rejects.toThrow("upload interrupted");
  const files = await t.run((ctx) => ctx.db.query("files").collect());
  expect(files).toHaveLength(1);
  expect(files[0].state).toBe("deleting");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const id = await t.run((ctx) => fileStorage.store(ctx, new Blob(["stranded"])));
  await t.run(async (ctx) =>
    ctx.db.patch("files", (await fileStorage.getMetadata(ctx, id))!._id, {
      state: "deleting",
      expiresAt: Date.now() - 1,
    }),
  );
  await t.mutation(internal.files.expire, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.files.metadata, { id })).toBeNull();
  expect(await r2.get(id)).toBeNull();
});

it("rejects invalid internal IDs and treats invalid download URLs and deleted IDs as missing", async () => {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const deletedId = await t.mutation(internal.files.reserve, { contentType: "image/jpeg", size: 3 });
  await t.run((ctx) => ctx.db.delete("files", deletedId));
  for (const id of ["not-a-file", crypto.randomUUID(), deviceId]) {
    // @ts-expect-error deliberately violate the internal file-ID contract
    await expect(t.query(internal.files.metadata, { id })).rejects.toThrow(/Validator/);
    expect((await t.fetch(`/file?id=${id}`)).status).toBe(404);
  }
  expect(await t.query(internal.files.metadata, { id: deletedId })).toBeNull();
  expect(await t.run((ctx) => fileStorage.get(ctx, deletedId))).toBeNull();
  await t.mutation(internal.files.discard, { id: deletedId });
});

it("counts shared references atomically and releases a file only after the last attachment", async () => {
  vi.useFakeTimers();
  const t = harness();
  const id = await t.run((ctx) => fileStorage.store(ctx, new Blob(["shared photo"], { type: "image/jpeg" })));
  const [first, second] = await t.run(async (ctx) => [
    await ctx.db.insert("objectDetails", { thumbnailStorageId: id }),
    await ctx.db.insert("objectDetails", { thumbnailStorageId: id }),
  ]);
  await t.run((ctx) => retainFile(ctx, id, true));
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({ refCount: 2 });
  await t.mutation(internal.files.discard, { id });
  expect((await t.fetch(`/file?id=${id}`)).status).toBe(302);
  await t.run((ctx) => ctx.db.delete("objectDetails", first));
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({ refCount: 1, state: "ready" });
  await t.run((ctx) => ctx.db.patch("objectDetails", second, { medium: "changed without touching the file" }));
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({ refCount: 1 });
  await t.run((ctx) => ctx.db.delete("objectDetails", second));
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, id))).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.files.metadata, { id })).toBeNull();
});

it("allows a reference to move within a transaction and rolls back an invalid replacement", async () => {
  vi.useFakeTimers();
  const t = harness();
  const id = await t.run((ctx) => fileStorage.store(ctx, new Blob(["photo"], { type: "image/jpeg" })));
  const first = await t.run((ctx) => ctx.db.insert("objectDetails", { thumbnailStorageId: id }));
  const second = await t.run(async (ctx) => {
    await ctx.db.delete("objectDetails", first);
    return ctx.db.insert("objectDetails", { thumbnailStorageId: id });
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({ refCount: 1, state: "ready" });
  const pending = await t.mutation(internal.files.reserve, { contentType: "image/jpeg", size: 1 });
  await expect(
    t.run((ctx) => ctx.db.patch("objectDetails", second, { thumbnailStorageId: pending })),
  ).rejects.toMatchObject({ data: { code: "file_missing" } });
  expect(await t.query(internal.files.metadata, { id })).toMatchObject({ refCount: 1 });
  expect(await t.run((ctx) => ctx.db.get("objectDetails", second))).toMatchObject({ thumbnailStorageId: id });
});
