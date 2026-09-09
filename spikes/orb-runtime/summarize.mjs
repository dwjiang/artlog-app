import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node summarize.mjs <results-directory>');
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => {
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  };
  return { n: samples.length, min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) };
}
const groups = new Map();
const memory = [];
for (const file of readdirSync(directory).filter((f) => f.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(`${directory}/${file}`, 'utf8').trim().split('\n')) {
    const record = JSON.parse(line);
    if (record.name === 'memory') {
      memory.push({ file, ...record });
      continue;
    }
    if (record.error) throw new Error(`Unresolved benchmark error in ${file}`);
    const { result } = record;
    const key = [file, record.name, result.keypoints, result.pairs ?? result.n, result.profile, result.permute].join(':');
    if (!groups.has(key)) groups.set(key, { file, name: record.name, args: record.args, samples: [], rpcMs: [], firstReadMs: [] });
    const group = groups.get(key);
    group.samples.push(...result.samples);
    group.rpcMs.push(record.rpcMs);
    if (result.firstReadMs !== undefined) group.firstReadMs.push(result.firstReadMs);
    for (const metric of ['totalMs', 'readMs', 'decodeMs', 'jsMs', 'wasmMs', 'ransacMs']) {
      if (result[metric] === undefined) continue;
      const computed = summary(result.samples.map((s) => s[metric]));
      for (const field of ['min', 'p50', 'p95', 'max']) {
        if (Math.abs(result[metric][field] - computed[field]) > 1e-7) throw new Error(`Summary mismatch in ${file}: ${metric}.${field}`);
      }
    }
    if (record.name === 'bench') {
      for (const s of result.samples) {
        if (s.pairMs.length !== result.pairs || s.totalMs + 0.001 < s.pairMs.reduce((a, b) => a + b, 0)) throw new Error(`Incomplete timing in ${file}`);
        if (result.profile === 'positive' && s.verified !== result.pairs) throw new Error(`Positive fixture failed in ${file}`);
        if (result.profile !== 'positive' && s.verified !== 0) throw new Error(`Negative fixture verified in ${file}`);
      }
    } else if (record.name === 'benchRead' && result.samples.some((s) => s.bytes !== result.n * result.keypoints * 48 || s.count !== result.n * result.keypoints)) {
      throw new Error(`Incomplete read in ${file}`);
    }
  }
}
const measurements = [...groups.values()].map(({ samples, rpcMs, firstReadMs, ...group }) => ({
  ...group,
  runs: samples.length,
  ...(group.name === 'orbBenchWasm:bench' ? {
    jsMs: summary(samples.map((s) => s.jsMs)),
    wasmMs: summary(samples.map((s) => s.wasmMs)),
    ransacMs: summary(samples.map((s) => s.ransacMs)),
    wasmMatchPlusRansacMs: summary(samples.map((s) => s.wasmMs + s.ransacMs)),
    matchingSpeedupP50: summary(samples.map((s) => s.jsMs)).p50 / summary(samples.map((s) => s.wasmMs)).p50,
    maxIterations: Math.max(...samples.map((s) => s.maxIterations)),
  } : group.name === 'bench' ? {
    totalMs: summary(samples.map((s) => s.totalMs)),
    perPairMs: summary(samples.flatMap((s) => s.pairMs)),
    verifiedCounts: [...new Set(samples.map((s) => s.verified))],
    inlierCounts: [...new Set(samples.map((s) => s.inliers))],
  } : {
    readMs: summary(samples.map((s) => s.readMs)),
    decodeMs: summary(samples.map((s) => s.decodeMs)), firstReadMs,
  }),
  actionRpcMs: summary(rpcMs),
}));
writeFileSync(`${directory}/summary.json`, `${JSON.stringify({ measurements, memory }, null, 2)}\n`);
for (const m of measurements) console.log(JSON.stringify({ file: m.file, args: m.args, runs: m.runs, totalMs: m.totalMs, readMs: m.readMs, matchingSpeedupP50: m.matchingSpeedupP50 }));
