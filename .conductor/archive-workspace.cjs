const { execFileSync, spawnSync } = require("node:child_process");
const { readFileSync, readdirSync, realpathSync, rmSync } = require("node:fs");
const { homedir } = require("node:os");
const { basename, join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

// JS-only checks install a recent archived build instead of waiting ~15 minutes for a native one.
const KEPT_ARCHIVED_BUILDS = 3;

const workspace = process.env.CONDUCTOR_WORKSPACE_PATH;
if (process.env.CONDUCTOR_IS_LOCAL !== "1" || !workspace) process.exit(0);

function output(command, args) {
  // Compiler jobs carry long command lines, so `ps` can exceed Node's 1 MiB default buffer.
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15_000,
  });
}

function worktreePaths() {
  return output("git", ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}

function processes() {
  return output("ps", ["-axww", "-o", "pid=,ppid=,lstart=,stat=,args="])
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(\S+)\s+(.*)$/);
      if (!match || match[4].startsWith("Z")) return [];
      return [
        {
          pid: Number(match[1]),
          parent: Number(match[2]),
          started: match[3],
          command: match[5],
        },
      ];
    });
}

function isDevServer(command) {
  return (
    /(?:^|[ /])(?:expo(?:\/bin\/cli)?|@expo\/cli\/build\/bin\/cli)(?:\.js)? (?:start|run:ios)(?: |$)/.test(command)
    || /(?:^|[ /])convex(?:\/bin\/main\.js)? dev(?: |$)/.test(command)
    || /(?:^|[ /])metro(?:\/src\/cli\.js)? (?:start|serve)(?: |$)/.test(command)
    || /^npm (?:run ios|(?:run )?start|(?:exec|x) (?:expo|convex dev))(?: |$)/.test(command)
  );
}

async function stopServers() {
  const snapshot = processes();
  const ancestors = new Set([process.pid]);
  let parent = process.ppid;
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = snapshot.find((entry) => entry.pid === parent)?.parent;
  }
  const candidates = snapshot.filter((entry) => !ancestors.has(entry.pid) && isDevServer(entry.command));
  if (candidates.length === 0) return;

  const cwdResult = spawnSync(
    "lsof",
    ["-a", "-p", candidates.map((entry) => entry.pid).join(","), "-d", "cwd", "-Fpn"],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  // lsof also returns 1 when a candidate exits before it can be inspected.
  if (cwdResult.error || ![0, 1].includes(cwdResult.status)) {
    throw cwdResult.error ?? new Error(cwdResult.stderr);
  }
  const owned = new Set();
  // lsof reports canonical paths, so a symlinked workspace path must be resolved the same way.
  const root = realpathSync(workspace);
  let pid;
  for (const field of cwdResult.stdout.split("\n")) {
    if (field.startsWith("p")) pid = Number(field.slice(1));
    if (field.startsWith("n") && pid) {
      const cwd = field.slice(1);
      if (cwd === root || cwd.startsWith(`${root}/`)) owned.add(pid);
    }
  }
  // Detached workers can leave Conductor's process group but retain their parent.
  let size;
  do {
    size = owned.size;
    for (const entry of snapshot) {
      if (owned.has(entry.parent) && !ancestors.has(entry.pid)) {
        owned.add(entry.pid);
      }
    }
  } while (owned.size !== size);
  function stillRunning(entries) {
    const live = processes();
    return entries.filter((entry) =>
      live.some((current) => current.pid === entry.pid && current.started === entry.started),
    );
  }
  let remaining = stillRunning(snapshot.filter((entry) => owned.has(entry.pid)));
  if (remaining.length === 0) return;
  const stopped = remaining.length;

  function signal(entry, name) {
    try {
      process.kill(entry.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (const entry of remaining) signal(entry, "SIGTERM");
  const deadline = Date.now() + 3_000;
  while (remaining.length > 0 && Date.now() < deadline) {
    await delay(100);
    remaining = stillRunning(remaining);
  }
  // Recheck process identity so a reused PID never receives the escalation.
  for (const entry of remaining) signal(entry, "SIGKILL");
  console.log(`Stopped ${stopped} workspace development process(es).`);
}

function removeSimulators() {
  const normalize = (value) =>
    value
      .toLowerCase()
      .replaceAll(/[-_\s]+/g, " ")
      .trim()
      .replace(/^\d+(?:\.\d+)+ /, "");
  const labels = [basename(workspace), process.env.CONDUCTOR_WORKSPACE_NAME].filter(Boolean);
  const current = new Set(labels.map(normalize));
  const names = [...new Set([...current, ...worktreePaths().map((path) => normalize(basename(path)))])].sort(
    (a, b) => b.length - a.length,
  );
  const { devices } = JSON.parse(output("xcrun", ["simctl", "list", "devices", "--json"]));
  const owned = Object.entries(devices).flatMap(([runtime, entries]) => {
    if (!runtime.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")) {
      return [];
    }
    return entries.filter((device) => {
      if (!/^artlog[ _-]/i.test(device.name)) return false;
      const name = normalize(device.name.replace(/^artlog[ _-]+/i, ""));
      const owner = names.find((candidate) => name === candidate || name.startsWith(`${candidate} `));
      return current.has(owner) && !/^ v\d+(?: |$)/.test(name.slice(owner.length));
    });
  });
  for (const device of owned) {
    try {
      if (device.state !== "Shutdown") output("xcrun", ["simctl", "shutdown", device.udid]);
      output("xcrun", ["simctl", "delete", device.udid]);
      console.log(`Deleted ${device.name} (${device.udid}).`);
    } catch (error) {
      console.error(`Could not delete ${device.name} (${device.udid}): ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (owned.length === 0) return;
  // A deleted device can still have a Device Hub window. Close only exact device titles.
  // System Events and NSRunningApplication report Device Hub without a usable PID, so pgrep finds it for Accessibility.
  output("osascript", [
    "-l",
    "JavaScript",
    "-e",
    `
ObjC.import("ApplicationServices");
function run(deviceNames) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  let pids;
  try {
    pids = app.doShellScript("/usr/bin/pgrep -x DeviceHub").split(/\\s+/);
  } catch {
    return;
  }
  for (const pid of pids) {
    const deviceHub = $.AXUIElementCreateApplication(Number(pid));
    const count = Ref();
    let error = $.AXUIElementGetAttributeValueCount(deviceHub, $("AXWindows"), count);
    if (error === 0 && count[0] === 0) continue;
    // JXA rejects an untyped Ref that no call has filled, so create it only when windows exist.
    const windows = Ref();
    if (error === 0) error = $.AXUIElementCopyAttributeValues(deviceHub, $("AXWindows"), 0, count[0], windows);
    if (error !== 0) throw new Error("Could not read Device Hub windows (Accessibility error " + error + ")");
    const list = ObjC.castRefToObject(windows[0]);
    for (let index = 0; index < list.count; index++) {
      const values = Ref();
      $.AXUIElementCopyMultipleAttributeValues(list.objectAtIndex(index), $(["AXTitle", "AXCloseButton"]), 0, values);
      const attributes = ObjC.castRefToObject(values[0]);
      const title = attributes.objectAtIndex(0).js;
      if (deviceNames.some((name) => title === name || title.startsWith(name + " – iOS "))) {
        const closeError = $.AXUIElementPerformAction(attributes.objectAtIndex(1), $("AXPress"));
        if (closeError !== 0) throw new Error("Could not close Device Hub window (Accessibility error " + closeError + ")");
      }
    }
  }
}`,
    ...owned.map((device) => device.name),
  ]);
}

function removeBuilds() {
  const derivedData = join(homedir(), "Library/Developer/Xcode/DerivedData");
  let entries;
  try {
    entries = readdirSync(derivedData);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const current = realpathSync(workspace);
  const live = worktreePaths().filter((path) => path !== current);
  const archived = entries.flatMap((name) => {
    if (!/^artlog-/i.test(name)) return [];
    let info;
    try {
      info = readFileSync(join(derivedData, name, "info.plist"), "utf8");
    } catch {
      return [];
    }
    const value = (key) => info.match(new RegExp(`<key>${key}</key>\\s*<\\w+>([^<]*)<`))?.[1];
    const project = value("WorkspacePath");
    if (!project || live.some((path) => project === path || project.startsWith(`${path}/`))) return [];
    return [{ name, accessed: value("LastAccessedDate") ?? "" }];
  });
  // Xcode writes ISO 8601 UTC dates, so string order is time order.
  archived.sort((a, b) => b.accessed.localeCompare(a.accessed));
  const removed = archived.slice(KEPT_ARCHIVED_BUILDS);
  for (const { name } of removed) rmSync(join(derivedData, name), { recursive: true, force: true });
  if (removed.length > 0) console.log(`Deleted ${removed.length} Xcode build(s) of archived workspaces.`);
}

function reportFailure(error) {
  console.error(`Workspace cleanup failed: ${error.message}`);
  process.exitCode = 1;
}

stopServers().catch(reportFailure).then(removeSimulators).catch(reportFailure).then(removeBuilds).catch(reportFailure);
