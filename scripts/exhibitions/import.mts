import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type ViewingPeriod = { startDate: string | null; endDate: string };
export type ImportRecord = {
  venueKey: string;
  title: string;
  sourceUrl: string;
  sourceSha256: string;
  checkedAt: number;
  timeZone: string;
  viewingPeriods: ViewingPeriod[];
  imageUrl?: string;
  imageCheckedAt?: number;
};
type Museum = { id: string; key: string; name: string; website: string; optOut: boolean };
type Counts = { inserted: number; updated: number; unchanged: number };
type DeploymentType = "dev" | "preview" | "prod";
type Options = {
  input: string;
  museums: string;
  output: string;
  deploymentName: string;
  deploymentType: DeploymentType;
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const usage =
  "Usage: node --experimental-strip-types scripts/exhibitions/import.mts --input <verified JSON> --museums <directory JSON> --deployment-name <literal cloud name> --deployment-type <dev|preview|prod> --output <receipt JSON in .context>";
const batchSize = 100;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a nonempty trimmed string`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  const result = string(value, label);
  const timestamp = Date.parse(`${result}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result)
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== result
  ) {
    throw new Error(`${label} must be a real YYYY-MM-DD date`);
  }
  return result;
}

function url(value: unknown, label: string, httpsOnly = true): string {
  const result = string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (
    !(httpsOnly ? parsed.protocol === "https:" : ["http:", "https:"].includes(parsed.protocol))
    || parsed.username
    || parsed.password
    || parsed.hostname === "localhost"
    || /^[\d.]+$/.test(parsed.hostname)
    || parsed.hostname.includes(":")
  ) {
    throw new Error(`${label} must be an official HTTP(S) URL without credentials or local addresses`);
  }
  return result;
}

function normalizedTitle(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function identity(row: Pick<ImportRecord, "venueKey" | "title">): string {
  return JSON.stringify([row.venueKey, normalizedTitle(row.title)]);
}

function host(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "");
}

export function prepareImport(inputValue: unknown, directoryValue: unknown, now = Date.now()) {
  const input = object(inputValue, "input");
  const asOfDate = date(input.asOfDate, "asOfDate");
  string(input.scope, "scope");
  const museumsTested = integer(input.museumsTested, "museumsTested", 1);
  const museumCount = integer(input.museumsWithVerifiedExhibitions, "museumsWithVerifiedExhibitions", 1);
  const exhibitionCount = integer(input.exhibitionCount, "exhibitionCount", 1);
  const viewingPeriodCount = integer(input.viewingPeriodCount, "viewingPeriodCount", 1);
  const directory = new Map<string, Museum>();
  const venueKeys = new Set<string>();
  for (const [index, value] of array(directoryValue, "museum directory").entries()) {
    const label = `museum directory[${index}]`;
    const row = object(value, label);
    const id = string(row._id, `${label}._id`);
    const key = string(row.key, `${label}.key`);
    if (directory.has(id) || venueKeys.has(key)) {
      throw new Error("Museum directory contains duplicate IDs or venue keys");
    }
    directory.set(id, {
      id,
      key,
      name: string(row.name, `${label}.name`),
      website: typeof row.website === "string" ? row.website : "",
      optOut: row.optOut !== false,
    });
    venueKeys.add(key);
  }
  const selectedMuseums = new Map<string, Museum>();
  const exhibitionKeys = new Set<string>();
  const records = array(input.exhibitions, "exhibitions").map((value, index): ImportRecord => {
    const label = `exhibitions[${index}]`;
    const row = object(value, label);
    const museumId = string(row.museumId, `${label}.museumId`);
    const museum = directory.get(museumId);
    if (!museum) throw new Error(`${label}.museumId is not in the supplied museum directory`);
    if (string(row.museumName, `${label}.museumName`) !== museum.name) {
      throw new Error(`${label}.museumName does not match its directory ID`);
    }
    if (museum.optOut) throw new Error(`${label}: museum opted out or has no explicit opt-out status`);
    const sourceUrl = url(row.sourceUrl, `${label}.sourceUrl`);
    const website = url(museum.website, `${label} museum website`, false);
    const sourceHost = host(sourceUrl);
    const museumHost = host(website);
    if (sourceHost !== museumHost && !sourceHost.endsWith(`.${museumHost}`)) {
      throw new Error(`${label}.sourceUrl is not on the museum's official website host`);
    }
    const sourceSha256 = string(row.sourceSha256, `${label}.sourceSha256`);
    if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error(`${label}.sourceSha256 must be a lowercase SHA-256`);
    const checkedAt = integer(row.checkedAt, `${label}.checkedAt`, 1);
    if (checkedAt > now + 60_000) throw new Error(`${label}.checkedAt cannot be in the future`);
    const imageCheckedAt =
      row.imageCheckedAt === undefined ? undefined : integer(row.imageCheckedAt, `${label}.imageCheckedAt`, 1);
    if (imageCheckedAt !== undefined && imageCheckedAt > now + 60_000) {
      throw new Error(`${label}.imageCheckedAt cannot be in the future`);
    }
    const timeZone = string(row.timeZone, `${label}.timeZone`);
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(now);
    } catch {
      throw new Error(`${label}.timeZone must be a valid IANA time zone`);
    }
    const periods = array(row.viewingPeriods, `${label}.viewingPeriods`);
    if (periods.length === 0) throw new Error(`${label}.viewingPeriods cannot be empty`);
    let previousEnd: string | undefined;
    const viewingPeriods = periods.map((value, periodIndex): ViewingPeriod => {
      const periodLabel = `${label}.viewingPeriods[${periodIndex}]`;
      const period = object(value, periodLabel);
      const startDate = period.startDate === null ? null : date(period.startDate, `${periodLabel}.startDate`);
      const endDate = date(period.endDate, `${periodLabel}.endDate`);
      if ((startDate !== null && startDate > endDate) || endDate < asOfDate) {
        throw new Error(`${periodLabel} is reversed or ended before asOfDate`);
      }
      if (previousEnd !== undefined && (startDate === null || startDate <= previousEnd)) {
        throw new Error(`${label}.viewingPeriods must be ordered and cannot overlap`);
      }
      previousEnd = endDate;
      return { startDate, endDate };
    });
    const result: ImportRecord = {
      venueKey: museum.key,
      title: string(row.title, `${label}.title`),
      sourceUrl,
      sourceSha256,
      checkedAt,
      timeZone,
      viewingPeriods,
      ...(row.imageUrl === undefined ? {} : { imageUrl: url(row.imageUrl, `${label}.imageUrl`) }),
      ...(imageCheckedAt === undefined ? {} : { imageCheckedAt }),
    };
    if (exhibitionKeys.has(identity(result))) throw new Error(`${label}: duplicate exhibition at the same venue`);
    exhibitionKeys.add(identity(result));
    selectedMuseums.set(museum.key, museum);
    return result;
  });
  if (
    records.length !== exhibitionCount
    || records.reduce((sum, row) => sum + row.viewingPeriods.length, 0) !== viewingPeriodCount
    || selectedMuseums.size !== museumCount
    || museumCount > museumsTested
  ) {
    throw new Error("Input count metadata does not match its exhibitions, viewing periods, or museums");
  }
  return { asOfDate, records, museums: [...selectedMuseums.values()], exhibitionCount, viewingPeriodCount };
}

function options(args: string[]): Options {
  const values = new Map<string, string>();
  const allowed = ["--input", "--museums", "--output", "--deployment-name", "--deployment-type"];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith("--") || values.has(key)) throw new Error(usage);
    values.set(key, value);
  }
  if (allowed.some((key) => !values.has(key))) throw new Error(usage);
  const deploymentName = values.get("--deployment-name")!;
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+){2,}$/.test(deploymentName) || ["dev", "prod", "local"].includes(deploymentName)) {
    throw new Error("--deployment-name requires a literal cloud deployment name, never a default selector");
  }
  const deploymentType = values.get("--deployment-type")!;
  if (deploymentType !== "dev" && deploymentType !== "preview" && deploymentType !== "prod") {
    throw new Error("--deployment-type must be dev, preview, or prod");
  }
  return {
    input: resolve(values.get("--input")!),
    museums: resolve(values.get("--museums")!),
    output: resolve(values.get("--output")!),
    deploymentName,
    deploymentType,
  };
}

function inside(path: string, parent: string): boolean {
  const result = relative(parent, path);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

export async function prepareOutput(path: string) {
  const context = resolve(root, ".context");
  if (!inside(path, context)) throw new Error("--output must be inside this repository's .context directory");
  await mkdir(context, { recursive: true });
  const actualContext = await realpath(context);
  let ancestor = path;
  for (;;) {
    try {
      if (!inside(await realpath(ancestor), actualContext)) {
        throw new Error("--output cannot escape .context through a symlink");
      }
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      ancestor = dirname(ancestor);
    }
  }
  await mkdir(dirname(path), { recursive: true });
}

async function protectInputs(config: Options) {
  const output = await stat(config.output).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  for (const path of [config.input, config.museums]) {
    const input = await stat(path);
    if (config.output === path || (output && output.dev === input.dev && output.ino === input.ino)) {
      throw new Error("--output must differ from the input and museum directory");
    }
  }
}

function childEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:CONVEX_(?:DEPLOYMENT|DEPLOY_KEY|SELF_HOSTED|AGENT_MODE|AUTH|ADMIN)|OPENAI_|CODEX_API_KEY|ANTHROPIC_|TAVILY_)/.test(
          key,
        ),
    ),
  );
}

async function matchingDeployKey(config: Options): Promise<string> {
  let key = process.env.CONVEX_DEPLOY_KEY;
  if (!key) {
    const source = await readFile(join(root, ".env.local"), "utf8");
    const assignments = source.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?CONVEX_DEPLOY_KEY\s*=/.test(line));
    if (assignments.length !== 1) {
      throw new Error("A single matching CONVEX_DEPLOY_KEY is required in the environment or .env.local");
    }
    key = assignments[0].replace(/^\s*(?:export\s+)?CONVEX_DEPLOY_KEY\s*=\s*/, "").trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1);
    }
  }
  const prefix = `${config.deploymentType}:${config.deploymentName}|`;
  if (!key.startsWith(prefix) || key.length === prefix.length || /\s/.test(key)) {
    throw new Error("CONVEX_DEPLOY_KEY does not match the explicitly selected deployment type and name");
  }
  return key;
}

async function runConvex(functionName: string, args: unknown, envFile: string): Promise<unknown> {
  return new Promise((accept, reject) => {
    const child = spawn(
      "npx",
      ["--no-install", "convex", "run", functionName, JSON.stringify(args), "--env-file", envFile],
      {
        cwd: root,
        env: childEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let exceeded = false;
    const timeout = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 8_000_000) {
        exceeded = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error(`${functionName}: could not start Convex CLI`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || exceeded) {
        reject(new Error(`${functionName}: Convex CLI failed; receipt does not claim completion`));
        return;
      }
      try {
        accept(JSON.parse(stdout));
      } catch {
        reject(new Error(`${functionName}: Convex CLI returned invalid JSON`));
      }
    });
  });
}

function batchCounts(value: unknown, expected: number): Counts {
  const result = object(value, "upsert result");
  const counts = {
    inserted: integer(result.inserted, "upsert result.inserted"),
    updated: integer(result.updated, "upsert result.updated"),
    unchanged: integer(result.unchanged, "upsert result.unchanged"),
  };
  if (counts.inserted + counts.updated + counts.unchanged !== expected) {
    throw new Error("Upsert result count does not match its batch");
  }
  return counts;
}

function fields(value: unknown): ImportRecord {
  const row = object(value, "readback row");
  return {
    venueKey: row.venueKey as string,
    title: row.title as string,
    sourceUrl: row.sourceUrl as string,
    sourceSha256: row.sourceSha256 as string,
    checkedAt: row.checkedAt as number,
    timeZone: row.timeZone as string,
    viewingPeriods: array(row.viewingPeriods, "readback row.viewingPeriods").map((value) => {
      const period = object(value, "readback viewing period");
      return { startDate: period.startDate as string | null, endDate: period.endDate as string };
    }),
    ...(row.imageUrl === undefined ? {} : { imageUrl: row.imageUrl as string }),
    ...(row.imageCheckedAt === undefined ? {} : { imageCheckedAt: row.imageCheckedAt as number }),
  };
}

export function verifyReadback(records: ImportRecord[], value: unknown): void {
  const expected = new Map(records.map((row) => [identity(row), row]));
  const found = new Set<string>();
  for (const valueRow of array(value, "readback")) {
    const row = fields(valueRow);
    const key = identity(row);
    const imported = expected.get(key);
    if (!imported) continue;
    if (imported.imageUrl === undefined && imported.imageCheckedAt === undefined) {
      delete row.imageUrl;
      delete row.imageCheckedAt;
    }
    if (found.has(key)) throw new Error("Readback contains duplicate imported exhibitions");
    if (JSON.stringify(row) !== JSON.stringify(imported)) {
      throw new Error("Readback differs from exact imported exhibition fields");
    }
    found.add(key);
  }
  if (found.size !== expected.size) throw new Error("Readback is missing imported exhibitions");
}

async function main() {
  const config = options(process.argv.slice(2));
  await prepareOutput(config.output);
  await protectInputs(config);
  const receipt: Record<string, unknown> = {
    status: "started",
    startedAt: new Date().toISOString(),
    deploymentName: config.deploymentName,
    deploymentType: config.deploymentType,
    inputPath: config.input,
    museumDirectoryPath: config.museums,
    stage: "local_preflight",
    writesAttempted: false,
    completedBatches: 0,
    exactReadbackMatch: false,
  };
  const save = () => writeFile(config.output, `${JSON.stringify(receipt, null, 2)}\n`);
  await save();
  let temporary: string | undefined;
  try {
    const [inputText, directoryText] = await Promise.all([
      readFile(config.input, "utf8"),
      readFile(config.museums, "utf8"),
    ]);
    receipt.inputSha256 = createHash("sha256").update(inputText).digest("hex");
    receipt.museumDirectorySha256 = createHash("sha256").update(directoryText).digest("hex");
    let inputValue: unknown;
    let directoryValue: unknown;
    try {
      inputValue = JSON.parse(inputText);
      directoryValue = JSON.parse(directoryText);
    } catch {
      throw new Error("Input and museum directory must contain valid JSON");
    }
    const prepared = prepareImport(inputValue, directoryValue);
    Object.assign(receipt, {
      asOfDate: prepared.asOfDate,
      exhibitionCount: prepared.exhibitionCount,
      viewingPeriodCount: prepared.viewingPeriodCount,
      museumCount: prepared.museums.length,
      venueKeys: prepared.museums.map((row) => row.key),
      stage: "venue_preflight",
    });
    const deployKey = await matchingDeployKey(config);
    temporary = await mkdtemp(join(root, ".context/exhibition-import-auth-"));
    const envFile = join(temporary, "target.env");
    await writeFile(
      envFile,
      `CONVEX_DEPLOYMENT=${config.deploymentType}:${config.deploymentName}\nCONVEX_DEPLOY_KEY=${deployKey}\n`,
      { mode: 0o600 },
    );
    await save();
    const venueRows = array(
      await runConvex(
        "exhibitions:venuesForImport",
        {
          venueKeys: prepared.museums.map((row) => row.key),
        },
        envFile,
      ),
      "venue preflight",
    );
    const expectedVenues = new Map(prepared.museums.map((row) => [row.key, row.name]));
    for (const value of venueRows) {
      const row = object(value, "venue preflight row");
      const key = string(row.venueKey, "venue preflight row.venueKey");
      if (expectedVenues.get(key) !== row.name) {
        throw new Error("Target deployment's venue names or keys do not match the museum directory");
      }
      if (
        row.optOut !== false
        || prepared.records.some((record) => record.venueKey === key && record.timeZone !== row.timeZone)
      ) {
        throw new Error(
          "Target deployment's museum opt-out status or time zone does not match the verified exhibitions",
        );
      }
      expectedVenues.delete(key);
    }
    if (expectedVenues.size > 0) throw new Error("Target deployment is missing museums; no exhibitions were written");
    const totals: Counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (let offset = 0; offset < prepared.records.length; offset += batchSize) {
      const records = prepared.records.slice(offset, offset + batchSize);
      Object.assign(receipt, { stage: "upsert", writesAttempted: true });
      await save();
      process.stdout.write(
        `target: ${config.deploymentType} (${config.deploymentName}); upsert ${records.length} verified exhibitions\n`,
      );
      const result = batchCounts(await runConvex("exhibitions:upsertBatch", { records }, envFile), records.length);
      for (const key of ["inserted", "updated", "unchanged"] as const) totals[key] += result[key];
      Object.assign(receipt, { completedBatches: Number(receipt.completedBatches) + 1, result: totals });
      await save();
    }
    receipt.stage = "readback";
    await save();
    const readback = await runConvex(
      "exhibitions:exportByVenueKeys",
      {
        venueKeys: prepared.museums.map((row) => row.key),
      },
      envFile,
    );
    verifyReadback(prepared.records, readback);
    Object.assign(receipt, {
      status: "completed",
      stage: "completed",
      exactReadbackMatch: true,
      completedAt: new Date().toISOString(),
      readbackExhibitionCount: prepared.exhibitionCount,
      readbackViewingPeriodCount: prepared.viewingPeriodCount,
    });
    await save();
    process.stdout.write(
      `Imported ${prepared.exhibitionCount} exhibitions / ${prepared.viewingPeriodCount} viewing periods; exact readback verified.\n`,
    );
  } catch (error) {
    Object.assign(receipt, {
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Import failed",
    });
    await save();
    throw error;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Import failed"}\n`);
    process.exitCode = 1;
  });
}
