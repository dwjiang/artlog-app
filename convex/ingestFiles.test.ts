import { createHash } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import { fileHash, fileStorage, FILE_LEASE_MS } from "./lib/fileStorage";
import { r2 } from "./lib/r2";
import { harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = harness({ transactionLimits: true });
  const body = new Blob([new Uint8Array(48)], { type: "application/octet-stream" });
  const spec = {
    size: body.size,
    contentType: "application/octet-stream" as const,
    sha256: await fileHash(body),
    md5: createHash("md5")
      .update(new Uint8Array(await body.arrayBuffer()))
      .digest("base64"),
  };
  return { t, body, spec };
}

it("registers 100 direct uploads, verifies metadata without downloading bodies, and safely replays completion", async () => {
  const { t, body, spec } = await fixture();
  const files = await t.action(internal.ingestFiles.prepare, { rows: Array(100).fill(spec) });
  expect(files).toHaveLength(100);
  for (const file of files) await r2.put(file.id, body);
  const reads = vi.mocked(r2.get).mock.calls.length;
  const args = { ids: files.map((file) => file.id) };
  await t.action(internal.ingestFiles.complete, args);
  const heads = vi.mocked(r2.head).mock.calls.length;
  await t.action(internal.ingestFiles.complete, args);
  expect(vi.mocked(r2.get).mock.calls.length).toBe(reads);
  expect(vi.mocked(r2.head).mock.calls.length).toBe(heads);
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, files[0].id))).toMatchObject({
    sha256: spec.sha256,
    state: "ready",
  });
  expect(await t.action(internal.ingestFiles.prepare, { rows: [{ ...spec, existingId: files[0].id }] })).toEqual([
    { id: files[0].id, url: null },
  ]);
});

it("verifies 32 files concurrently and accepts the batch only after every file passes", async () => {
  const { t, body, spec } = await fixture();
  const files = await t.action(internal.ingestFiles.prepare, { rows: Array(100).fill(spec) });
  for (const file of files) await r2.put(file.id, body);
  const originalHead = vi.mocked(r2.head).getMockImplementation()!;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let startWave!: () => void;
  const waveStarted = new Promise<void>((resolve) => {
    startWave = resolve;
  });
  let active = 0;
  let peak = 0;
  const head = vi.spyOn(r2, "head").mockImplementation(async (key) => {
    active++;
    peak = Math.max(peak, active);
    if (active === 32) startWave();
    try {
      await released;
      return await originalHead(key);
    } finally {
      active--;
    }
  });
  const completion = t.action(internal.ingestFiles.complete, { ids: files.map((file) => file.id) });
  try {
    await waveStarted;
    expect(await t.run((ctx) => ctx.db.get("files", files[0].id))).toMatchObject({ state: "pending" });
  } finally {
    release();
  }
  await completion;
  expect(peak).toBe(32);
  expect(head).toHaveBeenCalledTimes(100);
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, files[99].id))).toMatchObject({ state: "ready" });
  head.mockImplementation(originalHead);
});

it.each(["missing", "body", "size", "hash", "type"])(
  "rejects a %s mismatch without accepting a partial batch",
  async (failure) => {
    const { t, body, spec } = await fixture();
    const files = await t.action(internal.ingestFiles.prepare, { rows: [spec, spec] });
    await r2.put(files[0].id, body);
    await r2.remove(files[1].id);
    if (failure !== "missing") await r2.put(files[1].id, body);
    if (failure === "body") await r2.put(files[1].id, new Blob([new Uint8Array(48).fill(1)], { type: body.type }));
    if (["size", "hash", "type"].includes(failure)) {
      const realHead = r2.head;
      vi.spyOn(r2, "head").mockImplementationOnce(async (key) => ({
        ...(await realHead(key))!,
        ...(failure === "size"
          ? { size: 0 }
          : failure === "hash"
            ? { sha256: "wrong" }
            : { contentType: "image/jpeg" }),
      }));
    }
    await expect(t.action(internal.ingestFiles.complete, { ids: files.map((file) => file.id) })).rejects.toThrow(
      "import_upload_mismatch",
    );
    for (const file of files) {
      expect(await t.run((ctx) => ctx.db.get("files", file.id))).toMatchObject({ state: "pending" });
    }
  },
);

it("refuses malformed manifests and oversized batches before reserving any files", async () => {
  const { t, spec } = await fixture();
  for (const rows of [
    [{ ...spec, size: -1 }],
    [{ ...spec, sha256: "bad" }],
    [{ ...spec, md5: "bad" }],
    Array(101).fill(spec),
  ]) {
    await expect(t.action(internal.ingestFiles.prepare, { rows })).rejects.toThrow(
      /invalid_import_file|batch_too_large/,
    );
  }
  expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
});

it("leaves interrupted uploads on the existing expiry path and never resurrects an expired file", async () => {
  vi.useFakeTimers();
  const { t, body, spec } = await fixture();
  const [file] = await t.action(internal.ingestFiles.prepare, { rows: [spec] });
  await r2.put(file.id, body);
  vi.setSystemTime(Date.now() + FILE_LEASE_MS + 1);
  await expect(t.action(internal.ingestFiles.complete, { ids: [file.id] })).rejects.toThrow("file_missing");
  await t.mutation(internal.files.expire, {});
  expect(await t.run((ctx) => ctx.db.get("files", file.id))).toMatchObject({ state: "deleting" });
});
