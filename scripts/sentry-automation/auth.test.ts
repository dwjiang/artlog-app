import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";

const login = JSON.stringify({
  auth_mode: "chatgpt",
  tokens: { access_token: "fake-access-credential", refresh_token: "fake-refresh-credential" },
});

function fixture(t: TestContext) {
  mkdirSync(".context", { recursive: true });
  const root = mkdtempSync(resolve(".context/auth-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "codex-home");
  const saved = join(root, "saved-login.json");
  const bootstrap = join(root, "mock-api.mjs");
  const gh = join(root, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), ["secret", "set", "CODEX_AUTH_JSON", "--repo", "dwjiang/artlog-app"]);
assert.equal(process.env.GH_TOKEN, "fake-secret-write-token");
assert.equal(process.env.SENTRY_AUTH_TOKEN, undefined);
writeFileSync(${JSON.stringify(saved)}, readFileSync(0));
`,
    { mode: 0o700 },
  );
  return {
    home,
    saved,
    run(mode: "restore" | "persist", options: { updated?: string; raw?: string; private?: boolean } = {}) {
      writeFileSync(
        bootstrap,
        `globalThis.fetch = async (url, options) => {
  if (options.method !== "GET") throw new Error("Unexpected write");
  const path = new URL(url).pathname;
  let body;
  if (path.endsWith("/secrets/CODEX_AUTH_JSON")) {
    if (options.headers.Authorization !== "Bearer fake-secret-write-token") throw new Error("Wrong secret credential");
    body = { updated_at: ${JSON.stringify(options.updated ?? "2026-09-24T11:00:00Z")} };
  } else if (path.endsWith("/actions/runs/42")) {
    body = { created_at: "2026-09-24T12:00:00Z" };
  } else if (path === "/repos/dwjiang/artlog-app") {
    body = { private: ${options.private ?? true} };
  } else throw new Error("Unexpected network request");
  return Response.json(body);
};`,
      );
      return spawnSync(process.execPath, ["--import", bootstrap, resolve("scripts/sentry-automation/auth.ts"), mode], {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: `${root}:${process.env.PATH}`,
          HOME: root,
          NODE_ENV: "test",
          CODEX_HOME: home,
          CODEX_AUTH_JSON: options.raw ?? login,
          CODEX_AUTH_WRITE_TOKEN: "fake-secret-write-token",
          GH_TOKEN: "fake-read-token",
          GITHUB_REPOSITORY: "dwjiang/artlog-app",
          GITHUB_RUN_ID: "42",
          SENTRY_AUTH_TOKEN: "fake-sentry-token",
        },
      });
    },
  };
}

await test("a dedicated subscription login is restored privately and its refreshed contents are saved", (t) => {
  const context = fixture(t);
  const restored = context.run("restore");
  assert.equal(restored.status, 0, restored.stderr);
  const authPath = join(context.home, "auth.json");
  assert.equal(readFileSync(authPath, "utf8"), login);
  assert.equal(statSync(authPath).mode & 0o777, 0o600);
  const refreshed = login.replace("fake-refresh-credential", "fake-rotated-credential");
  writeFileSync(authPath, refreshed);
  const persisted = context.run("persist");
  assert.equal(persisted.status, 0, persisted.stderr);
  assert.equal(readFileSync(context.saved, "utf8"), refreshed);
  assert.doesNotMatch(restored.stdout + restored.stderr + persisted.stdout + persisted.stderr, /fake-/);
});

await test("stale queued credentials and public repositories fail before writing a login", (t) => {
  const context = fixture(t);
  const stale = context.run("restore", { updated: "2026-09-24T13:00:00Z" });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Start a NEW workflow run/);
  assert.equal(existsSync(join(context.home, "auth.json")), false);
  const publicRepo = context.run("restore", { private: false });
  assert.equal(publicRepo.status, 1);
  assert.match(publicRepo.stderr, /requires a private repository/);
  assert.equal(existsSync(join(context.home, "auth.json")), false);
});

await test("a concurrently replaced login is never overwritten", (t) => {
  const context = fixture(t);
  assert.equal(context.run("restore").status, 0);
  const persisted = context.run("persist", { updated: "2026-09-24T12:01:00Z" });
  assert.equal(persisted.status, 1);
  assert.match(persisted.stderr, /refusing to overwrite/);
  assert.equal(existsSync(context.saved), false);
});

await test("malformed credentials do not appear in logs and API authentication is rejected", (t) => {
  const context = fixture(t);
  for (const raw of [
    "fake-malformed-credential",
    "null",
    JSON.stringify({ ...JSON.parse(login), OPENAI_API_KEY: "fake-key" }),
  ]) {
    const result = context.run("restore", { raw });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /fake-/);
    assert.equal(existsSync(join(context.home, "auth.json")), false);
  }
});
