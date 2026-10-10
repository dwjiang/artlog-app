import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  validateExhibitions,
  type AcceptedExhibition,
  type CapturedPage,
  type ExhibitionCandidate,
  type ExhibitionInterval,
  type ExhibitionMuseum,
  type RejectedExhibition,
} from "../../shared/exhibitions/acceptance.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type MuseumInput = {
  museum: ExhibitionMuseum;
  pages: CapturedPage[];
  candidates: ExhibitionCandidate[];
  extraction?: JsonObject;
};
type ReferenceExhibition = {
  museumId: string;
  url: string;
  title: string;
  titleAliases?: string[];
  startDate: string | null;
  endDate: string;
};
type ReviewHold = {
  museumId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  reason: string;
  sourceUrls: string[];
};
type ReviewRejection = RejectedExhibition & { reviewReason?: string; reviewSourceUrls?: string[] };
type PilotInput = { asOfDate: string; museums: MuseumInput[]; truth?: ReferenceExhibition[]; holds?: ReviewHold[] };

const root = fileURLToPath(new URL("../../", import.meta.url));
const usage =
  "Usage: node --experimental-strip-types scripts/exhibitions/pilot.mts --input <JSON> --output <directory>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? "a string" : "a nonempty string"}`);
  }
  return value;
}

function url(value: unknown, label: string): string {
  const result = string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be an absolute HTTP(S) URL without credentials`);
  }
  return result;
}

function calendarDate(value: unknown, label: string): string {
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

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function strings(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => string(item, `${label}[${index}]`));
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  for (const option of choices) if (value === option) return option;
  throw new Error(`${label} must be one of ${choices.join(", ")}`);
}

function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return typeof value === "object" && Object.values(value).every(jsonValue);
}

function provenance(value: unknown, label: string): JsonObject {
  const result = record(value, label);
  for (const key of ["model", "backend", "authentication"]) {
    if (result[key] !== undefined && result[key] !== null) string(result[key], `${label}.${key}`);
  }
  if (!jsonValue(result)) throw new Error(`${label} must contain finite JSON values`);
  return result;
}

function candidate(value: unknown, label: string): ExhibitionCandidate {
  const source = record(value, label);
  if (typeof source.venueMatch !== "boolean") throw new Error(`${label}.venueMatch must be a boolean`);
  const intervals: ExhibitionInterval[] | undefined =
    source.intervals === undefined
      ? undefined
      : array(source.intervals, `${label}.intervals`).map((value, index) => {
          const interval = record(value, `${label}.intervals[${index}]`);
          return {
            startDate: nullableString(interval.startDate, `${label}.intervals[${index}].startDate`),
            endDate: nullableString(interval.endDate, `${label}.intervals[${index}].endDate`),
            dateEvidence: string(interval.dateEvidence, `${label}.intervals[${index}].dateEvidence`, true),
          };
        });
  return {
    title: string(source.title, `${label}.title`),
    url: url(source.url, `${label}.url`),
    startDate: nullableString(source.startDate, `${label}.startDate`),
    endDate: nullableString(source.endDate, `${label}.endDate`),
    dateText: string(source.dateText, `${label}.dateText`, true),
    titleEvidence: string(source.titleEvidence, `${label}.titleEvidence`, true),
    venueEvidence: string(source.venueEvidence, `${label}.venueEvidence`, true),
    dateEvidence: string(source.dateEvidence, `${label}.dateEvidence`, true),
    kind: choice(source.kind, ["temporary_exhibition", "permanent", "event", "unknown"], `${label}.kind`),
    venueMatch: source.venueMatch,
    datePrecision: choice(source.datePrecision, ["day", "month", "season", "unknown"], `${label}.datePrecision`),
    ...(intervals === undefined ? {} : { intervals }),
  };
}

function parseInput(value: unknown, now: number): PilotInput {
  const input = record(value, "input");
  const asOfDate = calendarDate(input.asOfDate, "asOfDate");
  const museumIds = new Set<string>();
  const museums = array(input.museums, "museums").map((value, index): MuseumInput => {
    const label = `museums[${index}]`;
    const row = record(value, label);
    const source = record(row.museum, `${label}.museum`);
    const museumId = string(source.museumId, `${label}.museum.museumId`);
    if (museumIds.has(museumId)) throw new Error(`Duplicate museumId: ${museumId}`);
    museumIds.add(museumId);
    const timeZone = string(source.timeZone, `${label}.museum.timeZone`);
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(now);
    } catch {
      throw new Error(`${label}.museum.timeZone must be a valid IANA time zone`);
    }
    const museum: ExhibitionMuseum = {
      museumId,
      name: string(source.name, `${label}.museum.name`),
      timeZone,
      sourceUrls: array(source.sourceUrls, `${label}.museum.sourceUrls`).map((value, index) =>
        url(value, `${label}.museum.sourceUrls[${index}]`),
      ),
      ...(source.venueNames === undefined
        ? {}
        : { venueNames: strings(source.venueNames, `${label}.museum.venueNames`) }),
    };
    const pageUrls = new Set<string>();
    const pages = array(row.pages, `${label}.pages`).map((value, index): CapturedPage => {
      const pageLabel = `${label}.pages[${index}]`;
      const page = record(value, pageLabel);
      const pageUrl = url(page.url, `${pageLabel}.url`);
      const canonicalUrl = new URL(pageUrl).href;
      if (pageUrls.has(canonicalUrl)) throw new Error(`${pageLabel}: duplicate captured URL`);
      pageUrls.add(canonicalUrl);
      const { checkedAt } = page;
      if (
        typeof checkedAt !== "number"
        || !Number.isSafeInteger(checkedAt)
        || checkedAt <= 0
        || checkedAt > now + 60_000
      ) {
        throw new Error(`${pageLabel}.checkedAt must be positive Unix milliseconds and cannot be in the future`);
      }
      const text = string(page.text, `${pageLabel}.text`, true);
      const sha256 = string(page.sha256, `${pageLabel}.sha256`);
      if (!/^[a-f0-9]{64}$/.test(sha256) || hash(text) !== sha256) {
        throw new Error(`${pageLabel}.sha256 does not match SHA-256 of exact page.text`);
      }
      return { url: pageUrl, checkedAt, text, sha256 };
    });
    return {
      museum,
      pages,
      candidates: array(row.candidates, `${label}.candidates`).map((value, index) =>
        candidate(value, `${label}.candidates[${index}]`),
      ),
      ...(row.extraction === undefined ? {} : { extraction: provenance(row.extraction, `${label}.extraction`) }),
    };
  });
  const referenceKeys = new Set<string>();
  const truth =
    input.truth === undefined
      ? undefined
      : array(input.truth, "truth").map((value, index): ReferenceExhibition => {
          const label = `truth[${index}]`;
          const source = record(value, label);
          const museumId = string(source.museumId, `${label}.museumId`);
          if (!museumIds.has(museumId)) throw new Error(`${label}.museumId is not in museums`);
          const row = {
            museumId,
            url: url(source.url, `${label}.url`),
            title: string(source.title, `${label}.title`),
            ...(source.titleAliases === undefined
              ? {}
              : { titleAliases: strings(source.titleAliases, `${label}.titleAliases`) }),
            startDate: source.startDate === null ? null : calendarDate(source.startDate, `${label}.startDate`),
            endDate: calendarDate(source.endDate, `${label}.endDate`),
          };
          for (const key of referenceExhibitionKeys(row)) {
            if (referenceKeys.has(key)) {
              throw new Error(`${label}: duplicate reference exhibition (including title aliases)`);
            }
            referenceKeys.add(key);
          }
          return row;
        });
  const holdKeys = new Set<string>();
  const holds =
    input.holds === undefined
      ? undefined
      : array(input.holds, "holds").map((value, index): ReviewHold => {
          const label = `holds[${index}]`;
          const source = record(value, label);
          const museumId = string(source.museumId, `${label}.museumId`);
          const museum = museums.find((row) => row.museum.museumId === museumId)?.museum;
          if (!museum) throw new Error(`${label}.museumId is not in museums`);
          const sourceUrls = array(source.sourceUrls, `${label}.sourceUrls`).map((value, index) =>
            url(value, `${label}.sourceUrls[${index}]`),
          );
          if (sourceUrls.length === 0 || sourceUrls.some((source) => !approvedSource(source, museum))) {
            throw new Error(`${label}.sourceUrls must reference approved official HTTPS source hosts`);
          }
          const hold = {
            museumId,
            title: string(source.title, `${label}.title`),
            startDate: source.startDate === null ? null : calendarDate(source.startDate, `${label}.startDate`),
            endDate: source.endDate === null ? null : calendarDate(source.endDate, `${label}.endDate`),
            reason: string(source.reason, `${label}.reason`),
            sourceUrls,
          };
          const key = exhibitionKey(hold);
          if (holdKeys.has(key)) throw new Error(`${label}: duplicate independent review hold`);
          holdKeys.add(key);
          return hold;
        });
  return { asOfDate, museums, ...(truth === undefined ? {} : { truth }), ...(holds === undefined ? {} : { holds }) };
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function referenceKey(row: Pick<ReferenceExhibition, "museumId" | "title">): string {
  const title = row.title
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[‘’]/g, "'")
    .replaceAll(/[“”]/g, '"')
    .replaceAll(/[‐‑‒–—−]/g, "-")
    .replaceAll(/\s*-\s*/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim();
  return JSON.stringify([row.museumId, title]);
}

function exhibitionKey(row: Pick<ReviewHold, "museumId" | "title" | "startDate" | "endDate">): string {
  return JSON.stringify([referenceKey(row), row.startDate, row.endDate]);
}

function referenceIdentityKeys(row: ReferenceExhibition): string[] {
  return [...new Set([row.title, ...(row.titleAliases ?? [])].map((title) => referenceKey({ ...row, title })))];
}

function referenceExhibitionKeys(row: ReferenceExhibition): string[] {
  return referenceIdentityKeys(row).map((key) => JSON.stringify([key, row.startDate, row.endDate]));
}

function officialHost(source: string): string | null {
  const parsed = new URL(source);
  return parsed.protocol === "https:" ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
}

function approvedSource(source: string, museum: ExhibitionMuseum): boolean {
  const host = officialHost(source);
  return host !== null && museum.sourceUrls.some((approved) => officialHost(approved) === host);
}

function heldCandidate(row: AcceptedExhibition): ExhibitionCandidate {
  return {
    title: row.title,
    url: row.url,
    startDate: row.startDate,
    endDate: row.endDate,
    dateText: row.dateText,
    titleEvidence: row.titleEvidence,
    venueEvidence: row.venueEvidence,
    dateEvidence: row.dateEvidence,
    kind: row.kind,
    venueMatch: row.venueMatch,
    datePrecision: row.datePrecision,
  };
}

function agreement(accepted: AcceptedExhibition[], truth: ReferenceExhibition[]) {
  const acceptedKeys = new Set(accepted.map(exhibitionKey));
  const truthExhibitionKeys = new Set(truth.flatMap(referenceExhibitionKeys));
  const truthKeys = new Set(truth.flatMap(referenceIdentityKeys));
  const exactMatch = (row: ReferenceExhibition) => referenceExhibitionKeys(row).some((key) => acceptedKeys.has(key));
  const matchedErrorKeys = new Set<string>();
  const fieldErrors = truth
    .filter((row) => !exactMatch(row))
    .flatMap((expected) => {
      const actual = accepted.find(
        (row) =>
          referenceIdentityKeys(expected).includes(referenceKey(row))
          && !truthExhibitionKeys.has(exhibitionKey(row))
          && !matchedErrorKeys.has(exhibitionKey(row)),
      );
      if (!actual) return [];
      matchedErrorKeys.add(exhibitionKey(actual));
      return [{ expected, actual: { startDate: actual.startDate, endDate: actual.endDate } }];
    });
  const exactMatches = truth.filter(exactMatch);
  const sourceDifferences = exactMatches.flatMap((expected) => {
    const actual = accepted.find((row) => referenceExhibitionKeys(expected).includes(exhibitionKey(row)));
    return actual && new URL(actual.url).href !== new URL(expected.url).href
      ? [{ museumId: expected.museumId, title: expected.title, referenceUrl: expected.url, acceptedUrl: actual.url }]
      : [];
  });
  const titleAliasMatches = exactMatches.flatMap((expected) => {
    const actual = accepted.find((row) => referenceExhibitionKeys(expected).includes(exhibitionKey(row)));
    return actual && referenceKey(actual) !== referenceKey(expected)
      ? [
          {
            museumId: expected.museumId,
            referenceTitle: expected.title,
            acceptedTitle: actual.title,
            startDate: expected.startDate,
            endDate: expected.endDate,
          },
        ]
      : [];
  });
  const reviewedAccepted = accepted.filter((row) => truthKeys.has(referenceKey(row))).length;
  return {
    coverage: "partial",
    referenceCount: truth.length,
    exactMatches: exactMatches.length,
    reviewedAccepted,
    acceptedNotInReference: accepted.filter((row) => !truthKeys.has(referenceKey(row))),
    referenceNotAccepted: truth.filter((row) => !exactMatch(row)),
    fieldErrors,
    sourceDifferences,
    titleAliasMatches,
    precisionOnReviewed: reviewedAccepted ? exactMatches.length / reviewedAccepted : null,
    recallWithinReference: truth.length > 0 ? exactMatches.length / truth.length : null,
    caveat:
      "Partial reference agreement is not global extraction precision or recall. Unmatched accepted rows remain unreviewed; every reference row remains in the recall denominator.",
  };
}

function inside(directory: string, parent: string): boolean {
  const path = relative(parent, directory);
  return (
    path === ""
    || (!path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && path !== ".." && !isAbsolute(path))
  );
}

async function outputDirectory(path: string): Promise<string> {
  const context = resolve(root, ".context");
  const output = resolve(path);
  if (!inside(output, context)) throw new Error("--output must be inside this repository's .context directory");
  await mkdir(context, { recursive: true });
  const actualContext = await realpath(context);
  let ancestor = output;
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
  await mkdir(output, { recursive: true });
  return output;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function markdown(report: ReturnType<typeof buildReport>, command: string): string {
  const lines = [
    `# Bay Area exhibition pilot — ${report.asOfDate}`,
    "",
    `Accepted: **${report.acceptedCount}**. Rejected: **${report.rejectedCount}**. Museums: **${report.museums.length}**.`,
    "",
    "This offline run validates supplied candidates against captured official pages. It does not fetch pages, run a model, or update Explore.",
    "",
    "| Museum | Source status | Accepted | Rejected |",
    "| --- | --- | ---: | ---: |",
    ...report.museums.map(
      (row) =>
        `| ${row.name.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${row.status} | ${row.acceptedCount} | ${row.rejectedCount} |`,
    ),
    "",
    "`fetched_no_eligible_exhibitions` means readable approved source text was captured, but no supplied candidate remains eligible after validation and review holds. It does not prove that the museum has no exhibitions. `source_unavailable` means no readable approved source was captured.",
    "",
    "Captured source URLs, hashes, checked times, age, and exact supplied extraction provenance appear in report.json. Missing provenance is reported as null.",
    "",
    `Input SHA-256: \`${report.inputSha256}\`. Calendar cutoff: \`${report.asOfDate}\` in each museum's time zone.`,
    "",
  ];
  if (report.referenceAgreement) {
    const metrics = report.referenceAgreement;
    const percent = (value: number | null) => (value === null ? "unmeasured" : `${(value * 100).toFixed(1)}%`);
    lines.push(
      "## Agreement with partial reference",
      "",
      `Precision on ${metrics.reviewedAccepted} reviewed accepted rows: ${percent(metrics.precisionOnReviewed)}. Recall within ${metrics.referenceCount} reference rows: ${percent(metrics.recallWithinReference)}.`,
      `Exact matches: ${metrics.exactMatches}. Date field errors: ${metrics.fieldErrors.length}. Unmatched accepted rows awaiting review: ${metrics.acceptedNotInReference.length}. Reference rows not accepted exactly: ${metrics.referenceNotAccepted.length}.`,
      `Documented title alias matches: ${metrics.titleAliasMatches.length}. Aliases match exact museum and date intervals; canonical reference titles and the denominator remain unchanged.`,
      "",
      metrics.caveat,
      "",
    );
  }
  if (report.reviewHolds.length > 0) {
    lines.push(
      "## Independent review holds",
      "",
      `Held candidate rows: ${report.reviewHoldCount}. These holds preserve the supplied extraction and remove conflicting rows from acceptance.`,
      "",
    );
    for (const hold of report.reviewHolds) {
      lines.push(`- ${hold.title.replaceAll("\n", " ")} (${hold.museumId}): ${hold.reason.replaceAll("\n", " ")}`);
    }
    lines.push("", "Reasons and official review source links are retained in rejected.json and report.json.", "");
  }
  lines.push("## Replay", "", "```sh", command, "```", "");
  return lines.join("\n");
}

function buildReport(input: PilotInput, inputSha256: string, now: number) {
  const holds = new Map((input.holds ?? []).map((hold) => [exhibitionKey(hold), hold]));
  const matchedHoldKeys = new Set<string>();
  const results = input.museums.map((row) => {
    const result = validateExhibitions({ ...row, asOfDate: input.asOfDate });
    const review = (rejection: RejectedExhibition): ReviewRejection => {
      const key = exhibitionKey({ museumId: row.museum.museumId, ...rejection.candidate });
      const hold = holds.get(key);
      if (!hold) return rejection;
      matchedHoldKeys.add(key);
      return {
        ...rejection,
        reasons: [...rejection.reasons, "independent_review_hold"],
        reviewReason: hold.reason,
        reviewSourceUrls: hold.sourceUrls,
      };
    };
    const accepted = result.accepted.filter((candidate) => !holds.has(exhibitionKey(candidate)));
    const rejected = [
      ...result.rejected.map(review),
      ...result.accepted
        .filter((candidate) => holds.has(exhibitionKey(candidate)))
        .map((candidate) => review({ candidate: heldCandidate(candidate), reasons: [] })),
    ];
    return { ...row, result: { accepted, rejected } };
  });
  for (const [key, hold] of holds) {
    if (!matchedHoldKeys.has(key)) {
      throw new Error(
        `Independent review hold did not match a candidate: ${hold.museumId} / ${hold.title} / ${hold.startDate} / ${hold.endDate}`,
      );
    }
  }
  const accepted = results.flatMap((row) => row.result.accepted);
  const rejected = results.flatMap((row) =>
    row.result.rejected.map((result) => ({ museumId: row.museum.museumId, ...result })),
  );
  const museums = results.map((row) => {
    const pages = row.pages.map((page) => ({
      url: page.url,
      checkedAt: page.checkedAt,
      sha256: page.sha256,
      readable: Boolean(page.text.trim()),
      approvedHost: approvedSource(page.url, row.museum),
      ageDays: Math.max(0, Math.floor((now - page.checkedAt) / 86_400_000)),
    }));
    return {
      museumId: row.museum.museumId,
      name: row.museum.name,
      timeZone: row.museum.timeZone,
      sourceUrls: row.museum.sourceUrls,
      pages,
      status: !pages.some((page) => page.readable && page.approvedHost)
        ? "source_unavailable"
        : row.result.accepted.length > 0
          ? "fetched_with_results"
          : "fetched_no_eligible_exhibitions",
      candidateCount: row.candidates.length,
      acceptedCount: row.result.accepted.length,
      rejectedCount: row.result.rejected.length,
      extraction: row.extraction ?? null,
    };
  });
  return {
    asOfDate: input.asOfDate,
    generatedAt: now,
    inputSha256,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    reviewHoldCount: rejected.filter((row) => row.reasons.includes("independent_review_hold")).length,
    reviewHolds: input.holds ?? [],
    museums,
    accepted,
    rejected,
    referenceAgreement: input.truth === undefined ? null : agreement(accepted, input.truth),
  };
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") throw new Error(usage);
  const inputPath = resolve(args[1]);
  const raw = await readFile(inputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("--input must contain valid JSON");
  }
  const now = Date.now();
  const input = parseInput(parsed, now);
  const report = buildReport(input, hash(raw), now);
  const output = await outputDirectory(args[3]);
  const command = `node --experimental-strip-types ${shellQuote(fileURLToPath(import.meta.url))} --input ${shellQuote(inputPath)} --output ${shellQuote(output)}`;
  for (const [name, value] of [
    ["accepted.json", report.accepted],
    ["rejected.json", report.rejected],
    ["report.json", report],
  ] as const) {
    await writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  await writeFile(join(output, "report.md"), markdown(report, command));
  process.stdout.write(
    `Accepted ${report.acceptedCount}; rejected ${report.rejectedCount}; report ${join(output, "report.md")}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
