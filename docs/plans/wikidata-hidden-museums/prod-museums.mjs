// Prod museum snapshot, hidden insert, and readback verification through already-deployed internal functions.
// Usage (from the repository root):
//   node <dir>/prod-museums.mjs snapshot --work <work>              → <work>/prod-before.json
//   node <dir>/prod-museums.mjs apply --work <work> --pilot         → first 100 rows of <work>/rows.json
//   node <dir>/prod-museums.mjs apply --work <work>                 → every row (resumes from checkpoint)
//   node <dir>/prod-museums.mjs verify --work <work>                → <work>/production-receipt.json
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const deployment = "admired-goldfinch-660";
const [command, ...flags] = process.argv.slice(2);
const work = resolve(flags[flags.indexOf("--work") + 1] ?? "");
if (!["snapshot", "apply", "verify"].includes(command) || !flags.includes("--work")) {
  console.error("usage: prod-museums.mjs snapshot|apply|verify --work <dir> [--pilot]");
  process.exit(2);
}
const cli = resolve("node_modules/.bin/convex");
const cliHome = `${work}/cli-home`;
// A directory without .env.local, plus a stripped environment, keeps the dev deploy key from overriding --deployment.
mkdirSync(cliHome, { recursive: true });
if (!existsSync(`${cliHome}/convex.json`)) writeFileSync(`${cliHome}/convex.json`, "{}\n");
if (!existsSync(`${cliHome}/package.json`)) {
  writeFileSync(
    `${cliHome}/package.json`,
    JSON.stringify({ private: true, dependencies: { convex: "1.45.0" } }, null, 2) + "\n",
  );
}
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CONVEX_|OPENAI_|ANTHROPIC_|TAVILY_|NEBIUS_|TOKEN_FACTORY_|TOKENFACTORY_)/.test(key),
  ),
);
async function run(fn, args) {
  const { stdout } = await execute(
    cli,
    ["run", fn, JSON.stringify(args), "--deployment", deployment, "--codegen", "disable", "--typecheck", "disable"],
    { cwd: cliHome, env, timeout: 300000, maxBuffer: 64000000 },
  );
  return JSON.parse(stdout);
}
async function snapshot() {
  const rows = [];
  let cursor;
  for (let page = 0; page < 400; page++) {
    const result = await run("museumAudit:exportPage", cursor ? { cursor } : {});
    rows.push(...result.page);
    if (result.isDone) return rows;
    if (!result.continueCursor || result.continueCursor === cursor) throw new Error("Cursor did not advance");
    cursor = result.continueCursor;
  }
  throw new Error("More than 400 pages of museums; STOP and report");
}
const counts = (rows) => ({
  rows: rows.length,
  hidden: rows.filter((row) => row.excludedFromDiscovery === true).length,
});

if (command === "snapshot") {
  const rows = await snapshot();
  writeFileSync(`${work}/prod-before.json`, JSON.stringify(rows));
  console.log(JSON.stringify({ ...counts(rows), visible: rows.length - counts(rows).hidden }));
}

if (command === "apply") {
  const rows = JSON.parse(readFileSync(`${work}/rows.json`, "utf8"));
  const beforeKeys = new Set(JSON.parse(readFileSync(`${work}/prod-before.json`, "utf8")).map((row) => row.key));
  const selected = flags.includes("--pilot") ? rows.slice(0, 100) : rows;
  const checkpointPath = `${work}/checkpoint.json`;
  const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : { done: [] };
  const done = new Set(checkpoint.done);
  for (let start = 0; start < selected.length; start += 100) {
    const batch = selected.slice(start, start + 100);
    const keys = batch.map((row) => row.key);
    if (keys.every((key) => done.has(key))) continue;
    const existing = await run("museumAudit:byKeys", { keys });
    const missing = batch.filter((_, index) => existing[index] === null);
    // A present key is this run's own insert (an interrupted batch) only if it was absent from the snapshot and
    // matches the row; anything else belongs to another writer and must never be hidden.
    const foreign = batch.filter((row, index) => {
      const saved = existing[index];
      return (
        saved && (beforeKeys.has(row.key) || saved.name !== row.name || saved.lat !== row.lat || saved.lng !== row.lng)
      );
    });
    if (foreign.length > 0) {
      throw new Error(`STOP: keys already used by other museums: ${foreign.map((row) => row.key).join(", ")}`);
    }
    if (missing.length > 0) {
      const inserted = await run("ingest:upsertMuseums", { rows: missing, insertOnly: true });
      if (Object.keys(inserted.ids).length !== missing.length) throw new Error("Insert did not acknowledge every key");
    }
    const hidden = await run("museumAudit:applyBatch", {
      records: keys.map((key) => ({ key, excludedFromDiscovery: true })),
    });
    if (hidden.changed + hidden.unchanged !== keys.length) throw new Error("Hide did not acknowledge every key");
    for (const key of keys) done.add(key);
    checkpoint.done = [...done];
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    console.log(`${Math.min(start + 100, selected.length)}/${selected.length} inserted and hidden`);
  }
}

if (command === "verify") {
  const before = JSON.parse(readFileSync(`${work}/prod-before.json`, "utf8"));
  const rows = JSON.parse(readFileSync(`${work}/rows.json`, "utf8"));
  const after = await snapshot();
  writeFileSync(`${work}/prod-after.json`, JSON.stringify(after));
  const beforeByKey = new Map(before.map((row) => [row.key, row]));
  const afterByKey = new Map(after.map((row) => [row.key, row]));
  const rowKeys = new Set(rows.map((row) => row.key));
  const stable = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : 1))));
  const problems = [];
  const changedPreserved = [];
  for (const [key, row] of beforeByKey) {
    if (!afterByKey.has(key)) problems.push(`missing preserved ${key}`);
    else if (stable(afterByKey.get(key)) !== stable(row)) changedPreserved.push(key);
  }
  for (const row of rows) {
    const saved = afterByKey.get(row.key);
    if (!saved) {
      problems.push(`missing new ${row.key}`);
      continue;
    }
    const expected = { ...row, excludedFromDiscovery: true, optOut: false, contributionRevision: 0 };
    for (const [field, value] of Object.entries(expected)) {
      if (saved[field] !== value) problems.push(`${row.key} ${field}`);
    }
    for (const field of Object.keys(saved)) {
      if (!field.startsWith("_") && !(field in expected)) problems.push(`${row.key} extra ${field}`);
    }
  }
  const receipt = {
    target: `prod (${deployment})`,
    checkedAt: new Date().toISOString(),
    before: counts(before),
    after: counts(after),
    visibleBefore: before.length - counts(before).hidden,
    visibleAfter: after.length - counts(after).hidden,
    inserted: rows.length,
    otherNewKeysDuringRun: after
      .filter((row) => !beforeByKey.has(row.key) && !rowKeys.has(row.key))
      .map((row) => row.key),
    changedPreservedRows: changedPreserved,
    problemCount: problems.length,
    problems: problems.slice(0, 50),
  };
  writeFileSync(`${work}/production-receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}
