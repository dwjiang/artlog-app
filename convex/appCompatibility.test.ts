import { afterEach, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { harness } from "./test.helpers";

afterEach(() => vi.unstubAllEnvs());

it("allows unauthenticated startup checks and defaults to no minimum", async () => {
  vi.stubEnv("MINIMUM_IOS_BUILD", undefined);
  expect(await harness().query(api.appCompatibility.get, {})).toBeNull();
});

it("reads the deployment's minimum and allows it to be removed", async () => {
  const t = harness();
  vi.stubEnv("MINIMUM_IOS_BUILD", "42");
  expect(await t.query(api.appCompatibility.get, {})).toBe("42");
  vi.stubEnv("MINIMUM_IOS_BUILD", "1.2.3");
  expect(await t.query(api.appCompatibility.get, {})).toBe("1.2.3");
  vi.stubEnv("MINIMUM_IOS_BUILD", undefined);
  expect(await t.query(api.appCompatibility.get, {})).toBeNull();
});

it("rejects invalid configuration instead of silently clearing the requirement", async () => {
  vi.stubEnv("MINIMUM_IOS_BUILD", "latest");
  await expect(harness().query(api.appCompatibility.get, {})).rejects.toThrow("Invalid MINIMUM_IOS_BUILD");
});
