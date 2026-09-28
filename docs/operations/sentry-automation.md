# Scheduled Sentry fixes

The **Sentry fixes** GitHub Actions workflow runs every 4 hours (00:17, 04:17, 08:17, 12:17, 16:17 and 20:17 America/Los_Angeles) once merged into `main`. It runs on GitHub-hosted Linux machines and authenticates Codex through the owner's ChatGPT subscription. No OpenAI API key or Sentry Seer calls are used. Subscription limits and GitHub Actions usage limits still apply.

## Setup

Keep this repository private. Add these repository Actions secrets:

| Secret                   | Purpose                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `CODEX_AUTH_JSON`        | Dedicated, file-backed Codex ChatGPT login; not a copy shared with an active local session. |
| `SENTRY_AUTH_TOKEN`      | Sentry read token: `org:read`, `project:read`, `event:read`.                                |
| `CODEX_AUTH_WRITE_TOKEN` | Fine-grained GitHub token restricted to this repository, with Secrets read/write access.    |

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. That GitHub setting enables PR creation; this workflow never submits an approval or merges a PR. Its default token permissions remain read-only; only the publication job has repository write permissions.

Manually merge the setup PR. In **Actions → Sentry fixes → Run workflow**, keep **dry_run** checked for the first run. It verifies Codex shell access in both sandbox modes, workspace writes, a subscription model call, GitHub reads, Sentry's production issue query, and the event query when an issue exists. It also tests the credential refresh write-back. Then start a new manual run with **dry_run** unchecked to test the full workflow. Scheduled runs are full runs.

To pause the schedule, disable the workflow in the Actions UI. GitHub schedules can be delayed; the workflow is not an incident paging system.

## What each run does

The analysis job has read-only GitHub permissions. It checks up to 100 unresolved issues in `daniel-jiang/artlog-app`, scoped to the last 24 hours and `environment=production`. Individual event samples must independently confirm production, the issue ID and timestamp. Errors never cause the query to broaden to other environments. Ensure each production Convex deployment sets `SENTRY_ENVIRONMENT=production`; development deployments must use another value. The iOS SDK already tags `__DEV__` as development.

Each run takes one outcome: existing PR reviews/revisions first, otherwise the most frequent untracked issue. Any existing PR or GitHub issue mentioning a Sentry issue, including human and closed ones, prevents another attempt. The exception is a bot-created, doubly labeled `automatic fix skipped` issue reporting `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`: those failed before investigation and can be retried without deleting the reports. Any other tracked work still prevents a retry. Review targets require both `agent-generated` and `sentry-fix`, the `sentry-fix/artlog-app-*` branch convention, `main` as base and a head in this repository. Unlabeled human PRs are never reviewed or modified.

A fresh Codex session reviews the proposed diff independently. It runs sequentially after the fixer, so the sessions share the subscription login without concurrent token rotation. The publication job has no Codex or Sentry credentials and runs no candidate build scripts. It validates the patch, rechecks PR eligibility and commit IDs, creates a draft PR or updates an eligible automation PR, and posts the review tied to the exact commit. New PR bodies also contain the initial review, so findings remain visible if comment publication fails.

When the fixer finds no supported fix, changes nothing, or edits paths the policy below rejects, the run escalates instead: it opens a labeled GitHub issue that names the Sentry issue, or comments on the PR and spends its remaining revision rounds. Later runs therefore move on to the next issue. Delete an escalation issue to allow another automatic attempt. Sandbox preflights, agent-reported infrastructure blockers, and failing checks fail the run instead; they never publish an escalation or spend revision rounds, so the next run can retry.

Automatic revisions apply only to draft PRs created by `github-actions[bot]` with this workflow's state marker and an outstanding automated review. A round is reserved in the PR body before each update. At most two revision attempts are allowed; failures may consume a round. Further changes require a human. Independent review of later human edits remains possible, but there is no automatic merge, ready-for-review transition or deployment.

The workflow never resolves Sentry issues itself. New PR bodies start with `Fixes ARTLOG-APP-…`, so with Sentry's GitHub integration linked to this repository, the PR appears on the Sentry issue, and Sentry resolves the issue once a release lists the PR's merge commit. Human fix PRs need the same `Fixes` line in their body; squash commits here keep only the PR title.

Patches are limited to `src/`, `convex/`, `shared/` and `modules/`, with at most 30 files and 500 KB. Symlinks, submodules, hidden paths, agent instructions and automation changes are rejected. Tests, lint and typechecking must pass before publishing code. Every PR remains a draft, including when the review has no findings. **iOS simulator verification must be performed on a Mac before manual merge.** Convex changes that cannot satisfy codegen without unavailable deployment access should be skipped.

## Credentials and evidence

The workflow installs dependencies and verifies the real Codex sandbox before restoring credentials. On Ubuntu 24.04 it installs Bubblewrap and loads the distribution’s `bwrap-userns-restrict` AppArmor profile, following [OpenAI’s sandbox prerequisites](https://learn.chatgpt.com/docs/sandboxing#prerequisites). The credential-free check exercises both sandbox modes: permitted reads/writes, rejected writes outside the workspace and to protected metadata, and blocked network connections. Agents have no GitHub write token, Sentry token or refresh-token-management token in their environment. Shell network access, apps, plugins, hooks, project MCP servers and nested agents are disabled. Codex 0.153.4 uses Bubblewrap with filesystem restrictions and seccomp network blocking enabled; its legacy Landlock backend cannot enforce workspace metadata protections and must remain disabled. Each agent session first proves shell access in its sandbox. Tests, lint and typechecking execute candidate code, so they run in the same no-network workspace sandbox via `codex sandbox`. Codex authentication remains accessible to the Codex client on the trusted private runner, as required by the subscription approach.

Sentry evidence contains event identifiers, timestamps, exception types and stack locations. It omits free-text exception messages, user objects, requests, breadcrumbs and local variables. This deliberately makes some issues unsuitable for an automatic fix; the agent must skip unsupported diagnoses. Logs and the evidence payload are not uploaded as artifacts. Only the validated publication plan and patch are transferred between jobs, with one-day retention.

Credentials are restored from the Actions secret and saved back after the run, even when analysis fails. A secret updated after the workflow was queued means that run has a stale login snapshot and must fail before using it. **Start a new workflow run rather than rerunning an old run** after refreshing credentials. Do not manually replace the secret while a run is active. A revoked or expired login requires a new dedicated Codex sign-in; an expired GitHub write token must be replaced before further runs.

## Local checks

```bash
npm run test:sentry-automation
# Requires the pinned Codex CLI and, on Linux, the sandbox prerequisites above.
CODEX_SANDBOX_TESTS=true node --test scripts/sentry-automation/sandbox.test.ts
npx tsc --noEmit
npm run lint
```

Live authentication and publication can only be verified in GitHub Actions after the workflow reaches `main`. A local unit test does not establish that the tokens have the required scopes or that a cloud Codex run can complete the app's tests.

References: [OpenAI subscription authentication in CI](https://learn.chatgpt.com/docs/auth/ci-cd-auth), [GitHub secret timing](https://docs.github.com/en/actions/reference/security/secrets#when-github-actions-reads-secrets), [Sentry issue filtering](https://docs.sentry.io/api/events/list-an-organizations-issues/).
