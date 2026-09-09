// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./summarize.mjs', import.meta.url));
let directory: string;

function writeRun(relativePath: string, totalMs: number) {
  const path = join(directory, relativePath);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'matrix.jsonl'), `${JSON.stringify({
    name: 'bench',
    args: { pairs: 1, keypoints: 500, runs: 1 },
    rpcMs: totalMs + 1,
    result: {
      pairs: 1, keypoints: 500, profile: 'positive',
      samples: [{ totalMs, pairMs: [totalMs], verified: 1, inliers: 30 }],
    },
  })}\n`);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orb-summary-'));
  writeRun('results/2026-09-09', 100);
  writeFileSync(join(directory, 'results/2026-09-09/summary.json'), 'archived summary');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

it('requires a run directory instead of silently reading archived results', () => {
  const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Usage: node summarize.mjs <results-directory>');
  expect(readFileSync(join(directory, 'results/2026-09-09/summary.json'), 'utf8')).toBe('archived summary');
});

it('summarizes only the selected run and leaves the archive untouched', () => {
  writeRun('results/new run', 7);
  const result = spawnSync(process.execPath, [script, 'results/new run'], { cwd: directory, encoding: 'utf8' });

  expect(result.status, result.stderr).toBe(0);
  const summary = JSON.parse(readFileSync(join(directory, 'results/new run/summary.json'), 'utf8'));
  expect(summary.measurements).toHaveLength(1);
  expect(summary.measurements[0].totalMs).toEqual({ n: 1, min: 7, p50: 7, p95: 7, max: 7 });
  expect(existsSync(join(directory, 'summary.json'))).toBe(false);
  expect(readFileSync(join(directory, 'results/2026-09-09/summary.json'), 'utf8')).toBe('archived summary');
});
