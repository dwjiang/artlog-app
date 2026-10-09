import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const paidKeys = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "CODEX_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "TAVILY_API_KEY",
];
let directory: string;
let inputFile: string;
let outputFile: string;
let configFile: string;
let logFile: string;
let input: ReturnType<typeof evidence>;

function evidence() {
  return {
    asOfDate: "2026-10-09",
    museums: Array.from({ length: 20 }, (_, index) => {
      const text = `Museum ${index}\nBay Exhibition ${index}\nOctober 1, 2026 – December 31, 2026`;
      return {
        museum: {
          museumId: `museum-${index}`,
          name: `Museum ${index}`,
          timeZone: "America/Los_Angeles",
          sourceUrls: [`https://museum-${index}.example/exhibitions`],
          venueNames: [`Museum ${index}`],
        },
        pages: [
          {
            url: `https://museum-${index}.example/exhibitions`,
            checkedAt: Date.now() - 1000,
            text,
            sha256: createHash("sha256").update(text).digest("hex"),
          },
        ],
      };
    }),
  };
}

const fakeCodex = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const config = JSON.parse(fs.readFileSync(process.env.ARTLOG_EXTRACT_TEST_CONFIG, "utf8"));
const args = process.argv.slice(2);
const paidKeys = ${JSON.stringify(paidKeys)};
const record = (data) => fs.appendFileSync(process.env.ARTLOG_EXTRACT_TEST_LOG, JSON.stringify(data) + "\n");
const env = Object.fromEntries(paidKeys.filter(key => key in process.env).map(key => [key, process.env[key]]));
if (args[0] === "login") {
  record({ phase: "login", args, env });
  console.log(config.mode === "api-login" ? "Logged in using an API key" : "Logged in using ChatGPT");
} else {
  if (config.mode === "immediate-exit") {
    record({ phase: "started", args, env });
    console.error("Synthetic CLI early failure");
    process.exit(1);
  }
  (async () => {
    let prompt = "";
    for await (const chunk of process.stdin) prompt += chunk;
    const data = JSON.parse(prompt.slice(prompt.indexOf("\nDATA:\n") + 7));
    const index = Number(data.museum.museumId.split("-").at(-1));
    record({ phase: "started", index, args, env, promptHash: crypto.createHash("sha256").update(prompt).digest("hex") });
    if (config.mode === "failure" && index !== 0) await new Promise(resolve => setTimeout(resolve, 200));
    const value = {
      candidates: [{
        title: "Bay Exhibition " + index,
        url: data.pages[0].url,
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        dateText: "October 1, 2026 – December 31, 2026",
        titleEvidence: "Bay Exhibition " + index,
        venueEvidence: data.museum.name,
        dateEvidence: "Bay Exhibition " + index + "\nOctober 1, 2026 – December 31, 2026",
        kind: "temporary_exhibition",
        venueMatch: true,
        datePrecision: "day",
      }],
      outcomeReason: "One dated temporary exhibition found in the supplied text",
    };
    if (config.mode === "split-runs" && index === 0) {
      const dateText = "October 1–12, 2026; November 1–12, 2026";
      const candidate = value.candidates[0];
      value.candidates = [
        { ...candidate, startDate: "2026-10-01", endDate: "2026-10-12" },
        { ...candidate, startDate: "2026-11-01", endDate: "2026-11-12" },
      ].map(row => ({ ...row, dateText, dateEvidence: candidate.title + "\n" + dateText }));
    }
    if (config.mode === "invalid-schema") value.candidates = "not an array";
    if (config.mode !== "missing-output") fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify(value));
    if (config.mode === "tool") console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "echo forbidden" } }));
    if (config.mode === "unknown-tool") console.log(JSON.stringify({ type: "item.completed", item: { type: "browser_automation" } }));
    if (config.mode === "error-item") console.log(JSON.stringify({ type: "item.completed", item: { type: "error", message: "Synthetic model error" } }));
    if (config.mode === "failure" && index === 0) {
      console.log(JSON.stringify({ type: "turn.failed", error: { message: "Synthetic extraction failure" } }));
    } else {
      console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } }));
      console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 10 } }));
    }
    record({ phase: "finished", index });
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
`;

beforeEach(async () => {
  await mkdir(resolve(".context"), { recursive: true });
  directory = await mkdtemp(resolve(".context/extraction-test-"));
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "bin/codex"), `#!${process.execPath}\n${fakeCodex}`, { mode: 0o755 });
  inputFile = join(directory, "evidence.json");
  outputFile = join(directory, "extracted.json");
  configFile = join(directory, "fake-config.json");
  logFile = join(directory, "calls.jsonl");
  input = evidence();
  await writeFile(configFile, JSON.stringify({ mode: "success" }));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function run(mode = "success") {
  await writeFile(inputFile, JSON.stringify(input));
  await writeFile(configFile, JSON.stringify({ mode }));
  return execute(
    process.execPath,
    [
      "--experimental-strip-types",
      resolve("scripts/exhibitions/extract.mts"),
      "--input",
      inputFile,
      "--output",
      outputFile,
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        ...Object.fromEntries(paidKeys.map((key) => [key, "synthetic-paid-secret"])),
        PATH: `${join(directory, "bin")}:${process.env.PATH ?? ""}`,
        ARTLOG_EXTRACT_TEST_CONFIG: configFile,
        ARTLOG_EXTRACT_TEST_LOG: logFile,
      },
      encoding: "utf8",
    },
  );
}

type Call = { phase: string; index?: number; args?: string[]; env?: Record<string, string>; promptHash?: string };
async function calls(): Promise<Call[]> {
  try {
    return (await readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

await test("extracts all 20 museums from captured quotes with subscription provenance and no paid credentials", async () => {
  await run();
  const output = JSON.parse(await readFile(outputFile, "utf8"));
  assert.equal(output.asOfDate, input.asOfDate);
  assert.equal(output.museums.length, 20);
  const log = await calls();
  assert.equal(log.filter((call) => call.phase === "login").length, 1);
  assert.equal(log.filter((call) => call.phase === "started").length, 20);
  for (const call of log.filter((call) => call.phase !== "finished")) assert.deepEqual(call.env, {});
  for (const [index, record] of output.museums.entries()) {
    const captured = input.museums[index]!;
    assert.deepEqual(record.pages, captured.pages);
    assert.equal(record.candidates[0].title, `Bay Exhibition ${index}`);
    assert.equal(record.candidates[0].url, captured.pages[0]!.url);
    for (const quote of ["titleEvidence", "venueEvidence", "dateEvidence"]) {
      assert.ok(captured.pages[0]!.text.includes(record.candidates[0][quote]));
    }
    assert.equal(record.extraction.authentication, "ChatGPT subscription");
    assert.equal(record.extraction.backend, "codex");
    assert.equal(
      record.extraction.inputSha256,
      log.find((call) => call.phase === "started" && call.index === index)?.promptHash,
    );
    assert.deepEqual(record.extraction.usage, { input_tokens: 20, output_tokens: 10 });
    assert.match(await readFile(`${record.extraction.receipt}.events.jsonl`, "utf8"), /turn.completed/);
    assert.equal(await readFile(`${record.extraction.receipt}.stderr.txt`, "utf8"), "");
  }
  const args = log.find((call) => call.phase === "started")!.args!;
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes("project_doc_max_bytes=0"));
  assert.ok(args.includes("suppress_unstable_features_warning=true"));
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "multi_agent",
    "apps",
    "plugins",
    "remote_plugin",
    "view_image",
    "skill_search",
    "in_app_browser",
    "in_app_local_automation",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "image_generation",
    "hooks",
  ]) {
    assert.ok(args.includes(`features.${feature}=false`), feature);
  }
  const schema = JSON.parse(await readFile(args[args.indexOf("--output-schema") + 1]!, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.candidates.items.required.includes("dateEvidence"));
});

await test("retains every single-title viewing period from extraction through the pilot report", async () => {
  const page = input.museums[0].pages[0];
  page.text = "Museum 0\nBay Exhibition 0\nOctober 1–12, 2026; November 1–12, 2026";
  page.sha256 = createHash("sha256").update(page.text).digest("hex");
  await run("split-runs");
  const reportDirectory = join(directory, "pilot-report");
  await execute(process.execPath, [
    "--experimental-strip-types",
    resolve("scripts/exhibitions/pilot.mts"),
    "--input",
    outputFile,
    "--output",
    reportDirectory,
  ]);
  const accepted = JSON.parse(await readFile(join(reportDirectory, "accepted.json"), "utf8"));
  assert.deepEqual(
    accepted
      .filter((row: { museumId: string }) => row.museumId === "museum-0")
      .map((row: { startDate: string; endDate: string }) => [row.startDate, row.endDate]),
    [
      ["2026-10-01", "2026-10-12"],
      ["2026-11-01", "2026-11-12"],
    ],
  );
  assert.deepEqual(JSON.parse(await readFile(join(reportDirectory, "rejected.json"), "utf8")), []);
});

await test("rejects modified captured text before authentication or model execution", async () => {
  input.museums[0]!.pages[0]!.text += " tampered";
  await assert.rejects(run(), /Source hash mismatch/);
  assert.deepEqual(await calls(), []);
});

await test("rejects API-key login without starting a model call", async () => {
  await writeFile(outputFile, JSON.stringify({ previous: true }));
  await assert.rejects(run("api-login"), /Sign in to Codex using ChatGPT/);
  assert.deepEqual(
    (await calls()).map((call) => call.phase),
    ["login"],
  );
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("does not report unreadable sources as model-verified empty exhibition results", async () => {
  const empty = input.museums[0]!.pages[0]!;
  empty.text = "   \n";
  empty.sha256 = createHash("sha256").update(empty.text).digest("hex");
  await run();
  const output = JSON.parse(await readFile(outputFile, "utf8"));
  assert.deepEqual(output.museums[0].candidates, []);
  assert.equal(output.museums[0].extraction.backend, "not_run");
  assert.equal(output.museums[0].extraction.outcomeReason, "No readable official source");
  assert.equal((await calls()).filter((call) => call.phase === "started").length, 19);
});

await test("rejects attempted tool use even when the model otherwise completes", async () => {
  for (const mode of ["tool", "unknown-tool"]) {
    await assert.rejects(run(mode), /Extraction attempted a tool operation/);
    await assert.rejects(readFile(outputFile), { code: "ENOENT" });
  }
});

await test("rejects malformed structured output instead of saving a partial success", async () => {
  await assert.rejects(run("invalid-schema"), /Invalid structured extraction/);
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("does not accept an error item merely because a completed event follows", async () => {
  await assert.rejects(run("error-item"), /Incomplete extraction/);
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("requires a fresh model output rather than reusing a prior receipt or aggregate", async () => {
  await run();
  assert.equal(JSON.parse(await readFile(outputFile, "utf8")).museums.length, 20);
  await assert.rejects(run("missing-output"), /ENOENT/);
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("stops scheduling after a background failure and waits for active calls before failing", async () => {
  await writeFile(outputFile, JSON.stringify({ previous: true }));
  await assert.rejects(run("failure"), /Incomplete extraction/);
  const log = await calls();
  const started = log.filter((call) => call.phase === "started");
  assert.ok(started.length <= 4, `${started.length} calls started after a worker failed`);
  assert.equal(log.filter((call) => call.phase === "finished").length, started.length);
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("requires 20 unique museums and a valid as-of calendar date before calls", async () => {
  input.asOfDate = "2026-02-30";
  await assert.rejects(run(), /valid asOfDate/);
  input = evidence();
  input.museums[1]!.museum.museumId = input.museums[0]!.museum.museumId;
  await assert.rejects(run(), /Invalid or duplicate museum/);
  input = evidence();
  input.museums.pop();
  await assert.rejects(run(), /exactly 20 museums/);
  assert.deepEqual(await calls(), []);
});

await test("handles a CLI exiting before reading a large prompt without an unhandled stdin EPIPE", async () => {
  for (const record of input.museums) {
    record.pages[0]!.text += "x".repeat(1000000);
    record.pages[0]!.sha256 = createHash("sha256").update(record.pages[0]!.text).digest("hex");
  }
  await assert.rejects(run("immediate-exit"), (error: unknown) => {
    assert.match(String(error), /ChatGPT extraction failed/);
    assert.doesNotMatch(String(error), /Unhandled 'error' event/);
    return true;
  });
  assert.ok((await calls()).filter((call) => call.phase === "started").length <= 4);
  await assert.rejects(readFile(outputFile), { code: "ENOENT" });
});

await test("rejects invalid museum metadata and future capture provenance before authentication", async () => {
  input.museums[0]!.museum.timeZone = "not-a-time-zone";
  await assert.rejects(run(), /Invalid or duplicate museum/);
  input = evidence();
  input.museums[0]!.museum.sourceUrls = ["https://user:secret@museum.example/"];
  await assert.rejects(run(), /Invalid or duplicate museum/);
  input = evidence();
  input.museums[0]!.pages[0]!.checkedAt = Date.now() + 60000;
  await assert.rejects(run(), /Source hash mismatch/);
  assert.deepEqual(await calls(), []);
});
