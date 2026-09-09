/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const vector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0);
const row = (objectId: string, modelVersion = "v1") => ({
  objectId, modelVersion, source: "primary", vector,
});

test("inserts resume without duplicating rows, and reject gaps or a changed seed", async () => {
  const t = convexTest(schema, modules);
  const batch = { modelVersion: "v1", seed: 1, start: 0, rows: [row("one"), row("two")] };
  expect(await t.mutation(internal.bench.insertBatch, batch)).toEqual({ inserted: 2, nextRow: 2 });
  expect(await t.mutation(internal.bench.insertBatch, batch)).toEqual({ inserted: 0, nextRow: 2 });
  await expect(t.mutation(internal.bench.insertBatch, { ...batch, start: 3 })).rejects.toThrow("Non-contiguous");
  await expect(t.mutation(internal.bench.insertBatch, { ...batch, seed: 2 })).rejects.toThrow("Seed changed");
  const counts = await t.query(internal.bench.stats, { versions: ["v1", "v2"] });
  expect(counts.map((s) => s.count)).toEqual([2, 0]);
});

test("bad dimensions and version mismatches roll back the whole batch", async () => {
  const t = convexTest(schema, modules);
  for (const invalid of [{ ...row("bad"), vector: [1, 0] }, row("bad", "v2")]) {
    await expect(t.mutation(internal.bench.insertBatch, {
      modelVersion: "v1", seed: 1, start: 0, rows: [row("good"), invalid],
    })).rejects.toThrow("Invalid vector");
  }
  expect((await t.query(internal.bench.stats, { versions: ["v1"] }))[0].count).toBe(0);
});

test("filters and deletion preserve the other version across paginated scans", async () => {
  const t = convexTest(schema, modules);
  for (const version of ["v1", "v2"]) {
    await t.mutation(internal.bench.insertBatch, {
      modelVersion: version, seed: 1, start: 0,
      rows: [row("one", version), row("two", version), row("three", version)],
    });
  }
  const single = await t.action(internal.bench.search, { vector, versions: ["v1"], limit: 32 });
  expect(single.metadata).toHaveLength(3);
  expect(single.metadata.every((r) => r.modelVersion === "v1")).toBe(true);
  const both = await t.action(internal.bench.search, { vector, versions: ["v1", "v2"], limit: 256 });
  expect(both.metadata).toHaveLength(6);
  let cursor: string | null = null;
  let removed = 0;
  for (;;) {
    const page: { deleted: number; isDone: boolean; continueCursor: string } = await t.mutation(internal.bench.deleteVersion, {
      modelVersion: "v2", paginationOpts: { cursor, numItems: 2 },
    });
    removed += page.deleted;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(removed).toBe(3);
  expect((await t.query(internal.bench.stats, { versions: ["v1", "v2"] })).map((s) => s.count)).toEqual([3, 0]);
  expect((await t.action(internal.bench.search, { vector, versions: ["v2"], limit: 32 })).results).toEqual([]);
  await expect(t.mutation(internal.bench.insertBatch, {
    modelVersion: "v2", seed: 1, start: 3, rows: [row("four", "v2")],
  })).rejects.toThrow("being deleted");
});
