/// <reference types="node" />
import { stdout } from "node:process";
import { expect, it } from "vitest";

import model from "../shared/model/model-version.json";
import { api } from "./_generated/api";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

it.skipIf(process.env.BENCH !== "1")(
  "times identification over 2,000 vectors and 20 descriptor rows",
  async () => {
    const t = harness();
    const user = await seedDevice(t);
    const pair = makeSyntheticPair({ count: 375, outlierFraction: 0 });
    const venueId = await t.run(async (ctx) => {
      const venueId = await seedMuseum(ctx);
      for (let i = 0; i < 20; i++)
        await seedArtworkWithObject(ctx, {
          vector: testVector(0.99 - i / 200),
          descriptors: pair.ref,
          placement: { venueId, onView: true, source: "feed", confidence: 1 },
        });
      return venueId;
    });
    // Separate transactions keep fixture setup inside Convex's per-mutation write limit.
    for (let offset = 0; offset < 1980; offset += 100)
      await t.run(async (ctx) => {
        for (let i = offset; i < Math.min(offset + 100, 1980); i++) {
          await seedArtworkWithObject(ctx, { vector: testVector(0.2 + (i % 50) / 100) });
        }
      });
    const started = performance.now();
    const result = await user.as.action(api.identify.identify, {
      localId: "benchmark",
      venueId,
      vector: testVector(),
      ...encodeOrbFeatures(pair.query),
      modelVersion: model.modelVersion,
      capturedAt: Date.now(),
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    const elapsed = performance.now() - started;
    stdout.write(
      `identify convex-test: ${elapsed.toFixed(1)} ms (2,000 vectors, 20 descriptor rows, top 10 ORB)\n`,
    );
    expect(result.status).toBe("identified");
    expect((await t.run((ctx) => ctx.db.get(result.scanId)))?.best?.corners).toHaveLength(4);
  },
  30_000,
);
