import { expect, it } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import { seedDevice, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

it("stores a scan's embedding separately and reuses it on an idempotent retry", async () => {
  const t = harness();
  const user = await seedDevice(t);
  const args = {
    deviceId: user.deviceId,
    localId: "capture",
    modelVersion: model.modelVersion,
    vector: testVector(),
    capturedAt: Date.now(),
  };
  const first = await t.mutation(internal.scans.create, args);
  const retry = await t.mutation(internal.scans.create, args);
  expect(first.scan).not.toHaveProperty("vector");
  expect(retry.scan.embeddingId).toBe(first.scan.embeddingId);
  expect((await t.run((ctx) => ctx.db.get("scanEmbeddings", first.scan.embeddingId)))?.vector).toEqual(args.vector);
  expect(await t.run((ctx) => ctx.db.query("scanEmbeddings").collect())).toHaveLength(1);
});
