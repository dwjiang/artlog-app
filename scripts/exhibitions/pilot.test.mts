import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { CapturedPage, ExhibitionCandidate, ExhibitionMuseum } from "./acceptance.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = fileURLToPath(new URL("./pilot.mts", import.meta.url));
let directory: string;
let inputPath: string;
let output: string;

type Fixture = {
  asOfDate: string;
  museums: {
    museum: ExhibitionMuseum;
    pages: CapturedPage[];
    candidates: ExhibitionCandidate[];
    extraction?: Record<string, unknown>;
  }[];
  truth?: {
    museumId: string;
    url: string;
    title: string;
    titleAliases?: string[];
    startDate: string | null;
    endDate: string;
  }[];
  holds?: {
    museumId: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    reason: string;
    sourceUrls: string[];
  }[];
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): Fixture {
  const url = "https://museum.example/exhibitions/art-and-light";
  const text = "Test Museum\nArt & Light\nOctober 1, 2026 – January 10, 2027\nTemporary exhibition.";
  return {
    asOfDate: "2026-10-09",
    museums: [
      {
        museum: { museumId: "test-museum", name: "Test Museum", timeZone: "America/Los_Angeles", sourceUrls: [url] },
        pages: [{ url, text, checkedAt: Date.now() - 60_000, sha256: hash(text) }],
        candidates: [
          {
            title: "Art & Light",
            url,
            startDate: "2026-10-01",
            endDate: "2027-01-10",
            dateText: "Art & Light\nOctober 1, 2026 – January 10, 2027",
            titleEvidence: "Art & Light",
            venueEvidence: "Test Museum",
            dateEvidence: "Art & Light\nOctober 1, 2026 – January 10, 2027",
            kind: "temporary_exhibition",
            venueMatch: true,
            datePrecision: "day",
          },
        ],
        extraction: {
          model: null,
          backend: "manual reference fixture",
          authentication: "not used",
          audit: { reviewer: "test" },
        },
      },
    ],
  };
}

function reviewHold(input: Fixture) {
  const row = input.museums[0];
  const candidate = row.candidates[0];
  return {
    museumId: row.museum.museumId,
    title: candidate.title,
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    reason: "Independent detail page conflicts with the captured listing closing date",
    sourceUrls: ["https://museum.example/exhibitions/review-detail"],
  };
}

beforeEach(async () => {
  await mkdir(join(root, ".context"), { recursive: true });
  directory = await mkdtemp(join(root, ".context/exhibition-pilot-test-"));
  inputPath = join(directory, "input with spaces.json");
  output = join(directory, "output with spaces");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function run(input: unknown, outputPath = output) {
  await writeFile(inputPath, typeof input === "string" ? input : JSON.stringify(input));
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", cli, "--input", inputPath, "--output", outputPath],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
}

async function json(name: string) {
  return JSON.parse(await readFile(join(output, name), "utf8"));
}

await test("replays a real contract, preserves provenance and hashes, and rejects expired exhibitions", async () => {
  const input = fixture();
  const expired = fixture().museums[0];
  expired.museum = { ...expired.museum, museumId: "expired-museum" };
  expired.pages[0].text = expired.pages[0].text.replace("2027", "2026").replace("October 1", "January 1");
  expired.pages[0].sha256 = hash(expired.pages[0].text);
  expired.candidates[0] = {
    ...expired.candidates[0],
    startDate: "2026-01-01",
    endDate: "2026-01-10",
    dateText: "Art & Light\nJanuary 1, 2026 – January 10, 2026",
    dateEvidence: "Art & Light\nJanuary 1, 2026 – January 10, 2026",
  };
  input.museums.push(expired);
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Accepted 1; rejected 1/);
  const accepted = await json("accepted.json");
  const rejected = await json("rejected.json");
  const report = await json("report.json");
  assert.equal(accepted[0].title, "Art & Light");
  assert.equal(accepted[0].sourceSha256, input.museums[0].pages[0].sha256);
  assert.equal(accepted[0].checkedAt, input.museums[0].pages[0].checkedAt);
  assert.equal(rejected[0].museumId, "expired-museum");
  assert.ok(rejected[0].reasons.includes("expired"));
  assert.equal(report.asOfDate, "2026-10-09");
  assert.equal(report.inputSha256, hash(await readFile(inputPath, "utf8")));
  assert.deepEqual(report.museums[0].extraction, input.museums[0].extraction);
  assert.deepEqual(
    report.museums.map((row: { status: string }) => row.status),
    ["fetched_with_results", "fetched_no_eligible_exhibitions"],
  );
  const markdown = await readFile(join(output, "report.md"), "utf8");
  assert.ok(markdown.includes(inputPath));
  assert.ok(markdown.includes(output));
  assert.match(markdown, /does not prove that the museum has no exhibitions/);
});

await test("distinguishes absent and unreadable sources from museums with no eligible supplied candidates", async () => {
  const input = fixture();
  input.museums[0].pages = [];
  delete input.museums[0].extraction;
  const empty = fixture().museums[0];
  empty.museum.museumId = "unreadable";
  empty.pages[0].text = " \n\t";
  empty.pages[0].sha256 = hash(empty.pages[0].text);
  input.museums.push(empty);
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const report = await json("report.json");
  assert.equal(report.acceptedCount, 0);
  assert.deepEqual(
    report.museums.map((row: { status: string }) => row.status),
    ["source_unavailable", "source_unavailable"],
  );
  assert.equal(report.museums[0].extraction, null);
});

await test("fails before writing reports when JSON is malformed or captured page hashes are corrupted", async () => {
  const malformed = await run('{"asOfDate":');
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /valid JSON/);
  const input = fixture();
  input.museums[0].pages[0].text += " Modified after capture";
  const corrupted = await run(input);
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /SHA-256 of exact page.text/);
  await assert.rejects(access(join(output, "report.json")));
});

await test("rejects duplicate museum identifiers rather than producing ambiguous accepted records", async () => {
  const input = fixture();
  input.museums.push(fixture().museums[0]);
  const result = await run(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Duplicate museumId/);
});

await test("validates clock, URLs, calendar dates and candidate structures at the CLI boundary", async () => {
  const cases: [unknown, RegExp][] = [];
  const source = fixture();
  const museum = source.museums[0];
  cases.push([{ ...source, asOfDate: "2026-02-30" }, /real YYYY-MM-DD/]);
  cases.push([
    { ...source, museums: [{ ...museum, pages: [{ ...museum.pages[0], checkedAt: Date.now() + 120_000 }] }] },
    /cannot be in the future/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, pages: [{ ...museum.pages[0], checkedAt: "2026-10-09T10:00:00Z" }] }] },
    /Unix milliseconds/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, pages: [{ ...museum.pages[0], url: "file:///capture.txt" }] }] },
    /HTTP\(S\) URL/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, museum: { ...museum.museum, timeZone: "Unknown/Zone" } }] },
    /IANA time zone/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, candidates: [{ ...museum.candidates[0], startDate: 20261001 }] }] },
    /startDate must be a nonempty string/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, candidates: [{ ...museum.candidates[0], kind: "show" }] }] },
    /kind must be one of/,
  ]);
  cases.push([
    { ...source, museums: [{ ...museum, candidates: [{ ...museum.candidates[0], venueMatch: "yes" }] }] },
    /venueMatch must be a boolean/,
  ]);
  for (const [input, message] of cases) {
    const result = await run(input);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
  await assert.rejects(access(join(output, "report.json")));
});

await test("partial reference agreement counts date errors and every miss while leaving unmatched acceptance unreviewed", async () => {
  const input = fixture();
  const row = input.museums[0];
  const colorEvidence = "Unreviewed Color\nOctober 1, 2026 – January 10, 2027";
  row.pages[0].text += `\n${colorEvidence}`;
  row.pages[0].sha256 = hash(row.pages[0].text);
  row.candidates.push({
    ...row.candidates[0],
    title: "Unreviewed Color",
    titleEvidence: "Unreviewed Color",
    dateText: colorEvidence,
    dateEvidence: colorEvidence,
  });
  input.truth = [
    {
      museumId: row.museum.museumId,
      url: row.pages[0].url,
      title: "Art & Light",
      startDate: "2026-10-02",
      endDate: "2027-01-10",
    },
    {
      museumId: row.museum.museumId,
      url: "https://museum.example/exhibitions/missed",
      title: "Missed Show",
      startDate: "2026-10-01",
      endDate: "2027-01-10",
    },
  ];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const metrics = (await json("report.json")).referenceAgreement;
  assert.equal(metrics.coverage, "partial");
  assert.equal(metrics.precisionOnReviewed, 0);
  assert.equal(metrics.recallWithinReference, 0);
  assert.equal(metrics.fieldErrors.length, 1);
  assert.equal(metrics.acceptedNotInReference.length, 1);
  assert.equal(metrics.referenceNotAccepted.length, 2);
  assert.equal(metrics.referenceCount, 2);
});

await test("reference comparison preserves distinct exhibition intervals at the same URL", async () => {
  const input = fixture();
  const row = input.museums[0];
  const second = {
    startDate: "2027-02-01",
    endDate: "2027-03-01",
    dateEvidence: "Art & Light\nFebruary 1, 2027 – March 1, 2027",
  };
  row.pages[0].text += `\n${second.dateEvidence}`;
  row.pages[0].sha256 = hash(row.pages[0].text);
  row.candidates[0].intervals = [
    {
      startDate: row.candidates[0].startDate,
      endDate: row.candidates[0].endDate,
      dateEvidence: row.candidates[0].dateEvidence,
    },
    second,
  ];
  row.candidates[0].dateEvidence = row.pages[0].text.slice("Test Museum\n".length);
  row.candidates[0].dateText = row.candidates[0].dateEvidence;
  input.truth = row.candidates[0].intervals.map((interval) => ({
    museumId: row.museum.museumId,
    url: row.pages[0].url,
    title: row.candidates[0].title,
    startDate: interval.startDate,
    endDate: interval.endDate!,
  }));
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const metrics = (await json("report.json")).referenceAgreement;
  assert.equal(metrics.exactMatches, 2);
  assert.equal(metrics.precisionOnReviewed, 1);
  assert.equal(metrics.recallWithinReference, 1);
  assert.deepEqual(metrics.referenceNotAccepted, []);
});

await test("matches reference exhibition identities across listing and detail source URLs", async () => {
  const input = fixture();
  const row = input.museums[0];
  input.truth = [
    {
      museumId: row.museum.museumId,
      url: "https://museum.example/exhibitions/",
      title: " Art & Light ",
      startDate: "2026-10-01",
      endDate: "2027-01-10",
    },
  ];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const metrics = (await json("report.json")).referenceAgreement;
  assert.equal(metrics.exactMatches, 1);
  assert.equal(metrics.precisionOnReviewed, 1);
  assert.equal(metrics.recallWithinReference, 1);
  assert.equal(metrics.fieldErrors.length, 0);
  assert.equal(metrics.sourceDifferences[0].acceptedUrl, row.pages[0].url);
});

await test("curated reference title aliases match exact dates while unlisted titles sharing a source remain unreviewed", async () => {
  const input = fixture();
  const row = input.museums[0];
  const unlistedEvidence = "Unlisted Show\nOctober 1, 2026 – January 10, 2027";
  row.pages[0].text += `\n${unlistedEvidence}`;
  row.pages[0].sha256 = hash(row.pages[0].text);
  row.candidates.push({
    ...row.candidates[0],
    title: "Unlisted Show",
    titleEvidence: "Unlisted Show",
    dateText: unlistedEvidence,
    dateEvidence: unlistedEvidence,
  });
  const reference = {
    museumId: row.museum.museumId,
    url: row.pages[0].url,
    title: "Art & Light: Selected Works",
    titleAliases: [" Art & Light "],
    startDate: "2026-10-01",
    endDate: "2027-01-10",
  };
  input.truth = [reference];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const metrics = (await json("report.json")).referenceAgreement;
  assert.equal(metrics.referenceCount, 1);
  assert.equal(metrics.exactMatches, 1);
  assert.equal(metrics.reviewedAccepted, 1);
  assert.equal(metrics.recallWithinReference, 1);
  assert.equal(metrics.acceptedNotInReference[0].title, "Unlisted Show");
  assert.deepEqual(metrics.titleAliasMatches, [
    {
      museumId: row.museum.museumId,
      referenceTitle: reference.title,
      acceptedTitle: "Art & Light",
      startDate: reference.startDate,
      endDate: reference.endDate,
    },
  ]);
  assert.deepEqual(input.truth[0], reference);
  input.truth[0].endDate = "2027-01-11";
  const wrongDate = await run(input);
  assert.equal(wrongDate.status, 0, wrongDate.stderr);
  const mismatched = (await json("report.json")).referenceAgreement;
  assert.equal(mismatched.exactMatches, 0);
  assert.equal(mismatched.referenceCount, 1);
  assert.equal(mismatched.fieldErrors.length, 1);
  assert.equal(mismatched.referenceNotAccepted[0].title, reference.title);
});

await test("validates curated title alias structures and prevents duplicate reference matches", async () => {
  const input = fixture();
  const reference = {
    museumId: input.museums[0].museum.museumId,
    title: "Canonical Title",
    url: input.museums[0].pages[0].url,
    startDate: "2026-10-01",
    endDate: "2027-01-10",
  };
  const cases: [unknown, RegExp][] = [
    [{ ...input, truth: [{ ...reference, titleAliases: "Art & Light" }] }, /titleAliases must be an array/],
    [{ ...input, truth: [{ ...reference, titleAliases: [""] }] }, /titleAliases\[0\] must be a nonempty string/],
    [{ ...input, truth: [{ ...reference, titleAliases: [17] }] }, /titleAliases\[0\] must be a nonempty string/],
    [
      {
        ...input,
        truth: [
          { ...reference, titleAliases: ["Art & Light"] },
          { ...reference, title: "Art & Light" },
        ],
      },
      /duplicate reference exhibition/,
    ],
  ];
  for (const [value, expected] of cases) {
    const result = await run(value);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
  }
  await assert.rejects(access(join(output, "report.json")));
});

await test("rejects listing candidates that bind one exhibition title to another exhibition's dates", async () => {
  const input = fixture();
  const row = input.museums[0];
  const first = "Show A\nOctober 1, 2026 – November 1, 2026";
  const second = "Show B\nDecember 1, 2026 – January 10, 2027";
  row.pages[0].text = `Test Museum\n${first}\n${second}`;
  row.pages[0].sha256 = hash(row.pages[0].text);
  const candidate = {
    ...row.candidates[0],
    title: "Show A",
    titleEvidence: "Show A",
    startDate: "2026-12-01",
    dateEvidence: second,
    dateText: second,
  };
  row.candidates = [candidate, { ...candidate, dateEvidence: `${first}\n${second}`, dateText: `${first}\n${second}` }];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await json("accepted.json"), []);
  assert.equal((await json("rejected.json")).length, 2);
});

await test("independent review holds preserve raw candidates while excluding conflicting rows from accepted reference agreement", async () => {
  const input = fixture();
  const originalCandidate = structuredClone(input.museums[0].candidates[0]);
  const hold = reviewHold(input);
  input.holds = [hold];
  input.truth = [
    {
      museumId: hold.museumId,
      title: hold.title,
      startDate: hold.startDate,
      endDate: "2027-01-10",
      url: "https://museum.example/exhibitions/reference-detail",
    },
  ];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await json("accepted.json"), []);
  const rejected = await json("rejected.json");
  assert.deepEqual(rejected[0].candidate, originalCandidate);
  assert.deepEqual(rejected[0].reasons, ["independent_review_hold"]);
  assert.equal(rejected[0].reviewReason, hold.reason);
  assert.deepEqual(rejected[0].reviewSourceUrls, hold.sourceUrls);
  assert.deepEqual(JSON.parse(await readFile(inputPath, "utf8")).museums[0].candidates[0], originalCandidate);
  const report = await json("report.json");
  assert.equal(report.reviewHoldCount, 1);
  assert.deepEqual(report.reviewHolds, [hold]);
  assert.equal(report.referenceAgreement.exactMatches, 0);
  assert.equal(report.referenceAgreement.reviewedAccepted, 0);
  assert.equal(report.referenceAgreement.recallWithinReference, 0);
  assert.equal(report.referenceAgreement.referenceCount, 1);
  assert.equal(report.referenceAgreement.referenceNotAccepted.length, 1);
  assert.match(await readFile(join(output, "report.md"), "utf8"), /Independent review holds/);
});

await test("holds on already rejected candidates remain visible without overriding existing rejection reasons", async () => {
  const input = fixture();
  input.museums[0].candidates[0].kind = "permanent";
  input.holds = [reviewHold(input)];
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const rejected = await json("rejected.json");
  assert.ok(rejected[0].reasons.includes("not_temporary_exhibition"));
  assert.ok(rejected[0].reasons.includes("independent_review_hold"));
  assert.equal((await json("report.json")).reviewHoldCount, 1);
});

await test("rejects unknown, unapproved, duplicate and unmatched independent review holds", async () => {
  const input = fixture();
  const hold = reviewHold(input);
  const cases: [unknown, RegExp][] = [
    [{ ...input, holds: [{ ...hold, museumId: "unknown" }] }, /museumId is not in museums/],
    [{ ...input, holds: [{ ...hold, sourceUrls: ["https://unapproved.example/show"] }] }, /approved official HTTPS/],
    [{ ...input, holds: [{ ...hold, endDate: "2027-01-11" }] }, /did not match a candidate/],
    [{ ...input, holds: [{ ...hold, title: "Art & Lights" }] }, /did not match a candidate/],
    [{ ...input, holds: [hold, { ...hold, title: " Art & Light " }] }, /duplicate independent review hold/],
  ];
  for (const [value, expected] of cases) {
    const result = await run(value);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
  }
  await assert.rejects(access(join(output, "report.json")));
});

await test("keeps output artifacts inside .context, including symlink destinations", async () => {
  const input = fixture();
  const outside = await run(input, join(root, "scripts/exhibitions/pilot-test-output"));
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /inside this repository's .context/);
  const link = join(directory, "external");
  await symlink(join(root, "scripts"), link);
  const escaped = await run(input, join(link, "pilot-test-output"));
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /escape .context through a symlink/);
});
