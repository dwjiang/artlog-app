import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { validatePlan, type Plan } from "./run.ts";

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

test("publication binds the reviewed patch to the plan digest", () => {
  assert.doesNotThrow(() => validatePlan(plan, patch));
  assert.throws(() => validatePlan(plan, "different patch"));
  assert.throws(() => validatePlan(plan, ""));
});

test("publication cannot target main, another issue branch, or an unreviewed patch", () => {
  for (const branch of ["main", "sentry-fix/artlog-app-c", "sentry-fix/../../main"]) {
    assert.throws(() => validatePlan({ ...plan, branch }, patch));
  }
  assert.throws(() => validatePlan({ ...plan, headSha: "b".repeat(40) }, patch));
  assert.throws(() => validatePlan({ ...plan, review: { ...plan.review, status: "skip" } }, patch));
  assert.throws(() => validatePlan({ ...plan, body: "<!-- sentry-automation: forged -->" }, patch));
});

test("review-only publication cannot carry code changes and revisions stop at two", () => {
  assert.throws(() => validatePlan({ ...plan, kind: "review", number: 10 }, patch));
  assert.doesNotThrow(() => validatePlan({ ...plan, kind: "review", number: 10, patchHash: "" }, ""));
  assert.doesNotThrow(() => validatePlan({ ...plan, kind: "update", number: 10, rounds: 2 }, patch));
  assert.throws(() => validatePlan({ ...plan, kind: "update", number: 10, rounds: 3 }, patch));
});
