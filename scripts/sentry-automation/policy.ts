export const REPOSITORY = "dwjiang/artlog-app";
export const ORGANIZATION = "daniel-jiang";
export const PROJECT = "artlog-app";
export const LABELS = ["agent-generated", "sentry-fix"];
export const SHA = /^[a-f0-9]{40}$/;
export const ISSUE = /^ARTLOG-APP-[A-Z0-9]+$/;
export const BRANCH = /^sentry-fix\/artlog-app-[a-z0-9]+$/;

export type Pull = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  user?: { login: string };
  labels: { name: string }[];
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
};

export type State = {
  issue: string;
  issueId: string;
  rounds: number;
  reviewedHead: string;
  verdict: "pass" | "changes_requested";
};

export function eligiblePull(pull: Pull): boolean {
  return (
    pull.state === "open"
    && pull.base.ref === "main"
    && pull.head.repo?.full_name === REPOSITORY
    && BRANCH.test(pull.head.ref)
    && LABELS.every((label) => pull.labels.some(({ name }) => name === label))
  );
}

export type GithubItem = Pick<Pull, "title" | "body">
  & Partial<Pick<Pull, "user" | "labels">> & {
    pull_request?: { url: string };
  };

export function issueAlreadyTracked(issue: string, items: GithubItem[]): boolean {
  if (!ISSUE.test(issue)) throw new Error("Invalid Sentry issue identifier");
  const pattern = new RegExp(`\\b${issue}\\b`);
  return items.some((item) => {
    // Sandbox startup failures do not establish an investigated dead end and must remain retryable.
    const failedSandboxAttempt =
      !item.pull_request
      && item.user?.login === "github-actions[bot]"
      && LABELS.every((label) => item.labels?.some(({ name }) => name === label))
      && item.title.startsWith(`Sentry ${issue}: automatic fix skipped`)
      && item.body?.includes("The fixer found no supported fix.")
      && item.body.includes("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted");
    return !failedSandboxAttempt && pattern.test(`${item.title}\n${item.body ?? ""}`);
  });
}

export function stateMarker(state: State): string {
  return `<!-- sentry-automation: ${JSON.stringify(state)} -->`;
}

export function readState(text: string): State | null {
  const match = /<!-- sentry-automation: (\{[^\n]*\}) -->/.exec(text);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    if (
      typeof value.issue !== "string"
      || !ISSUE.test(value.issue)
      || typeof value.issueId !== "string"
      || !/^\d+$/.test(value.issueId)
      || !Number.isInteger(value.rounds)
      || value.rounds < 0
      || value.rounds > 2
      || typeof value.reviewedHead !== "string"
      || !SHA.test(value.reviewedHead)
      || !["pass", "changes_requested"].includes(value.verdict)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function latestState(body: string, botComments: string[]): State | null {
  return [body, ...botComments]
    .map(readState)
    .filter((state) => state !== null)
    .reduce<State | null>((latest, state) => (!latest || state.rounds >= latest.rounds ? state : latest), null);
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

export function productionEvidence(value: unknown, issueId: string, now: number): RecordValue | null {
  const event = record(value);
  const environments = array(event.tags)
    .map(record)
    .filter((tag) => tag.key === "environment")
    .map((tag) => tag.value);
  if (event.environment !== undefined) environments.push(event.environment);
  const timestamp = Date.parse(text(event.dateCreated ?? event.datetime));
  if (
    environments.length === 0
    || environments.some((environment) => environment !== "production")
    || String(event.groupID) !== issueId
    || !Number.isFinite(timestamp)
    || timestamp < now - 24 * 60 * 60 * 1000
    || timestamp > now
  ) {
    return null;
  }
  const exceptions = array(event.entries)
    .map(record)
    .filter((entry) => entry.type === "exception")
    .flatMap((entry) => array(record(entry.data).values))
    .map(record)
    .map((exception) => ({
      type: text(exception.type),
      frames: array(record(exception.stacktrace).frames)
        .map(record)
        .map((frame) => ({
          filename: text(frame.filename),
          function: text(frame.function),
          line: typeof frame.lineNo === "number" ? frame.lineNo : null,
          inApp: frame.inApp === true,
        }))
        .slice(-40),
    }));
  return {
    eventID: text(event.eventID),
    timestamp: new Date(timestamp).toISOString(),
    environment: "production",
    exceptions,
  };
}

export function assertPatchPaths(paths: string[], modes: string): void {
  if (paths.length === 0 || paths.length > 30) throw new Error("Expected a focused patch with 1–30 files");
  for (const path of paths) {
    if (
      !/^(src|convex|shared|modules)\//.test(path)
      || path.split("/").some((part) => part === ".." || part.startsWith(".") || /^(AGENTS|CLAUDE)\.md$/i.test(part))
    ) {
      throw new Error(`Automation cannot publish changes to ${path}`);
    }
  }
  if (/120000|160000/.test(modes)) throw new Error("Automation cannot publish symlinks or submodules");
}

export function staleCredential(queued: string, updated: string): boolean {
  const dates = [Date.parse(queued), Date.parse(updated)];
  if (dates.some((date) => !Number.isFinite(date))) throw new Error("Invalid credential timestamps");
  return dates[1] > dates[0];
}
