import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

function fixture(t: TestContext) {
  mkdirSync(".context", { recursive: true });
  const root = mkdtempSync(resolve(".context/agent-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = join(root, "calls.jsonl");
  const state = join(root, "state.json");
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(
    join(root, "codex"),
    `#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
assert.equal(process.env.GH_TOKEN, undefined);
assert.equal(process.env.SENTRY_AUTH_TOKEN, undefined);
assert.equal(process.env.CODEX_AUTH_WRITE_TOKEN, undefined);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const state = JSON.parse(readFileSync(${JSON.stringify(state)}, "utf8"));
if (args[0] === "sandbox") {
  if (state.sandboxFails) {
    console.error("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted; private diagnostic");
    process.exit(1);
  }
  const [program, ...command] = args.slice(args.indexOf("--") + 1);
  const result = spawnSync(program, command, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
assert.equal(args[0], "exec");
readFileSync(0, "utf8");
writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({
  status: state.status, title: "Assessment", body: "private diagnostic"
}));
`,
    { mode: 0o700 },
  );
  const runner = join(root, "run.mjs");
  writeFileSync(
    runner,
    `import { runAgent } from ${JSON.stringify(pathToFileURL(resolve("scripts/sentry-automation/agent.ts")).href)};
try {
  const result = runAgent(process.argv[2], {}, "a".repeat(40));
  console.log(result.status);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}`,
  );
  return {
    calls: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    run(role: "fix" | "review" | "probe", options: { sandboxFails?: boolean; status?: string } = {}) {
      writeFileSync(state, JSON.stringify({ status: "pass", ...options }));
      return spawnSync(process.execPath, [runner, role], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: `${root}:${process.env.PATH}`,
          HOME: root,
          NODE_ENV: "test",
          CODEX_HOME: join(root, "codex-home"),
          GH_TOKEN: "fake-github-token",
          SENTRY_AUTH_TOKEN: "fake-sentry-token",
          CODEX_AUTH_WRITE_TOKEN: "fake-secret-write-token",
        },
      });
    },
  };
}

await test("a broken sandbox fails before Codex can turn it into a skipped issue", (t) => {
  const context = fixture(t);
  const result = context.run("fix", { sandboxFails: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sandbox preflight failed/i);
  assert.doesNotMatch(result.stdout + result.stderr, /private diagnostic/);
  assert.deepEqual(
    context.calls().map((args) => args[0]),
    ["sandbox"],
  );
});

for (const role of ["fix", "review", "probe"] as const) {
  await test(`${role} preflights its sandbox and keeps shell network access disabled`, (t) => {
    const context = fixture(t);
    const result = context.run(role);
    assert.equal(result.status, 0, result.stderr);
    const calls = context.calls();
    assert.equal(calls.at(-1)?.[0], "exec");
    assert.ok(calls.slice(0, -1).every((args) => args[0] === "sandbox"));
    assert.ok(calls.length > 1);
    for (const args of calls) {
      assert.ok(args.includes("features.use_legacy_landlock=false"));
      assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
      assert.ok(!args.includes("danger-full-access"));
    }
    const modes = calls.slice(0, -1).map((args) => args.find((arg) => arg.startsWith("sandbox_mode=")));
    assert.deepEqual(
      modes,
      role === "probe"
        ? ['sandbox_mode="workspace-write"', 'sandbox_mode="read-only"']
        : [`sandbox_mode="${role === "fix" ? "workspace-write" : "read-only"}"`],
    );
  });
}

await test("an infrastructure-blocked assessment fails instead of becoming an escalation", (t) => {
  const context = fixture(t);
  const result = context.run("fix", { status: "blocked" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /infrastructure/i);
  assert.doesNotMatch(result.stdout + result.stderr, /private diagnostic/);
});

await test("an investigated but unsupported diagnosis still returns skip", (t) => {
  const context = fixture(t);
  const result = context.run("fix", { status: "skip" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Codex fix completed: skip\./);
});
