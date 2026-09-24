import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, test } from "node:test";

const settings = readFileSync(new URL("./settings.toml", import.meta.url), "utf8");
const archive = settings.match(/^archive = '''\n([\s\S]*?)'''/m)?.[1];
const source = new URL("./archive-workspace.cjs", import.meta.url).pathname;
let directory: string;
let children: ChildProcess[];

beforeEach(() => {
  mkdirSync(".context", { recursive: true });
  directory = mkdtempSync(join(process.cwd(), ".context/archive-test-"));
  children = [];
  for (const command of ["xcrun", "git", "osascript", "ps"]) {
    const path = join(directory, command);
    writeFileSync(
      path,
      `#!${process.execPath}\n
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify([${JSON.stringify(command)}, ...args]) + '\\n');
${
  command === "git"
    ? `
if (args[0] === 'show') {
  if (process.env.TEST_MISSING_SOURCE) process.exit(128);
  process.stdout.write(fs.readFileSync(process.env.TEST_ARCHIVE_SOURCE));
} else process.stdout.write(JSON.parse(process.env.TEST_WORKTREES));
`
    : command === "xcrun"
      ? `
if (process.env.TEST_FAIL_XCRUN) process.exit(1);
if (args[1] === 'list') process.stdout.write(process.env.TEST_DEVICES);
else if (args[2] === process.env.TEST_FAIL_DEVICE) process.exit(1);
`
      : command === "ps"
        ? `
if (process.env.TEST_FAIL_PS) process.exit(1);
if (process.env.TEST_LONG_PROCESS_LIST) {
  const line = '  1 0 Wed Sep 23 04:24:00 2026 S swift-frontend ' + '-Xcc '.repeat(4000) + '\\n';
  process.stdout.write(line.repeat(100));
}
if (process.env.TEST_REAL_PROCESSES) require('node:child_process').spawnSync('/bin/ps', args, { stdio: 'inherit' });
`
        : `
if (process.env.TEST_FAIL_WINDOWS) process.exit(1);
`
}`,
    );
    chmodSync(path, 0o755);
  }
});

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  rmSync(directory, { recursive: true, force: true });
});

function runArchive(names: string[], env: Record<string, string> = {}) {
  assert.ok(archive, "Settings must define an archive command");
  rmSync(join(directory, "calls.jsonl"), { force: true });
  const result = spawnSync("sh", ["-c", archive], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      CONDUCTOR_IS_LOCAL: "1",
      CONDUCTOR_WORKSPACE_PATH: "/workspaces/artlog-app/ndjamena",
      CONDUCTOR_WORKSPACE_NAME: "ndjamena",
      TEST_CALLS: join(directory, "calls.jsonl"),
      TEST_ARCHIVE_SOURCE: source,
      TEST_WORKTREES: JSON.stringify(
        "worktree /repos/artlog-app\0\0worktree /workspaces/artlog-app/ndjamena\0\0worktree /workspaces/artlog-app/ndjamena-v1\0\0",
      ),
      TEST_DEVICES: JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": names.map((name, index) => ({
            udid: `device-${index}`,
            name,
            state: "Booted",
          })),
        },
      }),
      ...env,
    },
  });
  let calls: string[][] = [];
  try {
    calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    ...result,
    calls,
    shutdowns: calls.filter((call) => call[0] === "xcrun" && call[2] === "shutdown").map((call) => call.slice(1)),
    windows: calls.filter((call) => call[0] === "osascript").flatMap((call) => call.slice(3)),
  };
}

await test("shuts down only this workspace’s named simulators, including purpose suffixes", () => {
  const result = runArchive(["Artlog Ndjamena", "Artlog ndjamena Review", "Artlog Sanaa", "iPhone 17 Pro"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, [
    ["simctl", "shutdown", "device-0"],
    ["simctl", "shutdown", "device-1"],
  ]);
  assert.deepEqual(result.windows, ["Artlog Ndjamena", "Artlog ndjamena Review"]);
});

await test("keeps similarly named workspaces and versioned workspaces running", () => {
  const result = runArchive([
    "Artlog Ndjamena-v1",
    "Artlog Ndjamena V1 Review",
    "Artlog Ndjamenaville",
    "Artlog Ndjamena-v2",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, []);
});

await test("accepts spaces and hyphens in multiword workspace names", () => {
  const result = runArchive(["Artlog Addis Ababa Guest Capture", "Artlog addis-ababa", "Artlog Addis Ababa-v1"], {
    CONDUCTOR_WORKSPACE_PATH: "/workspaces/artlog-app/addis-ababa",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.shutdowns.length, 2);
});

await test("also matches the Conductor workspace name after a rename", () => {
  const result = runArchive(["Artlog Guest Capture", "Artlog Ndjamena", "Artlog Guest Capture-v1", "Artlog Sanaa"], {
    CONDUCTOR_WORKSPACE_NAME: "guest-capture",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, [
    ["simctl", "shutdown", "device-0"],
    ["simctl", "shutdown", "device-1"],
  ]);
});

await test("does nothing for cloud workspaces or absent ownership information", () => {
  for (const env of [{ CONDUCTOR_IS_LOCAL: "0" }, { CONDUCTOR_WORKSPACE_PATH: "" }]) {
    const result = runArchive(["Artlog Ndjamena"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => call[0]),
      env.CONDUCTOR_IS_LOCAL === "0" ? [] : ["git"],
    );
  }
});

await test("closes stopped iOS windows without repeating shutdown or touching non-iOS devices", () => {
  const result = runArchive([], {
    TEST_DEVICES: JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          { name: "Artlog Ndjamena", udid: "stopped", state: "Shutdown" },
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-26-5": [
          { name: "Artlog Ndjamena", udid: "watch", state: "Booted" },
        ],
      },
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, []);
  assert.deepEqual(result.windows, ["Artlog Ndjamena"]);
});

await test("reports shutdown failures and still attempts the workspace’s other devices", () => {
  const result = runArchive(["Artlog Ndjamena", "Artlog Ndjamena Review"], {
    TEST_FAIL_DEVICE: "device-0",
  });
  assert.equal(result.status, 1);
  assert.equal(result.shutdowns.length, 2);
  assert.match(result.stderr, /device-0/);
});

await test("matches numbered display names without claiming another workspace", () => {
  const result = runArchive(
    ["Artlog 03.07 Kelowna", "Artlog Kelowna Review", "Artlog 03.07 Kelowna-v1", "Artlog 03.08 Sanaa"],
    {
      CONDUCTOR_WORKSPACE_PATH: "/workspaces/artlog-app/kelowna",
      CONDUCTOR_WORKSPACE_NAME: "03.07 Kelowna",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, [
    ["simctl", "shutdown", "device-0"],
    ["simctl", "shutdown", "device-1"],
  ]);
});

await test("loads cleanup from the remote default branch even when the checkout has no script", () => {
  const result = runArchive([], { CONDUCTOR_DEFAULT_BRANCH: "develop" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls[0], ["git", "show", "origin/develop:.conductor/archive-workspace.cjs"]);
});

await test("reports a missing default-branch script instead of silently skipping cleanup", () => {
  const result = runArchive([], { TEST_MISSING_SOURCE: "1" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(
    result.calls.map((call) => call[0]),
    ["git"],
  );
});

await test("reports window cleanup failures", () => {
  const result = runArchive(["Artlog Ndjamena"], { TEST_FAIL_WINDOWS: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Workspace cleanup failed/);
});

await test("reads process lists larger than Node's default output buffer", () => {
  const result = runArchive([], { TEST_LONG_PROCESS_LIST: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

await test("still closes simulators when process discovery fails", () => {
  const result = runArchive(["Artlog Ndjamena"], { TEST_FAIL_PS: "1" });
  assert.equal(result.status, 1);
  assert.deepEqual(result.shutdowns, [["simctl", "shutdown", "device-0"]]);
  assert.deepEqual(result.windows, ["Artlog Ndjamena"]);
});

async function startProcess(cwd: string, title: string, stubborn = false) {
  mkdirSync(cwd, { recursive: true });
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    process.title = ${JSON.stringify(title)};
    ${stubborn ? 'process.on("SIGTERM", () => {});' : ""}
    require('node:net').createServer().listen(0, '127.0.0.1', () => process.send('ready'));
  `,
    ],
    { cwd, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  children.push(child);
  await once(child, "message");
  return child;
}

await test("stops workspace dev servers on arbitrary ports while preserving sibling servers and tooling", async () => {
  const workspace = join(directory, "workspace");
  const server = await startProcess(workspace, "node /app/node_modules/.bin/expo start --port 8199");
  const runner = await startProcess(workspace, "npm start --dev-client --port 8199");
  const backend = await startProcess(join(workspace, "backend"), "node /app/node_modules/.bin/convex dev");
  const sibling = await startProcess(`${workspace}-v1`, "node /app/node_modules/.bin/expo start");
  const tooling = await startProcess(workspace, "node /app/node_modules/.bin/convex mcp start");
  const exits = [once(server, "exit"), once(runner, "exit"), once(backend, "exit")];
  symlinkSync(workspace, join(directory, "workspace-link"));
  const result = runArchive([], {
    TEST_REAL_PROCESSES: "1",
    CONDUCTOR_WORKSPACE_PATH: join(directory, "workspace-link"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await Promise.all(exits), [
    [null, "SIGTERM"],
    [null, "SIGTERM"],
    [null, "SIGTERM"],
  ]);
  assert.match(result.stdout, /Stopped 3 workspace/);
  assert.ok(sibling.pid && process.kill(sibling.pid, 0));
  assert.ok(tooling.pid && process.kill(tooling.pid, 0));
});

await test("escalates unresponsive dev servers and still cleans up when Xcode fails", async () => {
  const workspace = join(directory, "workspace");
  const server = await startProcess(workspace, "node /app/node_modules/expo/bin/cli run:ios", true);
  const exit = once(server, "exit");
  const result = runArchive([], {
    TEST_REAL_PROCESSES: "1",
    CONDUCTOR_WORKSPACE_PATH: workspace,
    TEST_FAIL_XCRUN: "1",
  });
  assert.equal(result.status, 1);
  assert.deepEqual(await exit, [null, "SIGKILL"]);
  assert.match(result.stderr, /Workspace cleanup failed/);
});

await test("stops detached workers descended from the workspace server", async () => {
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const server = spawn(
    process.execPath,
    [
      "-e",
      `
    process.title = 'node /app/node_modules/.bin/expo start';
    const worker = require('node:child_process').spawn(process.execPath, ['-e',
      'setInterval(() => {}, 1000); process.send("ready");'
    ], { detached: true, cwd: '/', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    worker.on('message', () => process.send(worker.pid));
    worker.on('exit', () => process.exit());
    process.on('SIGTERM', () => {});
  `,
    ],
    { cwd: workspace, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  children.push(server);
  const [workerPid] = await once(server, "message");
  const exit = once(server, "exit");
  try {
    const result = runArchive([], {
      TEST_REAL_PROCESSES: "1",
      CONDUCTOR_WORKSPACE_PATH: workspace,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await exit, [0, null]);
    assert.throws(() => process.kill(workerPid, 0), { code: "ESRCH" });
  } finally {
    try {
      process.kill(workerPid, "SIGKILL");
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
    }
  }
});
