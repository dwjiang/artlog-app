import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

const mode = process.argv[2] ?? 'matrix';
const output = process.argv[3] ?? `results/${new Date().toISOString().slice(0, 10)}/${mode}.jsonl`;
const deployment = process.env.CONVEX_DEPLOYMENT?.split(/\s/)[0];
const url = process.env.CONVEX_URL;
const key = process.env.CONVEX_DEPLOY_KEY;
if (!deployment?.startsWith('dev:') || url !== `https://${deployment.slice(4)}.convex.cloud` || !key?.startsWith(`${deployment}|`)) {
  throw new Error('Expected a matching disposable cloud dev deployment, URL, and deploy key');
}
const manifest = JSON.parse(readFileSync('source-manifest.json', 'utf8'));
for (const [file, sha256] of Object.entries(manifest.sha256)) {
  const actual = createHash('sha256').update(readFileSync(`convex/lib/orb/${file}`)).digest('hex');
  if (actual !== sha256) throw new Error(`ORB snapshot changed: ${file}`);
}
if (existsSync(output)) throw new Error(`Refusing to mix runs in existing file: ${output}`);
mkdirSync(dirname(output), { recursive: true });
const client = new ConvexHttpClient(url);
client.setAdminAuth(key);
async function call(name, args) {
  const at = new Date().toISOString();
  const start = performance.now();
  let record;
  try {
    const result = await client.action(makeFunctionReference(name.includes(':') ? name : `orbBench:${name}`), args);
    record = { at, deployment, name, args, rpcMs: performance.now() - start, result };
  } catch (error) {
    record = { at, deployment, name, args, rpcMs: performance.now() - start, error: String(error) };
  }
  appendFileSync(output, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify({ name, args, rpcMs: record.rpcMs, totalMs: record.result?.totalMs, readMs: record.result?.readMs, featureBytes: record.result?.featureBytes, matchingSpeedupP50: record.result?.matchingSpeedupP50, error: record.error }));
  return record;
}
async function required(name, args) {
  const record = await call(name, args);
  if (record.error) throw new Error('Benchmark failed; see saved record');
  return record.result;
}
if (mode === 'matrix') {
  // The ten-pair probe comes first because OOM here invalidates the design.
  await required('memory', { pairs: 10, keypoints: 500 });
  for (const keypoints of [300, 500]) {
    for (const pairs of [1, 10, 20]) await required('bench', { pairs, keypoints, runs: 100 });
  }
  await required('memory', { pairs: 20, keypoints: 500 });
  await required('memory', { pairs: 40, keypoints: 500 });
  for (const keypoints of [300, 500]) await required('benchRead', { n: 20, keypoints, runs: 100 });
} else if (mode === 'controls') {
  for (const profile of ['unrelated', 'inconsistent']) {
    for (const keypoints of [300, 500]) {
      await required('bench', { pairs: 10, keypoints, runs: 10, warmups: 1, profile });
      await required('bench', { pairs: 20, keypoints, runs: 10, warmups: 1, profile });
    }
  }
} else if (mode === 'fresh') {
  for (let i = 0; i < 100; i++) {
    await required('bench', { pairs: 20, keypoints: 500, runs: 1, warmups: 0, seed: 20260909 + 40 * i });
  }
} else if (mode === 'reads-permuted') {
  for (const keypoints of [300, 500]) await required('benchRead', { n: 20, keypoints, runs: 100, permute: true });
} else if (mode === 'wasm') {
  for (const profile of ['positive', 'inconsistent']) {
    for (const keypoints of [300, 500]) await required('orbBenchWasm:bench', { pairs: 10, keypoints, runs: 100, profile });
    await required('orbBenchWasm:bench', { pairs: 20, keypoints: 500, runs: 100, profile });
  }
} else if (mode === 'memory') {
  for (const pairs of [80, 160, 320, 640, 1024, 1536, 2048]) {
    const record = await call('memory', { pairs, keypoints: 500 });
    if (record.error) {
      if (!/memory|heap|isolate/i.test(record.error)) throw new Error('Non-memory failure; see saved record');
      break;
    }
  }
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
