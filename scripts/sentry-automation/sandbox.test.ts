import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { test } from "node:test";

await test(
  "real Codex sandbox permits work and enforces filesystem and network isolation",
  { skip: process.env.CODEX_SANDBOX_TESTS !== "true", timeout: 120_000 },
  async (t) => {
    const originalCwd = process.cwd();
    const originalCodexHome = process.env.CODEX_HOME;
    mkdirSync(".context", { recursive: true });
    const root = mkdtempSync(resolve(".context/sandbox-test-"));
    const workspace = join(root, "workspace");
    const codexHome = join(root, "codex-home");
    mkdirSync(workspace);
    mkdirSync(codexHome);
    t.after(() => {
      process.chdir(originalCwd);
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      rmSync(root, { recursive: true, force: true });
    });
    // An empty home keeps this credential-free even when run on a developer's machine.
    process.env.CODEX_HOME = codexHome;
    process.chdir(workspace);
    writeFileSync("package.json", "{}");
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "unchanged");
    const protectedFiles = [".git/config", ".agents/probe", ".codex/probe"];
    for (const file of protectedFiles) {
      mkdirSync(file.split("/")[0], { recursive: true });
      writeFileSync(file, "unchanged");
    }
    const { runSandboxed, verifySandbox } = await import("./agent.ts");
    const server = createServer((socket) => socket.destroy());
    t.after(() => server.close());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    for (const mode of ["workspace-write", "read-only"] as const) {
      await t.test(`${mode} starts and supports its permitted file operations`, () => verifySandbox(mode));
      await t.test(`${mode} refuses protected writes`, () => {
        const denied = mode === "workspace-write" ? [outside, ...protectedFiles] : [outside, "package.json"];
        runSandboxed(
          [
            "node",
            "-e",
            `const assert = require("node:assert/strict");
const fs = require("node:fs");
for (const file of ${JSON.stringify(denied)}) {
  assert.throws(() => fs.writeFileSync(file, "forbidden"), (error) =>
    ["EACCES", "EPERM", "EROFS"].includes(error.code));
}`,
          ],
          30_000,
          mode,
        );
        assert.equal(readFileSync(outside, "utf8"), "unchanged");
        for (const file of protectedFiles) assert.equal(readFileSync(file, "utf8"), "unchanged");
        assert.equal(readFileSync("package.json", "utf8"), "{}");
      });
      await t.test(`${mode} cannot connect to a listening host socket`, () => {
        runSandboxed(
          [
            "node",
            "-e",
            `const socket = require("node:net").connect(${address.port}, "127.0.0.1");
socket.on("connect", () => { socket.destroy(); process.exitCode = 1; });
socket.on("error", (error) => {
  if (!["EACCES", "EPERM", "ENETUNREACH", "ECONNREFUSED"].includes(error.code)) process.exitCode = 1;
});
socket.setTimeout(2000, () => { socket.destroy(); process.exitCode = 1; });`,
          ],
          30_000,
          mode,
        );
      });
    }
  },
);
