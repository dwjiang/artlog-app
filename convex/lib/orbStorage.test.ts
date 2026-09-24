import { describe, expect, it } from "vitest";

import { encodeOrbFeatures } from "../../shared/orb/features";
import { makeRandomFeatures } from "../../shared/orb/test-fixtures";
import { harness } from "../test.helpers";
import { loadOrb, packOrb, storeOrb } from "./orbStorage";

describe("stored ORB references", () => {
  it.each([0, 120])("round-trips %s keypoints without changing the wire bytes", async (count) => {
    const t = harness();
    const encoded = encodeOrbFeatures(makeRandomFeatures(() => 0.3, count, 512));
    await t.run(async (ctx) => {
      const reference = await storeOrb(ctx, encoded.descriptors, encoded.keypoints);
      expect(reference.keypointCount).toBe(count);
      expect(await loadOrb(ctx, reference.storageId, count)).toEqual(encoded);
      const file = await ctx.storage.get(reference.storageId);
      expect(file!.size).toBe(count * 48);
    });
  });

  it("rejects malformed and non-finite features before storing a file", async () => {
    expect(() => packOrb(new ArrayBuffer(1), new ArrayBuffer(0))).toThrow("is not a multiple of");
    const keypoints = new Float32Array([NaN, 0, 1, 0]);
    expect(() => packOrb(new ArrayBuffer(32), keypoints.buffer)).toThrow("has a non-finite value");
  });

  it("fails explicitly for a missing or truncated reference instead of changing recognition", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(47)]));
      await expect(loadOrb(ctx, storageId, 1)).rejects.toThrow("bad_orb_file");
      await ctx.storage.delete(storageId);
      await expect(loadOrb(ctx, storageId, 1)).rejects.toMatchObject({
        data: { code: "orb_file_missing" },
      });
    });
  });
});
