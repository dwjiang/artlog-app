const { execFileSync, spawnSync } = require("node:child_process");
const { realpathSync } = require("node:fs");
const { basename } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

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

function stopSimulators() {
  const normalize = (value) =>
    value
      .toLowerCase()
      .replaceAll(/[-_\s]+/g, " ")
      .trim()
      .replace(/^\d+(?:\.\d+)+ /, "");
  const labels = [basename(workspace), process.env.CONDUCTOR_WORKSPACE_NAME].filter(Boolean);
  const current = new Set(labels.map(normalize));
  const worktrees = output("git", ["worktree", "list", "--porcelain", "-z"]);
  const names = [
    ...new Set([
      ...current,
      ...worktrees
        .split("\0")
        .filter((field) => field.startsWith("worktree "))
        .map((field) => normalize(basename(field.slice("worktree ".length)))),
    ]),
  ].sort((a, b) => b.length - a.length);
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
    if (device.state === "Shutdown") continue;
    try {
      output("xcrun", ["simctl", "shutdown", device.udid]);
      console.log(`Stopped ${device.name} (${device.udid}).`);
    } catch (error) {
      console.error(`Could not stop ${device.name} (${device.udid}): ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (owned.length === 0) return;
  // A shutdown device can still have a window. Close only exact device titles.
  output("osascript", [
    "-e",
    `
on run deviceNames
  tell application "System Events"
    if not (exists process "Simulator") then return
    tell process "Simulator"
      repeat with windowIndex from (count windows) to 1 by -1
        set simulatorWindow to window windowIndex
        set windowTitle to name of simulatorWindow
        repeat with deviceName in deviceNames
          if windowTitle is (deviceName as text) or windowTitle starts with ((deviceName as text) & " – iOS ") then
            perform action "AXPress" of (first button of simulatorWindow whose subrole is "AXCloseButton")
            exit repeat
          end if
        end repeat
      end repeat
    end tell
  end tell
end run`,
    ...owned.map((device) => device.name),
  ]);
}

function reportFailure(error) {
  console.error(`Workspace cleanup failed: ${error.message}`);
  process.exitCode = 1;
}

stopServers().catch(reportFailure).then(stopSimulators).catch(reportFailure);
