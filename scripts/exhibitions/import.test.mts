import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, test } from "node:test";
import { promisify } from "node:util";

import { prepareImport, verifyReadback } from "./import.mts";

const execute = promisify(execFile);
const target = "usable-test-256";
const secret = `dev:${target}|synthetic-private-key`;
let directory: string;
let inputPath: string;
let museumsPath: string;
let outputPath: string;
let logPath: string;
let statePath: string;
let configPath: string;
let input: ReturnType<typeof fixture>["input"];
let museums: ReturnType<typeof fixture>["museums"];

function fixture(count = 53) {
  const museums = Array.from({ length: 13 }, (_, index) => ({
    _id: `production-id-${index}`,
    key: `wikidata:Q${index}`,
    name: `Museum ${index}`,
    website: `https://www.museum-${index}.example`,
    optOut: false,
  }));
  const exhibitions = Array.from({ length: count }, (_, index) => {
    const museum = museums[index % museums.length];
    return {
      museumId: museum._id,
      museumName: museum.name,
      title: `Verified Exhibition ${index}`,
      sourceUrl: `https://museum-${index % museums.length}.example/exhibitions/${index}`,
      sourceSha256: createHash("sha256").update(`Captured evidence ${index}`).digest("hex"),
      checkedAt: Date.now() - 60_000,
      timeZone: "America/Los_Angeles",
      viewingPeriods:
        index < 2
          ? [
              { startDate: "2026-10-01", endDate: "2026-11-20" },
              { startDate: "2026-12-01", endDate: "2027-01-01" },
            ]
          : [{ startDate: "2026-10-01", endDate: "2027-01-01" }],
    };
  });
  return {
    museums,
    input: {
      asOfDate: "2026-10-09",
      scope: "Local verified pilot",
      museumsTested: 20,
      museumsWithVerifiedExhibitions: 13,
      exhibitionCount: count,
      viewingPeriodCount: count + 2,
      exhibitions,
    },
  };
}

const fakeCli = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(process.env.ARTLOG_IMPORT_TEST_CONFIG, "utf8"));
const fn = args[3];
const value = JSON.parse(args[4]);
const envPath = args[args.indexOf("--env-file") + 1];
const auth = fs.readFileSync(envPath, "utf8");
const expected = "CONVEX_DEPLOYMENT=dev:usable-test-256\nCONVEX_DEPLOY_KEY=dev:usable-test-256|synthetic-private-key\n";
if (auth !== expected || (fs.statSync(envPath).mode & 0o777) !== 0o600) throw Error("Incorrect isolated auth file");
const forbidden = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TAVILY_API_KEY"];
if (forbidden.some(key => process.env[key])) throw Error("Credential env was not isolated");
if (args.some(arg => arg.includes("synthetic-private-key"))) throw Error("Credential exposed in command args");
fs.appendFileSync(process.env.ARTLOG_IMPORT_TEST_LOG, JSON.stringify({ fn, value, args, envPath }) + "\n");
let state = fs.existsSync(process.env.ARTLOG_IMPORT_TEST_STATE) ? JSON.parse(fs.readFileSync(process.env.ARTLOG_IMPORT_TEST_STATE,"utf8")) : [];
if (fn === "exhibitions:venuesForImport") {
  let rows = value.venueKeys.map((venueKey,index) => ({venueKey,museumId:"dev-id-"+index,name:"Museum "+venueKey.slice("wikidata:Q".length),timeZone:"America/Los_Angeles",optOut:false}));
  if (config.mode === "missing-venue") rows.pop();
  if (config.mode === "wrong-name") rows[0].name = "Wrong branch museum";
  if (config.mode === "wrong-timezone") rows[0].timeZone = "America/New_York";
  if (config.mode === "opt-out") rows[0].optOut = true;
  console.log(JSON.stringify(rows));
} else if (fn === "exhibitions:upsertBatch") {
  if (config.mode === "failure") {
    console.error("DO NOT EXPOSE synthetic-private-key in failure output");
    process.exit(1);
  }
  let inserted = 0, updated = 0, unchanged = 0;
  for (const row of value.records) {
    const index = state.findIndex(item => item.venueKey === row.venueKey && item.title === row.title);
    if (index === -1) {state.push(row);inserted++;}
    else if (JSON.stringify(state[index]) === JSON.stringify(row)) unchanged++;
    else {state[index] = row;updated++;}
  }
  fs.writeFileSync(process.env.ARTLOG_IMPORT_TEST_STATE,JSON.stringify(state));
  if (config.mode === "invalid-count") inserted++;
  console.log(JSON.stringify({inserted,updated,unchanged}));
} else if (fn === "exhibitions:exportByVenueKeys") {
  let rows = state.map((row,index) => ({exhibitionId:"dev-exhibition-"+index,museumId:"dev-id-"+index,finalEndAt:1234,...row,
    viewingPeriods:row.viewingPeriods.map(period=>({endDate:period.endDate,startDate:period.startDate}))}));
  if (config.mode === "missing-readback") rows.pop();
  if (config.mode === "changed-readback") rows[0].sourceSha256 = "0".repeat(64);
  if (config.mode === "duplicate-readback") rows.push(rows[0]);
  if (config.mode === "unrelated-readback") rows.push({...rows[0],title:"Previously imported unrelated exhibition"});
  if (config.mode === "invalid-json") console.log("not-json"); else console.log(JSON.stringify(rows));
} else throw Error("Unexpected function");
`;

beforeEach(async () => {
  await mkdir(resolve(".context"), { recursive: true });
  directory = await mkdtemp(resolve(".context/exhibition-import-test-"));
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "bin/npx"), `#!${process.execPath}\n${fakeCli}`, { mode: 0o755 });
  inputPath = join(directory, "verified input.json");
  museumsPath = join(directory, "museum directory.json");
  outputPath = join(directory, "receipt.json");
  logPath = join(directory, "calls.jsonl");
  statePath = join(directory, "fake-state.json");
  configPath = join(directory, "fake-config.json");
  ({ input, museums } = fixture());
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function run(mode = "success", key = secret, extraArgs: string[] = []) {
  await writeFile(inputPath, JSON.stringify(input));
  await writeFile(museumsPath, JSON.stringify(museums));
  await writeFile(configPath, JSON.stringify({ mode }));
  return execute(
    process.execPath,
    [
      "--experimental-strip-types",
      resolve("scripts/exhibitions/import.mts"),
      "--input",
      inputPath,
      "--museums",
      museumsPath,
      "--output",
      outputPath,
      "--deployment-name",
      target,
      "--deployment-type",
      "dev",
      ...extraArgs,
    ],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY: key,
        CONVEX_DEPLOYMENT: "prod:wrong-project-999",
        CONVEX_SELF_HOSTED_URL: "https://wrong.example",
        CONVEX_SELF_HOSTED_ADMIN_KEY: "synthetic-secret",
        OPENAI_API_KEY: "synthetic-secret",
        ANTHROPIC_API_KEY: "synthetic-secret",
        TAVILY_API_KEY: "synthetic-secret",
        PATH: `${join(directory, "bin")}:${process.env.PATH ?? ""}`,
        ARTLOG_IMPORT_TEST_CONFIG: configPath,
        ARTLOG_IMPORT_TEST_LOG: logPath,
        ARTLOG_IMPORT_TEST_STATE: statePath,
      },
    },
  );
}

async function receipt() {
  return JSON.parse(await readFile(outputPath, "utf8"));
}
async function calls(): Promise<{ fn: string; value: { records?: unknown[] }; args: string[]; envPath: string }[]> {
  try {
    return (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

await test("maps production museum IDs to stable venue keys and preserves all 53 shows / 55 periods", () => {
  const prepared = prepareImport(input, museums);
  assert.equal(prepared.records.length, 53);
  assert.equal(prepared.viewingPeriodCount, 55);
  assert.equal(prepared.museums.length, 13);
  assert.equal(prepared.records[0].venueKey, museums[0].key);
  assert.ok(!("museumId" in prepared.records[0]));
});

await test("carries a show's preview image through import and requires it back exactly", () => {
  const withImage = structuredClone(input);
  withImage.exhibitions[0] = { ...withImage.exhibitions[0], imageUrl: "https://cdn.museum-0.example/tides.jpg" };
  const rows = prepareImport(withImage, museums).records;
  assert.equal(rows[0].imageUrl, "https://cdn.museum-0.example/tides.jpg");
  assert.ok(!("imageUrl" in rows[1]));
  verifyReadback(rows, rows);
  const { imageUrl: _dropped, ...withoutImage } = rows[0];
  assert.throws(() => verifyReadback(rows, [withoutImage, ...rows.slice(1)]), /differs/);
  withImage.exhibitions[0].imageUrl = "http://cdn.museum-0.example/tides.jpg";
  assert.throws(() => prepareImport(withImage, museums), /imageUrl must be an official HTTP\(S\) URL/);
});

await test("imports in one atomic pilot batch, isolates a matching credential, and verifies exact readback", async () => {
  const result = await run();
  assert.match(result.stdout, /Imported 53 exhibitions \/ 55 viewing periods; exact readback verified/);
  const saved = await receipt();
  assert.equal(saved.status, "completed");
  assert.equal(saved.exactReadbackMatch, true);
  assert.equal(saved.readbackExhibitionCount, 53);
  assert.equal(saved.readbackViewingPeriodCount, 55);
  assert.deepEqual(saved.result, { inserted: 53, updated: 0, unchanged: 0 });
  assert.equal(
    saved.inputSha256,
    createHash("sha256")
      .update(await readFile(inputPath, "utf8"))
      .digest("hex"),
  );
  const invoked = await calls();
  assert.deepEqual(
    invoked.map((call) => call.fn),
    ["exhibitions:venuesForImport", "exhibitions:upsertBatch", "exhibitions:exportByVenueKeys"],
  );
  assert.equal(invoked[1].value.records?.length, 53);
  assert.ok(invoked.every((call) => !call.args.includes("--push") && !call.args.includes("--prod")));
  assert.ok(!(await readFile(outputPath, "utf8")).includes("synthetic-private-key"));
  await assert.rejects(access(invoked[0].envPath));
});

await test("replaying the same verified file is idempotent", async () => {
  await run();
  await run();
  assert.deepEqual((await receipt()).result, { inserted: 0, updated: 0, unchanged: 53 });
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).length, 53);
});

await test("supports bounded batches for larger inputs without claiming an incomplete run finished", async () => {
  ({ input, museums } = fixture(123));
  await run();
  assert.deepEqual(
    (await calls()).filter((call) => call.fn === "exhibitions:upsertBatch").map((call) => call.value.records?.length),
    [100, 23],
  );
  assert.equal((await receipt()).completedBatches, 2);
});

await test("rejects malformed counts, hashes, dates, time zones, or official source URLs before invoking Convex", async () => {
  const mutations: ((value: typeof input) => void)[] = [
    (value) => {
      value.exhibitionCount = 52;
    },
    (value) => {
      value.viewingPeriodCount = 54;
    },
    (value) => {
      value.museumsWithVerifiedExhibitions = 12;
    },
    (value) => {
      value.exhibitions[0].sourceSha256 = "invalid";
    },
    (value) => {
      value.exhibitions[0].viewingPeriods[0].startDate = "2026-02-30";
    },
    (value) => {
      value.exhibitions[0].viewingPeriods[1].startDate = "2026-11-20";
    },
    (value) => {
      value.exhibitions[0].timeZone = "Not/A_Timezone";
    },
    (value) => {
      value.exhibitions[0].checkedAt = Date.now() + 120_000;
    },
    (value) => {
      value.exhibitions[0].sourceUrl = "https://museum-0.example.attacker.example/exhibition";
    },
    (value) => {
      value.exhibitions[0].sourceUrl = "https://user:secret@museum-0.example/exhibition";
    },
    (value) => {
      value.exhibitions[0].sourceUrl = "http://museum-0.example/exhibition";
    },
  ];
  for (const mutate of mutations) {
    ({ input, museums } = fixture());
    mutate(input);
    await assert.rejects(run());
    assert.equal((await receipt()).status, "failed");
    assert.equal((await receipt()).writesAttempted, false);
    assert.deepEqual(await calls(), []);
  }
});

await test("rejects missing or duplicate local museum IDs, wrong names, opt-outs and duplicate exhibitions", () => {
  const { input: value, museums: rows } = fixture();
  assert.throws(() => prepareImport(value, rows.slice(1)), /museumId is not/);
  assert.throws(() => prepareImport(value, [...rows, rows[0]]), /duplicate IDs or venue keys/);
  const changed = structuredClone(value);
  changed.exhibitions[0].museumName = "Wrong branch";
  assert.throws(() => prepareImport(changed, rows), /museumName does not match/);
  assert.throws(
    () =>
      prepareImport(
        value,
        rows.map((row) => ({ ...row, optOut: true })),
      ),
    /opted out/,
  );
  changed.exhibitions[0] = { ...value.exhibitions[13], title: ` ${value.exhibitions[13].title}` };
  assert.throws(() => prepareImport(changed, rows), /trimmed string/);
  changed.exhibitions[0] = { ...value.exhibitions[13], title: value.exhibitions[13].title.toUpperCase() };
  assert.throws(() => prepareImport(changed, rows), /duplicate exhibition/);
});

await test("rejects credentials bound to another deployment or type before invoking Convex", async () => {
  for (const key of [`dev:another-test-256|secret`, `prod:${target}|secret`, `preview:${target}|secret`]) {
    await assert.rejects(run("success", key), /does not match/);
    assert.equal((await receipt()).status, "failed");
    assert.equal((await receipt()).writesAttempted, false);
    assert.deepEqual(await calls(), []);
  }
});

await test("requires an explicit literal target instead of a default or ambiguous deployment selector", async () => {
  for (const selector of ["prod", "dev", "local", "project:prod", "dev/username"]) {
    await assert.rejects(
      execute(process.execPath, [
        "--experimental-strip-types",
        resolve("scripts/exhibitions/import.mts"),
        "--input",
        inputPath,
        "--museums",
        museumsPath,
        "--output",
        outputPath,
        "--deployment-name",
        selector,
        "--deployment-type",
        "dev",
      ]),
      /literal cloud deployment name/,
    );
  }
  assert.deepEqual(await calls(), []);
});

await test("missing target venues, changed names, opted-out venues, or wrong time zones block writes", async () => {
  for (const mode of ["missing-venue", "wrong-name", "wrong-timezone", "opt-out"]) {
    await rm(logPath, { force: true });
    await assert.rejects(run(mode));
    assert.equal((await receipt()).status, "failed");
    assert.equal((await receipt()).writesAttempted, false);
    assert.deepEqual(
      (await calls()).map((call) => call.fn),
      ["exhibitions:venuesForImport"],
    );
  }
});

await test("failed mutations, invalid result counts, or malformed readback never produce a success receipt", async () => {
  for (const mode of [
    "failure",
    "invalid-count",
    "missing-readback",
    "changed-readback",
    "duplicate-readback",
    "invalid-json",
  ]) {
    await rm(statePath, { force: true });
    await assert.rejects(run(mode), (error) => {
      assert.ok(!String(error).includes("synthetic-private-key"));
      return true;
    });
    const saved = await receipt();
    assert.equal(saved.status, "failed");
    assert.equal(saved.exactReadbackMatch, false);
    assert.equal(saved.writesAttempted, true);
    assert.ok(!(await readFile(outputPath, "utf8")).includes("synthetic-private-key"));
  }
});

await test("unrelated pre-existing exhibitions do not invalidate exact imported field readback", async () => {
  await run("unrelated-readback");
  assert.equal((await receipt()).status, "completed");
  const rows = prepareImport(input, museums).records;
  assert.throws(() => verifyReadback(rows, rows.slice(1)), /missing imported/);
});

await test("a failed replay replaces its previous success receipt", async () => {
  await run();
  input.exhibitionCount = 50;
  await assert.rejects(run());
  assert.equal((await receipt()).status, "failed");
  assert.equal((await receipt()).exactReadbackMatch, false);
});

await test("refuses to overwrite either input, including symbolic and hard link aliases", async () => {
  const originalOutput = outputPath;
  for (const source of [inputPath, museumsPath]) {
    for (const alias of ["same", "symlink", "hardlink"] as const) {
      await writeFile(inputPath, JSON.stringify(input));
      await writeFile(museumsPath, JSON.stringify(museums));
      await rm(originalOutput, { force: true });
      if (alias === "symlink") await symlink(source, originalOutput);
      if (alias === "hardlink") await link(source, originalOutput);
      outputPath = alias === "same" ? source : originalOutput;
      await assert.rejects(run(), /output must differ from the input and museum directory/);
      assert.deepEqual(JSON.parse(await readFile(inputPath, "utf8")), input);
      assert.deepEqual(JSON.parse(await readFile(museumsPath, "utf8")), museums);
      assert.deepEqual(await calls(), []);
    }
  }
  outputPath = originalOutput;
});

await test("preserves and verifies the independent image revision", () => {
  const enriched = structuredClone(input);
  Object.assign(enriched.exhibitions[0], { imageUrl: "https://cdn.example/show.jpg", imageCheckedAt: Date.now() });
  const rows = prepareImport(enriched, museums).records;
  assert.equal(rows[0].imageCheckedAt, enriched.exhibitions[0].imageCheckedAt);
  verifyReadback(rows, rows);
  assert.throws(
    () => verifyReadback(rows, [{ ...rows[0], imageCheckedAt: rows[0].imageCheckedAt! + 1 }, ...rows.slice(1)]),
    /differs/,
  );
  Object.assign(enriched.exhibitions[0], { imageCheckedAt: Date.now() + 120_000 });
  assert.throws(() => prepareImport(enriched, museums), /imageCheckedAt/);
});
