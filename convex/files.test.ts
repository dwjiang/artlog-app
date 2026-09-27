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

it("treats malformed, wrong-table, and deleted file IDs as missing", async () => {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const deletedId = await t.mutation(internal.files.reserve, { contentType: "image/jpeg", size: 3 });
  await t.run((ctx) => ctx.db.delete("files", deletedId));
  const get = vi.mocked(r2.get);
  const remove = vi.mocked(r2.remove);
  for (const id of ["not-a-file", crypto.randomUUID(), deviceId, deletedId]) {
    expect(await t.query(internal.files.metadata, { id })).toBeNull();
    expect(await t.run((ctx) => fileStorage.get(ctx, id))).toBeNull();
    expect((await t.fetch(`/file?id=${id}`)).status).toBe(404);
    await t.mutation(internal.files.discard, { id });
  }
  expect(get).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
