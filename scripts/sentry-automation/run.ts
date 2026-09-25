import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { directory, runAgent, runSandboxed, type Assessment } from "./agent.ts";
import {
  BRANCH,
  ISSUE,
  LABELS,
  ORGANIZATION,
  PROJECT,
  REPOSITORY,
  SHA,
  assertPatchPaths,
  eligiblePull,
  issueAlreadyTracked,
  latestState,
  productionEvidence,
  readState,
  stateMarker,
  type GithubItem,
  type Pull,
  type State,
} from "./policy.ts";
import { git, github, githubPages, request, required } from "./services.ts";

type Issue = {
  id: string;
  shortId: string;
  project: { slug: string };
  status: string;
};
type Comment = {
  body: string;
  user: { login: string };
};
export type Plan = {
  kind: "none" | "create" | "update" | "review" | "escalate";
  mainSha: string;
  headSha: string;
  branch: string;
  number: number;
  issue: string;
  issueId: string;
  rounds: number;
  title: string;
  body: string;
  review: Assessment;
  patchHash: string;
};

const output = resolve(directory, "publish");
const patchPath = resolve(output, "change.patch");
const planPath = resolve(output, "plan.json");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const issueUrl = (id: string) => `https://sentry.io/organizations/${ORGANIZATION}/issues/${id}/?environment=production`;

function summary(text: string): void {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n\n`);
}

function save(plan: Plan, patch = ""): void {
  const serialized = JSON.stringify(plan, null, 2);
  const auth =
    process.env.CODEX_HOME && existsSync(resolve(process.env.CODEX_HOME, "auth.json"))
      ? JSON.parse(readFileSync(resolve(process.env.CODEX_HOME, "auth.json"), "utf8"))
      : {};
  const secrets = [process.env.GH_TOKEN, process.env.SENTRY_AUTH_TOKEN, ...Object.values(auth.tokens ?? {})];
  if (
    secrets.some(
      (secret) => typeof secret === "string" && secret.length > 12 && `${serialized}\n${patch}`.includes(secret),
    )
  ) {
    throw new Error("Refusing to upload output containing a credential");
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(planPath, serialized);
  writeFileSync(patchPath, patch);
}

function empty(mainSha: string, body: string): Plan {
  return {
    kind: "none",
    mainSha,
    headSha: mainSha,
    branch: "",
    number: 0,
    issue: "",
    issueId: "",
    rounds: 0,
    title: "",
    body,
    review: { status: "skip", title: "", body: "" },
    patchHash: "",
  };
}

function escalation(
  mainSha: string,
  fix: Assessment,
  problem: string,
  target: Pick<Plan, "headSha" | "branch" | "number" | "issue" | "issueId" | "rounds">,
): Plan {
  return { ...empty(mainSha, `${problem}\n\n${fix.body}`), ...target, kind: "escalate", title: fix.title };
}

const allGithubItems = () => githubPages<GithubItem>("issues?state=all&sort=updated&direction=desc");

async function sentry<T>(path: string, params: Record<string, string>): Promise<T> {
  return request<T>(`https://sentry.io/api/0/${path}?${new URLSearchParams(params)}`, required("SENTRY_AUTH_TOKEN"));
}

async function events(issueId: string): Promise<unknown[]> {
  const now = Date.now();
  const result = await sentry<unknown[]>(`organizations/${ORGANIZATION}/issues/${issueId}/events/`, {
    environment: "production",
    statsPeriod: "24h",
    full: "true",
    per_page: "10",
  });
  if (!Array.isArray(result)) throw new Error("Invalid Sentry event response");
  return result.map((event) => productionEvidence(event, issueId, now)).filter((event) => event !== null);
}

function capturePatch(): string {
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  if (untracked.length > 0) {
    assertPatchPaths(untracked, "");
    git("add", "--intent-to-add", "--", ...untracked);
  }
  const paths = git("diff", "--name-only", "-z", "HEAD").split("\0").filter(Boolean);
  if (paths.length === 0) return "";
  assertPatchPaths(paths, git("diff", "--raw", "HEAD"));
  const patch = `${git("diff", "--binary", "HEAD")}\n`;
  if (patch.length > 500_000 || patch.includes("GIT binary patch")) {
    throw new Error("Patch is too large or contains binary changes");
  }
  return patch;
}

// Dead ends become escalations so later runs move on. Failing checks still fail the run instead:
// a broken main or a flaky test would otherwise escalate every issue.
function proposal(fix: Assessment): { patch: string } | { problem: string } {
  if (fix.status !== "pass") return { problem: "The fixer found no supported fix." };
  try {
    const patch = capturePatch();
    return patch ? { patch } : { problem: "The fixer reported a fix but changed no files." };
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

function checks(): string[] {
  const before = capturePatch();
  // test:conductor is omitted: its real process and localhost fixtures hang in the sandbox, and patches cannot reach it.
  const commands = [
    ["exec", "--", "tsc", "--noEmit"],
    ["run", "lint"],
    ["run", "test:app", "--", "--runInBand"],
    ["run", "test:convex"],
    ["run", "test:model"],
    ["run", "test:sentry-automation"],
  ];
  for (const args of commands) runSandboxed(["npm", ...args], 8 * 60_000);
  if (capturePatch() !== before) throw new Error("Checks changed the working tree");
  return commands.map((args) => `npm ${args.join(" ")}`);
}

async function prepare(): Promise<void> {
  const mainSha = git("rev-parse", "origin/main");
  const pulls = await githubPages<Pull>("pulls?state=all&sort=updated&direction=desc");
  const tracked = await allGithubItems();
  const issues = await sentry<Issue[]>(`organizations/${ORGANIZATION}/issues/`, {
    project: PROJECT,
    environment: "production",
    statsPeriod: "24h",
    query: "is:unresolved",
    sort: "freq",
    limit: "100",
  });
  if (
    !Array.isArray(issues)
    || issues.some((issue) => issue.project?.slug !== PROJECT || !/^\d+$/.test(issue.id) || !ISSUE.test(issue.shortId))
  ) {
    throw new Error("Sentry returned unexpected project or issue identifiers");
  }
  if (process.env.DRY_RUN === "true") {
    if (issues[0]) await events(issues[0].id);
    if (runAgent("probe", { productionIssueCount: issues.length }, mainSha).status !== "pass") {
      throw new Error("Authentication probe failed");
    }
    save(
      empty(
        mainSha,
        "Dry run passed: subscription model access, GitHub reads and production Sentry queries. No PR changes.",
      ),
    );
    summary("Dry run passed. No pull requests were changed.");
    return;
  }

  for (const pull of pulls.filter(eligiblePull)) {
    const comments = await githubPages<Comment>(`issues/${pull.number}/comments`);
    const botComments = comments
      .filter((comment) => comment.user.login === "github-actions[bot]")
      .map((comment) => comment.body);
    const state = latestState(pull.body ?? "", botComments);
    const owned = readState(pull.body ?? "");
    const revise =
      state?.reviewedHead === pull.head.sha
      && state.verdict === "changes_requested"
      && state.rounds < 2
      && owned !== null
      && pull.draft
      && pull.user?.login === "github-actions[bot]";
    if (!revise && state?.reviewedHead === pull.head.sha) continue;
    if (!SHA.test(pull.head.sha)) throw new Error("Invalid PR commit");
    git("checkout", "--detach", pull.head.sha);
    const issue = state?.issue ?? `${pull.title}\n${pull.body ?? ""}`.match(/\bARTLOG-APP-[A-Z0-9]+\b/)?.[0];
    const issueId = state?.issueId ?? (pull.body ?? "").match(/\/issues\/(\d+)/)?.[1];
    if (!issue || !issueId) continue;
    let patch = "";
    let body = "";
    let validation: string[] = [];
    if (revise) {
      const evidence = await events(issueId);
      if (evidence.length === 0) continue;
      const fix = runAgent("fix", { issue, events: evidence, review: botComments.at(-1) }, mainSha);
      const revision = proposal(fix);
      if ("problem" in revision) {
        save(
          escalation(mainSha, fix, revision.problem, {
            headSha: pull.head.sha,
            branch: pull.head.ref,
            number: pull.number,
            issue,
            issueId,
            rounds: 2,
          }),
        );
        summary(`Stopping automatic revisions for PR #${pull.number}: ${revision.problem}`);
        return;
      }
      patch = revision.patch;
      validation = checks();
      body = fix.body;
    }
    const before = capturePatch();
    // Main's later commits would otherwise look like reverts made by the PR.
    const base = git("merge-base", mainSha, pull.head.sha);
    const review = runAgent("review", { issue, checks: validation, proposedFix: body }, base);
    if (capturePatch() !== before) throw new Error("Reviewer changed the working tree");
    if (review.status === "skip") throw new Error("Review did not complete");
    save(
      {
        kind: patch ? "update" : "review",
        mainSha,
        headSha: pull.head.sha,
        branch: pull.head.ref,
        number: pull.number,
        issue,
        issueId,
        rounds: (state?.rounds ?? 0) + (patch ? 1 : 0),
        title: `fix: ${issue}`,
        body,
        review,
        patchHash: patch ? sha256(patch) : "",
      },
      patch,
    );
    summary(
      `Prepared ${patch ? "a revision and independent review" : "an independent review"} for PR #${pull.number}.`,
    );
    return;
  }

  git("checkout", "--detach", mainSha);
  for (const issue of issues) {
    if (issueAlreadyTracked(issue.shortId, tracked)) continue;
    const evidence = await events(issue.id);
    if (evidence.length === 0) continue;
    const fix = runAgent("fix", { issue: issue.shortId, url: issueUrl(issue.id), events: evidence }, mainSha);
    const change = proposal(fix);
    if ("problem" in change) {
      save(
        escalation(mainSha, fix, change.problem, {
          headSha: mainSha,
          branch: "",
          number: 0,
          issue: issue.shortId,
          issueId: issue.id,
          rounds: 0,
        }),
      );
      summary(`Skipped ${issue.shortId}: ${change.problem} Escalating to a GitHub issue.`);
      return;
    }
    const { patch } = change;
    const validation = checks();
    const review = runAgent("review", { issue: issue.shortId, checks: validation, proposedFix: fix.body }, mainSha);
    if (capturePatch() !== patch) throw new Error("Reviewer changed the working tree");
    if (review.status === "skip") throw new Error("Review did not complete");
    save(
      {
        kind: "create",
        mainSha,
        headSha: mainSha,
        branch: `sentry-fix/${issue.shortId.toLowerCase()}`,
        number: 0,
        issue: issue.shortId,
        issueId: issue.id,
        rounds: 0,
        title: `fix: ${issue.shortId} — ${fix.title}`.slice(0, 160),
        body: `${fix.body}\n\nChecks passed:\n${validation.map((check) => `- \`${check}\``).join("\n")}`,
        review,
        patchHash: sha256(patch),
      },
      patch,
    );
    summary(`Prepared one draft fix and independent review for ${issue.shortId}.`);
    return;
  }
  save(empty(mainSha, "No new, untracked production issue with recent production evidence."));
  summary("No eligible work found.");
}

export function validatePlan(plan: Plan, patch: string): void {
  if (
    !["none", "create", "update", "review", "escalate"].includes(plan.kind)
    || !SHA.test(plan.mainSha)
    || !SHA.test(plan.headSha)
  ) {
    throw new Error("Invalid publication plan");
  }
  if (plan.kind === "none") return;
  const escalatesIssue = plan.kind === "escalate" && plan.number === 0;
  if (
    !(escalatesIssue ? plan.branch === "" : BRANCH.test(plan.branch))
    || !ISSUE.test(plan.issue)
    || !/^\d+$/.test(plan.issueId)
    || !Number.isInteger(plan.number)
    || plan.number < 0
    || !Number.isInteger(plan.rounds)
    || plan.rounds < 0
    || plan.rounds > 2
    || typeof plan.title !== "string"
    || plan.title.length > 160
    || typeof plan.body !== "string"
    || plan.body.length > 20_000
    || plan.body.includes("sentry-automation:")
    || (plan.kind !== "escalate"
      && (!["pass", "changes_requested"].includes(plan.review?.status)
        || typeof plan.review.body !== "string"
        || plan.review.body.length > 15_000
        || plan.review.body.includes("sentry-automation:")))
  ) {
    throw new Error("Invalid publication fields");
  }
  if (
    plan.kind === "create"
    && (plan.number !== 0
      || plan.rounds !== 0
      || plan.headSha !== plan.mainSha
      || plan.branch !== `sentry-fix/${plan.issue.toLowerCase()}`)
  ) {
    throw new Error("Invalid new PR");
  }
  // A PR escalation spends the remaining rounds so later reviews never restart automatic revisions.
  if (
    plan.kind === "escalate"
    && (patch
      || plan.patchHash
      || plan.rounds !== (escalatesIssue ? 0 : 2)
      || (escalatesIssue && plan.headSha !== plan.mainSha))
  ) {
    throw new Error("Invalid escalation");
  }
  if (plan.kind !== "create" && !escalatesIssue && plan.number < 1) throw new Error("Invalid existing PR");
  if (
    ["create", "update"].includes(plan.kind)
    && (!patch || patch.length > 500_000 || sha256(patch) !== plan.patchHash)
  ) {
    throw new Error("Invalid patch");
  }
  if (plan.kind === "review" && patch) throw new Error("Review cannot publish a patch");
}

async function ensureLabels(): Promise<void> {
  const labels = await githubPages<{ name: string }>("labels");
  for (const name of LABELS) {
    if (!labels.some((label) => label.name === name)) await github("labels", "POST", { name, color: "7057ff" });
  }
}

async function escalate(plan: Plan, pull: Pull | null): Promise<void> {
  if (pull) {
    const state: State = {
      issue: plan.issue,
      issueId: plan.issueId,
      rounds: plan.rounds,
      reviewedHead: plan.headSha,
      verdict: "changes_requested",
    };
    await github(`issues/${pull.number}/comments`, "POST", {
      body: `**Automatic revision skipped.** ${plan.body}\n\nAutomatic revisions have stopped; this PR needs a human.\n\n${stateMarker(state)}`,
    });
    summary(`Stopped automatic revisions: https://github.com/${REPOSITORY}/pull/${pull.number}`);
    return;
  }
  await ensureLabels();
  const issue = await github<{ html_url: string }>("issues", "POST", {
    title: `Sentry ${plan.issue}: automatic fix skipped${plan.title ? ` — ${plan.title}` : ""}`.slice(0, 160),
    body:
      `Production Sentry issue: [${plan.issue}](${issueUrl(plan.issueId)})\n\n${plan.body}\n\n`
      + "Scheduled runs never retry a Sentry issue that any PR or issue mentions. Delete this issue to allow another automatic attempt.",
    labels: LABELS,
  });
  summary(`Escalated ${plan.issue} for a human: ${issue.html_url}`);
}

// GitHub moves a PR head asynchronously after a push. Only the pre-push head is waited out;
// any other unexpected head is a real change and must fail publication.
export async function settledPull(
  load: () => Promise<Pull>,
  pushedFrom: string,
  expected: string,
  wait = () => delay(1_000),
): Promise<Pull> {
  let pull = await load();
  for (let attempt = 0; attempt < 10 && pushedFrom !== expected && pull.head.sha === pushedFrom; attempt++) {
    await wait();
    pull = await load();
  }
  return pull;
}

async function publish(): Promise<void> {
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
  const patch = readFileSync(patchPath, "utf8");
  validatePlan(plan, patch);
  if (plan.kind === "none") {
    summary("No changes to publish.");
    return;
  }
  const main = await github<{ object: { sha: string } }>("git/ref/heads/main");
  if (main.object.sha !== plan.mainSha) throw new Error("Main changed after analysis; start a new run");
  let pull: Pull | null = null;
  if (plan.number === 0) {
    if (issueAlreadyTracked(plan.issue, await allGithubItems())) {
      throw new Error("Another PR or issue already tracks this Sentry issue");
    }
    if (plan.kind === "create") {
      const refs = await github<{ ref: string }[]>(`git/matching-refs/heads/${plan.branch}`);
      if (refs.some((ref) => ref.ref === `refs/heads/${plan.branch}`)) {
        throw new Error("Target branch already exists; refusing overwrite");
      }
    }
  } else {
    pull = await github<Pull>(`pulls/${plan.number}`);
    if (!eligiblePull(pull) || pull.head.sha !== plan.headSha || pull.head.ref !== plan.branch) {
      throw new Error("PR changed or is no longer eligible");
    }
    if (plan.kind === "update" || plan.kind === "escalate") {
      const owned = readState(pull.body ?? "");
      const comments = await githubPages<Comment>(`issues/${pull.number}/comments`);
      const previous = latestState(
        pull.body ?? "",
        comments.filter((comment) => comment.user.login === "github-actions[bot]").map((comment) => comment.body),
      );
      if (
        !pull.draft
        || pull.user?.login !== "github-actions[bot]"
        || !owned
        || !previous
        || previous.issue !== plan.issue
        || previous.issueId !== plan.issueId
        || (plan.kind === "update" && previous.rounds + 1 !== plan.rounds)
        || previous.rounds >= 2
        || previous.reviewedHead !== plan.headSha
        || previous.verdict !== "changes_requested"
      ) {
        throw new Error("Revision is no longer authorized");
      }
    }
  }
  if (plan.kind === "escalate") {
    await escalate(plan, pull);
    return;
  }
  let reviewedHead = plan.headSha;
  if (plan.kind === "create" || plan.kind === "update") {
    if (patch.includes("GIT binary patch") || /(?:new|old) (?:file )?mode (?:120000|160000)/.test(patch)) {
      throw new Error("Unsupported patch mode");
    }
    git("checkout", "--detach", plan.headSha);
    git("apply", "--index", "--check", patchPath);
    git("apply", "--index", patchPath);
    assertPatchPaths(
      git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean),
      git("diff", "--cached", "--raw"),
    );
    git(
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      plan.title,
    );
    reviewedHead = git("rev-parse", "HEAD");
    // An exact expected old ref prevents races; updates must also be descendants, never rewrites.
    if (plan.kind === "update" && pull) {
      git("merge-base", "--is-ancestor", plan.headSha, reviewedHead);
      // Reserve a round before pushing so an interrupted publication cannot reset the limit.
      const reserved: State = {
        issue: plan.issue,
        issueId: plan.issueId,
        rounds: plan.rounds,
        reviewedHead: plan.headSha,
        verdict: "changes_requested",
      };
      await github(`pulls/${pull.number}`, "PATCH", {
        body: (pull.body ?? "").replace(/<!-- sentry-automation: (\{[^\n]*\}) -->/, stateMarker(reserved)),
      });
    }
    git(
      "push",
      `--force-with-lease=refs/heads/${plan.branch}:${plan.kind === "create" ? "" : plan.headSha}`,
      "origin",
      `HEAD:refs/heads/${plan.branch}`,
    );
  }
  const state: State = {
    issue: plan.issue,
    issueId: plan.issueId,
    rounds: plan.rounds,
    reviewedHead,
    verdict: plan.review.status === "pass" ? "pass" : "changes_requested",
  };
  if (plan.kind === "create") {
    await ensureLabels();
    pull = await github<Pull>("pulls", "POST", {
      title: plan.title,
      head: plan.branch,
      base: "main",
      draft: true,
      // Sentry's GitHub integration reads "Fixes <short ID>" from the PR body, which survives a retitle before merge.
      body:
        `Fixes [${plan.issue}](${issueUrl(plan.issueId)})\n\n${plan.body}\n\n`
        + "iOS simulator verification was not run on the Linux runner. Human iOS verification and manual merge are required.\n\n"
        + `Independent review of \`${reviewedHead}\`: **${state.verdict}**\n\n${plan.review.body}\n\n`
        + stateMarker(state),
    });
    await github(`issues/${pull.number}/labels`, "POST", { labels: LABELS });
  }
  if (!pull) throw new Error("No PR to review");
  const { number } = pull;
  const latest = await settledPull(() => github<Pull>(`pulls/${number}`), plan.headSha, reviewedHead);
  if (!eligiblePull(latest) || latest.head.sha !== reviewedHead) {
    throw new Error("PR changed before review publication");
  }
  await github(`issues/${pull.number}/comments`, "POST", {
    body:
      `Independent Codex review of \`${reviewedHead}\`: **${state.verdict === "pass" ? "No actionable findings" : "Changes requested"}**\n\n`
      + plan.review.body
      + `\n\nRevision rounds used: ${state.rounds}/2. Manual merge only.\n\n${stateMarker(state)}`,
  });
  summary(`Published ${plan.kind} and independent review: https://github.com/${REPOSITORY}/pull/${pull.number}`);
}

async function main(): Promise<void> {
  if (required("GITHUB_REPOSITORY") !== REPOSITORY || required("GITHUB_REF") !== "refs/heads/main") {
    throw new Error("Only this repository’s main workflow may run");
  }
  if (process.argv[2] === "prepare") await prepare();
  else if (process.argv[2] === "publish") await publish();
  else throw new Error("Expected prepare or publish");
}

if (import.meta.main) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
