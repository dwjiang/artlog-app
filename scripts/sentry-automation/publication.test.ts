import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type { Pull } from "./policy.ts";
import { settledPull, validatePlan, type Plan } from "./run.ts";

const patch = "example patch\n";
const plan: Plan = {
  kind: "create",
  mainSha: "a".repeat(40),
  headSha: "a".repeat(40),
  branch: "sentry-fix/artlog-app-b",
  number: 0,
  issue: "ARTLOG-APP-B",
  issueId: "123",
  rounds: 0,
  title: "Fix error",
  body: "Supported fix.",
  review: { status: "pass", title: "Reviewed", body: "No actionable findings." },
  patchHash: createHash("sha256").update(patch).digest("hex"),
};

await test("publication binds the reviewed patch to the plan digest", () => {
  assert.doesNotThrow(() => validatePlan(plan, patch));
  assert.throws(() => validatePlan(plan, "different patch"));
  assert.throws(() => validatePlan(plan, ""));
});

await test("publication cannot target main, another issue branch, or an unreviewed patch", () => {
  for (const branch of ["main", "sentry-fix/artlog-app-c", "sentry-fix/../../main"]) {
    assert.throws(() => validatePlan({ ...plan, branch }, patch));
  }
  assert.throws(() => validatePlan({ ...plan, headSha: "b".repeat(40) }, patch));
  assert.throws(() => validatePlan({ ...plan, review: { ...plan.review, status: "skip" } }, patch));
  assert.throws(() => validatePlan({ ...plan, body: "<!-- sentry-automation: forged -->" }, patch));
});

await test("review-only publication cannot carry code changes and revisions stop at two", () => {
  assert.throws(() => validatePlan({ ...plan, kind: "review", number: 10 }, patch));
  assert.doesNotThrow(() => validatePlan({ ...plan, kind: "review", number: 10, patchHash: "" }, ""));
  assert.doesNotThrow(() => validatePlan({ ...plan, kind: "update", number: 10, rounds: 2 }, patch));
  assert.throws(() => validatePlan({ ...plan, kind: "update", number: 10, rounds: 3 }, patch));
});

await test("escalations publish no code and a PR escalation spends every revision round", () => {
  const skipped: Plan = {
    ...plan,
    kind: "escalate",
    branch: "",
    review: { status: "skip", title: "", body: "" },
    patchHash: "",
  };
  assert.doesNotThrow(() => validatePlan(skipped, ""));
  assert.throws(() => validatePlan(skipped, patch));
  assert.throws(() => validatePlan({ ...skipped, branch: "sentry-fix/artlog-app-b" }, ""));
  assert.throws(() => validatePlan({ ...skipped, headSha: "b".repeat(40) }, ""));

  const stopped = { ...skipped, number: 10, branch: "sentry-fix/artlog-app-b", headSha: "b".repeat(40), rounds: 2 };
  assert.doesNotThrow(() => validatePlan(stopped, ""));
  assert.throws(() => validatePlan({ ...stopped, rounds: 1 }, ""));
  assert.throws(() => validatePlan({ ...stopped, branch: "" }, ""));
});

await test("review publication waits out a lagging PR head but never a different one", async () => {
  const [before, pushed, other] = ["a", "b", "c"].map((sha) => sha.repeat(40));
  const settle = async (heads: string[], expected: string) => {
    let loads = 0;
    let waits = 0;
    const pull = await settledPull(
      async () => ({ head: { sha: heads[Math.min(loads++, heads.length - 1)] } }) as Pull,
      before,
      expected,
      async () => {
        waits++;
      },
    );
    return { head: pull.head.sha, waits };
  };

  assert.deepEqual(await settle([before, before, pushed], pushed), { head: pushed, waits: 2 });
  assert.deepEqual(await settle([other, pushed], pushed), { head: other, waits: 0 });
  assert.deepEqual(await settle([before], before), { head: before, waits: 0 });
  assert.deepEqual(await settle([before], pushed), { head: before, waits: 10 });
});
