#!/bin/sh

if [ "${CONDUCTOR_IS_LOCAL:-0}" = "1" ]; then
node <<'NODE'
const { execFileSync } = require('node:child_process');
const { basename } = require('node:path');
if (!process.env.CONDUCTOR_WORKSPACE_PATH) process.exit(0);
// A renamed workspace keeps its folder, so devices may carry either name.
const labels = [...new Set([basename(process.env.CONDUCTOR_WORKSPACE_PATH), process.env.CONDUCTOR_WORKSPACE_NAME].filter(Boolean))];

const normalize = value => value.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
const current = new Set(labels.map(normalize));
const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' });
const names = [...new Set([
  ...current,
  ...worktrees.split('\0').filter(field => field.startsWith('worktree '))
    .map(field => normalize(basename(field.slice('worktree '.length)))),
])].sort((a, b) => b.length - a.length);
const { devices } = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' }));
let matched = 0;
for (const [runtime, entries] of Object.entries(devices)) {
  if (!runtime.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-')) continue;
  for (const device of entries) {
    if (device.state !== 'Booted') continue;
    const name = normalize(device.name);
    const owner = names.find(candidate => name === `artlog ${candidate}` || name.startsWith(`artlog ${candidate} `));
    if (!current.has(owner)) continue;
    // A version suffix denotes another workspace, even after its worktree is removed.
    if (/^ v\d+(?: |$)/.test(name.slice(`artlog ${owner}`.length))) continue;
    matched++;
    try {
      // Simulator closes this device's window after shutdown; its other windows stay open.
      execFileSync('xcrun', ['simctl', 'shutdown', device.udid], { stdio: 'inherit' });
      console.log(`Stopped ${device.name} (${device.udid}).`);
    } catch {
      console.error(`Could not stop ${device.name} (${device.udid}).`);
      process.exitCode = 1;
    }
  }
}
if (!matched) console.log(`No running iOS simulators named ${labels.map(label => `Artlog ${label}`).join(' or ')}.`);
NODE
fi
