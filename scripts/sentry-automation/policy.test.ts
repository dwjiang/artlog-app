import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPatchPaths,
  eligiblePull,
  issueAlreadyTracked,
  latestState,
  productionEvidence,
  readState,
  stateMarker,
  staleCredential,
  type Pull,
} from "./policy.ts";

const pull: Pull = {
  number: 1,
  title: "Fix ARTLOG-APP-B",
  body: "",
  state: "open",
  draft: true,
  labels: [{ name: "agent-generated" }, { name: "sentry-fix" }],
  head: { ref: "sentry-fix/artlog-app-b", sha: "a".repeat(40), repo: { full_name: "dwjiang/artlog-app" } },
  base: { ref: "main" },
};

test("review eligibility requires both labels, an open PR, and the same repository", () => {
  assert.equal(eligiblePull(pull), true);
  assert.equal(eligiblePull({ ...pull, labels: [{ name: "sentry-fix" }] }), false);
  assert.equal(eligiblePull({ ...pull, state: "closed" }), false);
  assert.equal(eligiblePull({ ...pull, base: { ref: "release" } }), false);
  assert.equal(eligiblePull({ ...pull, head: { ...pull.head, repo: { full_name: "someone/fork" } } }), false);
});

test("deduplication includes human PRs and closed PRs without confusing issue prefixes", () => {
  assert.equal(issueAlreadyTracked("ARTLOG-APP-B", [{ ...pull, state: "closed", labels: [] }]), true);
  assert.equal(issueAlreadyTracked("ARTLOG-APP-B", [{ ...pull, title: "ARTLOG-APP-B1" }]), false);
  assert.equal(issueAlreadyTracked("ARTLOG-APP-B", [{ ...pull, title: "", body: "Fixes ARTLOG-APP-B." }]), true);
});

const now = Date.parse("2026-09-24T12:00:00Z");
const event = {
  eventID: "e".repeat(32),
  groupID: "123",
  dateCreated: "2026-09-24T11:00:00Z",
  tags: [{ key: "environment", value: "production" }],
  user: { email: "private@example.com" },
  request: { headers: [["Authorization", "secret"]] },
  message: "Private user content",
  entries: [
    {
      type: "exception",
      data: {
        values: [
          {
            type: "TypeError",
            value: "Private exception content",
            stacktrace: {
              frames: [{ filename: "src/example.ts", function: "save", lineNo: 12, vars: { token: "secret" } }],
            },
          },
        ],
      },
    },
  ],
};

test("only recent, explicitly production events belonging to the selected issue are accepted", () => {
  assert.ok(productionEvidence(event, "123", now));
  assert.equal(productionEvidence({ ...event, tags: [] }, "123", now), null);
  assert.equal(
    productionEvidence({ ...event, tags: [{ key: "environment", value: "development" }] }, "123", now),
    null,
  );
  assert.equal(productionEvidence({ ...event, environment: "development" }, "123", now), null);
  assert.equal(productionEvidence(event, "456", now), null);
  assert.equal(productionEvidence({ ...event, dateCreated: "2026-09-20T11:00:00Z" }, "123", now), null);
  assert.equal(productionEvidence({ ...event, dateCreated: "invalid" }, "123", now), null);
  assert.equal(productionEvidence({ ...event, dateCreated: "2026-09-25T11:00:00Z" }, "123", now), null);
});

test("evidence omits user content, credentials, request data, and local variables", () => {
  const evidence = productionEvidence(event, "123", now);
  const encoded = JSON.stringify(evidence);
  assert.match(encoded, /TypeError/);
  assert.match(encoded, /src\/example.ts/);
  assert.doesNotMatch(encoded, /private|Private|secret|Authorization/);
});

test("persisted state validates issue IDs, commit IDs and the two-round limit", () => {
  const state = {
    issue: "ARTLOG-APP-B",
    issueId: "123",
    rounds: 2,
    reviewedHead: "a".repeat(40),
    verdict: "changes_requested" as const,
  };
  assert.deepEqual(readState(stateMarker(state)), state);
  assert.equal(readState(stateMarker({ ...state, rounds: 3 })), null);
  assert.equal(readState(stateMarker({ ...state, reviewedHead: "main; evil" })), null);
  assert.equal(readState("human text"), null);
  assert.equal(readState("<!-- sentry-automation: {broken} -->"), null);
});

test("patches cannot edit workflow, agent instructions, secrets, or symlinks", () => {
  assert.doesNotThrow(() => assertPatchPaths(["src/lib/example.ts", "convex/example.ts"], "100644"));
  for (const path of [
    ".github/workflows/evil.yml",
    "scripts/sentry-automation/run.ts",
    "src/AGENTS.md",
    "src/.env",
    "../escape",
  ]) {
    assert.throws(() => assertPatchPaths([path], "100644"));
  }
  assert.throws(() => assertPatchPaths(["src/example.ts"], "120000"));
  assert.throws(() => assertPatchPaths(["src/example.ts"], "160000"));
});

test("queued runs and reruns cannot restore credentials superseded after they were queued", () => {
  assert.equal(staleCredential("2026-09-24T11:00:00Z", "2026-09-24T12:00:00Z"), true);
  assert.equal(staleCredential("2026-09-24T12:00:00Z", "2026-09-24T11:00:00Z"), false);
  assert.throws(() => staleCredential("invalid", "2026-09-24T12:00:00Z"));
});

test("an interrupted publication cannot lose a reserved revision round", () => {
  const old = {
    issue: "ARTLOG-APP-B",
    issueId: "123",
    rounds: 0,
    reviewedHead: "a".repeat(40),
    verdict: "changes_requested" as const,
  };
  const reserved = { ...old, rounds: 1 };
  assert.deepEqual(latestState(stateMarker(reserved), [stateMarker(old)]), reserved);
  const completed = { ...reserved, reviewedHead: "b".repeat(40), verdict: "pass" as const };
  assert.deepEqual(latestState(stateMarker(reserved), [stateMarker(old), stateMarker(completed)]), completed);
});
