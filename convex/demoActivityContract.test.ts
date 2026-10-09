import { readFileSync, writeFileSync } from "node:fs";

import { expect, it } from "vitest";

import { APPROVED_DEMO_USERNAMES } from "../shared/demo-policy";
import * as activity from "./demoActivity";
import * as photos from "./demoActivityPhotos";

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sort(val)]),
    );
  }
  return value;
}

it("records the public bot contract from registered validators", () => {
  const functions = [];
  for (const [module, exports] of [
    ["demoActivity", activity],
    ["demoActivityPhotos", photos],
  ] as const) {
    for (const [name, value] of Object.entries(exports)) {
      const fn = value as unknown as {
        isPublic?: boolean;
        isQuery?: boolean;
        isMutation?: boolean;
        exportArgs(): string;
        exportReturns(): string;
      };
      if (!fn.isPublic) continue;
      functions.push({
        identifier: `${module}.js:${name}`,
        functionType: fn.isQuery ? "Query" : fn.isMutation ? "Mutation" : "Action",
        visibility: { kind: "public" },
        args: JSON.parse(fn.exportArgs()),
        returns: JSON.parse(fn.exportReturns()),
      });
    }
  }
  functions.sort((a, b) => a.identifier.localeCompare(b.identifier));
  const snapshot = sort({ functions });
  const file = new URL("./demoActivityContract.json", import.meta.url);
  if (process.env.UPDATE_DEMO_CONTRACT === "1") writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(snapshot);
  expect(new Set(APPROVED_DEMO_USERNAMES).size).toBe(32);
});
