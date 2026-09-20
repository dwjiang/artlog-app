import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, test } from 'node:test';

const settings = readFileSync(new URL('./settings.toml', import.meta.url), 'utf8');
const archive = settings.match(/^archive = "([^"]+)"/m)?.[1];
let directory: string;

beforeEach(() => {
  mkdirSync('.context', { recursive: true });
  directory = mkdtempSync(join(process.cwd(), '.context/archive-test-'));
  for (const command of ['xcrun', 'git']) {
    const path = join(directory, command);
    writeFileSync(path, `#!${process.execPath}\n${command === 'git' ? `
process.stdout.write(JSON.parse(process.env.TEST_WORKTREES));
` : `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[1] === 'list') process.stdout.write(process.env.TEST_DEVICES);
else if (args[2] === process.env.TEST_FAIL_DEVICE) process.exit(1);
`}`);
    chmodSync(path, 0o755);
  }
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function runArchive(names: string[], env: Record<string, string> = {}) {
  assert.ok(archive, 'Settings must define an archive command');
  const result = spawnSync('sh', ['-c', archive], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      CONDUCTOR_IS_LOCAL: '1',
      CONDUCTOR_WORKSPACE_PATH: '/workspaces/artlog-app/ndjamena',
      CONDUCTOR_WORKSPACE_NAME: 'ndjamena',
      TEST_CALLS: join(directory, 'calls.jsonl'),
      TEST_WORKTREES: JSON.stringify('worktree /repos/artlog-app\0\0worktree /workspaces/artlog-app/ndjamena\0\0worktree /workspaces/artlog-app/ndjamena-v1\0\0'),
      TEST_DEVICES: JSON.stringify({ devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': names.map((name, index) => ({
          udid: `device-${index}`, name, state: 'Booted',
        })),
      } }),
      ...env,
    },
  });
  let calls: string[][] = [];
  try {
    calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { ...result, calls, shutdowns: calls.filter(call => call[1] === 'shutdown') };
}

test('shuts down only this workspace’s named simulators, including purpose suffixes', () => {
  const result = runArchive(['Artlog Ndjamena', 'Artlog ndjamena Review', 'Artlog Sanaa', 'iPhone 17 Pro']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, [['simctl', 'shutdown', 'device-0'], ['simctl', 'shutdown', 'device-1']]);
});

test('keeps similarly named workspaces and versioned workspaces running', () => {
  const result = runArchive(['Artlog Ndjamena-v1', 'Artlog Ndjamena V1 Review', 'Artlog Ndjamenaville', 'Artlog Ndjamena-v2']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, []);
});

test('accepts spaces and hyphens in multiword workspace names', () => {
  const result = runArchive(['Artlog Addis Ababa Guest Capture', 'Artlog addis-ababa', 'Artlog Addis Ababa-v1'], {
    CONDUCTOR_WORKSPACE_PATH: '/workspaces/artlog-app/addis-ababa',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.shutdowns.length, 2);
});

test('also matches the Conductor workspace name after a rename', () => {
  const result = runArchive(['Artlog Guest Capture', 'Artlog Ndjamena', 'Artlog Guest Capture-v1', 'Artlog Sanaa'], {
    CONDUCTOR_WORKSPACE_NAME: 'guest-capture',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, [['simctl', 'shutdown', 'device-0'], ['simctl', 'shutdown', 'device-1']]);
});

test('does nothing for cloud workspaces or absent ownership information', () => {
  for (const env of [{ CONDUCTOR_IS_LOCAL: '0' }, { CONDUCTOR_WORKSPACE_PATH: '' }]) {
    const result = runArchive(['Artlog Ndjamena'], env);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
  }
});

test('ignores already stopped devices and non-iOS runtimes', () => {
  const result = runArchive([], { TEST_DEVICES: JSON.stringify({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ name: 'Artlog Ndjamena', udid: 'stopped', state: 'Shutdown' }],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-5': [{ name: 'Artlog Ndjamena', udid: 'watch', state: 'Booted' }],
  } }) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.shutdowns, []);
});

test('reports shutdown failures and still attempts the workspace’s other devices', () => {
  const result = runArchive(['Artlog Ndjamena', 'Artlog Ndjamena Review'], { TEST_FAIL_DEVICE: 'device-0' });
  assert.equal(result.status, 1);
  assert.equal(result.shutdowns.length, 2);
  assert.match(result.stderr, /device-0/);
});
