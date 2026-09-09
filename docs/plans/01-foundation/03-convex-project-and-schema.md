# Plan 01.03: Create the Convex project, the full data-model schema, and the app-side client

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/ shared/ src/app/_layout.tsx .env.example package.json tsconfig.json`
> If `convex/` already exists, STOP and reconcile with whoever created it.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (every backend plan builds on this schema; a wrong field name here costs every consumer)
- **Depends on**: `docs/plans/01-foundation/01-verification-baseline.md`, `docs/plans/01-foundation/02-app-shell.md`
- **Category**: feature (greenfield)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Convex is the entire request path (design §5.2): database, anonymous sessions, file storage, crons, real-time subscriptions, vector search, and the `identify` action. Nothing else can start until a Convex deployment exists, the schema in design §5.3 is expressed as `convex/schema.ts`, `convex/_generated/` is committed, and the Expo app has a `ConvexProvider`. This plan is the contract: every later plan names tables and fields exactly as defined here. It deliberately writes **no business logic** beyond a health query.

## Current state

- There is no `convex/` directory, no `convex` dependency, no `.env.example`, no `shared/`.
- `src/app/_layout.tsx` (after plan 01.02) is a root `Stack` inside `ThemeProvider value={DefaultTheme}`.
- `tsconfig.json` extends `expo/tsconfig.base` with `strict: true` and the `@/*` → `./src/*` alias; `include` is `**/*.ts, **/*.tsx` (so `convex/**` is typechecked by `npx tsc --noEmit` too — that is intended).
- Test tooling from plan 01.01: `npm run test:convex` runs vitest over `convex/**/*.test.ts` with the `edge-runtime` environment (`--passWithNoTests` until this plan adds tests).
- `AGENTS.md` rules that apply: "Commit generated Convex output under `convex/_generated/`. Run `npx convex codegen` after a Convex schema or backend function-signature change." "Convex modules use camel case." "When adding a variable to `.env.local`, document it in `.env.example` using a non-secret placeholder and set the same variable to the same value in the Conductor root repository's `.env.local`. Locate that repository via `CONDUCTOR_ROOT_PATH`, or the primary checkout in `git worktree list` if unset." (`git worktree list` currently shows the primary checkout at `/Users/dwjiang/conductor/repos/artlog-app`.) Pre-release: make breaking schema changes directly, never add migrations for old data.
- Convex conventions that every file under `convex/` must follow (from the repo skill `.agents/skills/convex-expert/SKILL.md`): object-form functions with `args` **and** `returns` validators; `query/mutation/action/internal*` import from `./_generated/server`, `api/internal` from `./_generated/api`; `v.id("table")` for ids; `v.literal` unions for enums; index every read path (`.withIndex`), never `.filter` as a WHERE; no unbounded `.collect()` on growing tables; `"use node"` only in action-only modules; never store storage URLs, store `Id<"_storage">`.

## Design facts this schema encodes

From `docs/design/art-identifier.md` §5.3 (table → purpose → key fields), §4.2 (artwork / object / placement; owner separated from location; saved records are immutable snapshots; `museums` seeded from Wikidata with `indexStatus`), §4.6 (`feedback`, `confirmCount`/`rejectCount`), §4.7 (`contributions` states `private → pending → promoted | rejected`), §4.8 (`artworks.factSheet`, `artworks.docent.en`, `artistContext` 7-day cache), §5.4 (`modelVersion` on every vector and request; descriptors are not versioned), §5.5 (`rightsStatus ∈ {public_domain, in_copyright, unknown}`), §5.6 (`devices` keyed by App Attest key id; optional `accounts`), §5.1 (the vector is float16 on the wire, stored as floats).

Vector dimension is a build-time constant (1536, the DINOv2-adaptor summary of C-RADIOv3-B; see Step 2). It lives in one shared JSON so the phone, Convex and the Python jobs agree.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install packages | `npm install convex@^1.45 && npm install -D convex-test` | exit 0 (Convex is not an Expo SDK package; plain npm is correct here) |
| Convex login (once per machine) | `npx convex login` | browser login completes; `npx convex whoami` prints the account |
| Create / push dev deployment | `npx convex dev --once` | creates `.env.local`, `convex/_generated/`; ends with "Convex functions ready" |
| Codegen | `npx convex codegen` | regenerates `convex/_generated/` |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Convex tests | `npm run test:convex` | all pass |
| App | `npm run ios` | app launches; Settings shows backend time |

## Suggested executor toolkit

- Skills in this repo: `convex-expert` (rules above), `convex-env` (`npx convex env set`), `convex-test`.
- Convex docs for the version installed: schema and validators `https://docs.convex.dev/database/schemas`, vector search `https://docs.convex.dev/search/vector-search`, React Native client `https://docs.convex.dev/quickstart/react-native`.

## Scope

**In scope**:

- `package.json` (dependencies `convex`, dev `convex-test`; add script `"convex:codegen": "convex codegen"`), `package-lock.json`
- `convex/schema.ts`, `convex/lib/validators.ts`, `convex/lib/placements.ts` (+ test), `convex/health.ts` (+ test), `convex/convex.config.ts`, `convex/tsconfig.json` if `npx convex dev` generates one, `convex/_generated/**` (commit it)
- `shared/model-version.json`
- `.env.example` (create), `.env.local` (created by the CLI; gitignored — never commit)
- `src/app/_layout.tsx` (wrap in `ConvexProvider`), `src/lib/convex-client.ts` (create), `src/components/settings/settings-screen.tsx` (add the health line)
- `tsconfig.json` only if `resolveJsonModule` must be enabled for the JSON import

**Out of scope** (do NOT touch):

- Any function beyond `health.ping`: `identify`, `startVisit`, auth, rate limiting, crons — plans `04-backend/*`.
- `@convex-dev/auth`, `@convex-dev/rate-limiter` — installed by plan 04.04.
- Python jobs (`jobs/`) — plan 02.01 reads this schema; it does not exist yet.

## Git workflow

- Current workspace branch; do not push unless told.
- Commits: `build(deps): add convex and convex-test`, `feat(convex): add data-model schema`, `feat(app): connect convex client`.

## Steps

### Step 1: Install Convex and create the dev deployment

`npm install convex@^1.45 && npm install -D convex-test`. Confirm `npx convex whoami` succeeds (STOP if it does not — the operator must run `npx convex login`; do **not** use `CONVEX_AGENT_MODE=anonymous`, which would bind the repo to a throwaway local deployment). Then `npx convex dev --once` and accept "create a new project" named `artlog` if prompted. The CLI writes `.env.local` (`CONVEX_DEPLOYMENT=dev:…` and the client URL; for Expo projects it names the URL variable `EXPO_PUBLIC_CONVEX_URL` — if it wrote `CONVEX_URL` instead, add `EXPO_PUBLIC_CONVEX_URL` with the same value) and creates `convex/` with `_generated/`.

Create `.env.example`:

```
# Convex dev deployment slug written by `npx convex dev` (e.g. dev:wandering-fox-123)
CONVEX_DEPLOYMENT=dev:your-deployment
# Public Convex URL the Expo app connects to
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Then mirror the two real values into the Conductor root checkout's `.env.local` (`$CONDUCTOR_ROOT_PATH/.env.local`, else `/Users/dwjiang/conductor/repos/artlog-app/.env.local` from `git worktree list`), creating or updating only those two lines.

**Verify**: `npx convex whoami` → account; `ls convex/_generated` → `api.d.ts api.js dataModel.d.ts server.d.ts server.js`; `grep -c EXPO_PUBLIC_CONVEX_URL .env.local .env.example "$CONDUCTOR_ROOT_PATH/.env.local"` → 1 each; `git check-ignore .env.local` → prints the path (ignored).

### Step 2: The shared model-version constant

Create `shared/model-version.json`:

```json
{
  "modelVersion": "c-radiov3-b-int8-512-dinov2-v1",
  "embeddingDim": 1536,
  "inputSize": 512,
  "orbMaxKeypoints": 500
}
```

These values come from research done while planning (verified 2026-09-08 against the `nvidia/C-RADIOv3-B` repo and the NVlabs/RADIO source): the DINOv2-adaptor summary head outputs **1536** floats (the backbone summary is 2304 = three 768-wide teacher CLS tokens concatenated, so 768 was never an option), and the model's `preferred_resolution` is 512×512 with a patch size of 16. Plan 00.01 confirms them on the Neural Engine; if it changes either number the string must change too. Ensure `tsconfig.json` allows JSON imports (`expo/tsconfig.base` sets `resolveJsonModule: true`; if `npx tsc --noEmit` complains after Step 3, add it under `compilerOptions`).

**Verify**: `node -e "console.log(require('./shared/model-version.json').embeddingDim)"` → `1536`.

### Step 3: Shared validators (`convex/lib/validators.ts`)

Export these `v.union(v.literal(...))` validators and their inferred TS types (`Infer<typeof …>`):

- `rightsStatus`: `public_domain | in_copyright | unknown`
- `multiplicity`: `unique | multiple | unknown`
- `objectSource`: `corpus | crawl | user`
- `vectorSource`: `corpus | crawl | user | user_scan`
- `placementSource`: `wikidata | feed | checklist | crawl | proposal | manual`
- `seedSource`: `wikidata | poi | manual`
- `indexStatusKind`: `none | queued | building | complete | no_index | opted_out`
- `contributionStatus`: `private | pending | promoted | rejected`
- `proposalStatus`: `pending | promoted | rejected`
- `scanStatus`: `pending | waiting | identified | failed | unsupported_version`
- `matchOutcome`: `confident | soft | miss`
- `evidenceKind`: `accession | qr | wikidata | tavily | agreement | user_edited`
- `feedbackResolution`: `v.object({ kind: runner_up | label | unresolved | false_rejection, objectId?: v.id("objects"), contributionId?: v.id("contributions") })`
- `factSheetEntry`: `v.object({ id: v.string(), text: v.string(), sourceUrl: v.string(), sourceLabel: v.string(), sourceScore: v.number() })`
- `docentSentence`: `v.object({ sentence: v.string(), factIds: v.array(v.string()) })`
- `snapshotFields`: `v.object({ title: v.string(), artist: v.string(), date: v.optional(v.string()), medium: v.optional(v.string()), institution: v.optional(v.string()) })`
- `embedding`: `v.array(v.float64())` (length is enforced in code against `embeddingDim`, not by the validator)

**Verify**: `npx tsc --noEmit` → 0.

### Step 4: The schema (`convex/schema.ts`)

Import `defineSchema, defineTable` from `convex/server`, `v` from `convex/values`, the validators from `./lib/validators`, and `modelVersion` JSON from `../shared/model-version.json`. Define exactly these tables (field → validator; `?` = `v.optional`; timestamps are `v.number()` ms since epoch):

| Table | Fields | Indexes |
|---|---|---|
| `artworks` | `wikidataId?: string`, `title: string`, `artist: string`, `artistId?: string` (Wikidata Q-id), `date?: string`, `yearStart?: number`, `yearEnd?: number`, `rightsStatus`, `multiplicity`, `seriesId?: string`, `factSheet?: array(factSheetEntry)`, `factSheetUpdatedAt?: number`, `docent?: object({ en?: array(docentSentence) })`, `docentUpdatedAt?: number` | `by_wikidataId ["wikidataId"]`, `by_artistId ["artistId"]` |
| `objects` | `key: string` (`source:sourceId`), `artworkId: id(artworks)`, `ownerId?: id(museums)`, `accession?: string`, `medium?: string`, `dimensions?: string`, `source: objectSource`, `sourceId: string`, `imageRef?: string`, `pageUrl?: string`, `thumbnailUrl?: string`, `confirmCount: number`, `rejectCount: number`, `calibratorPenalty: number`, `mergedInto?: id(objects)`, `provenance?: object({ contributionIds: array(id(contributions)), deviceIds: array(id(devices)) })`, `reverted: boolean` | `by_key ["key"]`, `by_artworkId ["artworkId"]`, `by_owner_accession ["ownerId","accession"]` |
| `placements` | `objectId: id(objects)`, `venueId: id(museums)`, `gallery?: string`, `onView: boolean`, `from?: number`, `to?: number`, `source: placementSource`, `confidence: number`, `closedAt?: number` | `by_objectId ["objectId"]`, `by_venueId ["venueId"]` |
| `placementProposals` | `objectId`, `proposedVenueId: id(museums)`, `kind: move \| new_object`, `scanIds: array(id(scans))`, `deviceIds: array(id(devices))`, `firstSeenAt: number`, `lastSeenAt: number`, `status: proposalStatus`, `readyForReview: boolean`, `reviewer?: string`, `reviewedAt?: number` | `by_object_venue ["objectId","proposedVenueId"]`, `by_status ["status"]` |
| `vectors` | `objectId`, `modelVersion: string`, `source: vectorSource`, `vector: embedding` | `vectorIndex("by_vector", { vectorField: "vector", dimensions: modelVersion.embeddingDim, filterFields: ["modelVersion"] })`, `by_objectId_modelVersion ["objectId","modelVersion"]` |
| `descriptors` | `objectId`, `descriptors: bytes`, `keypoints: bytes`, `keypointCount: number`, `inputSize: number`, `extractedFrom: string` (imageRef or `contribution:<id>`) | `by_objectId ["objectId"]` |
| `museums` | `name: string`, `lat: number`, `lng: number`, `website?: string`, `collectionSiteUrl?: string`, `platform?: string`, `accessionUrlPattern?: string`, `seedSource`, `wikidataId?: string`, `region: string`, `optOut: boolean`, `crawlPolicy?: object({ robotsAllowed: boolean, termsChecked: boolean, checkedAt: number, crawlDelaySeconds?: number, notes?: string })`, `useTavilyCrawl: boolean`, `queuePriority: number`, `indexStatus: object({ status: indexStatusKind, pagesMapped: number, worksIndexed: number, updatedAt: number })`, `lastCrawledAt?: number`, `changeDetection?: object({ sitemapLastmod?: string, etag?: string, lastModified?: string })` | `by_wikidataId ["wikidataId"]`, `by_queuePriority ["queuePriority"]`, `by_indexStatus ["indexStatus.status"]` |
| `crawlRuns` | `venueId`, `startedAt`, `finishedAt?`, `status: running \| complete \| failed \| capped`, `pagesMapped: number`, `worksIndexed: number`, `error?: string` | `by_venueId ["venueId"]` |
| `artistContext` | `artistId: string`, `region: string`, `text: string`, `sourceUrl: string`, `sourceLabel: string`, `empty: boolean`, `fetchedAt: number` | `by_artist_region ["artistId","region"]` |
| `contributions` | `deviceId: id(devices)`, `venueId: id(museums)`, `scanId?: id(scans)`, `vector: embedding`, `modelVersion: string`, `descriptors: bytes`, `keypoints: bytes`, `keypointCount: number`, `cropStorageId?: id("_storage")`, `rawOcr?: any`, `fields: object({ title, artist, date, medium, accession, creditLine })` where each is `object({ value: string, edited: boolean, evidence: evidenceKind })` (date/medium/accession/creditLine optional), `evidence: array(evidenceKind)`, `status: contributionStatus`, `promotedObjectId?: id(objects)`, `createdAt: number` | `by_deviceId ["deviceId"]`, `by_status ["status"]`, `by_venue_status ["venueId","status"]` |
| `feedback` | `scanId`, `deviceId`, `vector: embedding`, `modelVersion`, `venueId?`, `rejectedObjectId: id(objects)`, `score: number`, `margin: number`, `orbInliers: number`, `probability: number`, `calibratorVersion: string`, `venueMismatch: boolean`, `resolution: feedbackResolution`, `createdAt` | `by_rejectedObjectId ["rejectedObjectId"]`, `by_device_object ["deviceId","rejectedObjectId"]` |
| `scans` | `deviceId`, `localId: string` (phone-generated UUID; idempotency key), `venueId?`, `visitId?: id(visits)`, `gallery?: string`, `modelVersion`, `vector: embedding`, `descriptors?: bytes`, `keypoints?: bytes`, `keypointCount?: number` (kept only while `status = waiting`, cleared on resolution), `capturedAt: number`, `status: scanStatus`, `outcome?: matchOutcome`, `best?: object({ objectId, artworkId, probability: number, corners?: array(array(number)) })`, `runnerUps?: array(object({ objectId, artworkId, probability: number }))`, `docent?: array(docentSentence)`, `rightNow?: object({ text, sourceUrl, sourceLabel })`, `labelFlow?: any`, `error?: string`, `createdAt`, `updatedAt` | `by_device_localId ["deviceId","localId"]`, `by_deviceId ["deviceId"]`, `by_venue_status ["venueId","status"]` |
| `devices` | `appAttestKeyId: string`, `authUserId?: string`, `firstSeenAt`, `trustWeight: number`, `banned: boolean`, `accountId?: id(accounts)` | `by_keyId ["appAttestKeyId"]`, `by_authUserId ["authUserId"]`, `by_accountId ["accountId"]` |
| `accounts` | `appleUserId: string`, `deviceIds: array(id(devices))`, `createdAt` | `by_appleUserId ["appleUserId"]` |
| `visits` | `deviceId`, `venueId`, `startedAt`, `endedAt?`, `lastConfidentGallery?: string`, `lastConfidentAt?: number` | `by_device_started ["deviceId","startedAt"]` |
| `collections` | `deviceId`, `accountId?`, `localId: string` (phone-generated UUID; sync idempotency key), `visitId?: id(visits)`, `venueId?`, `gallery?`, `savedAt`, `snapshot: snapshotFields`, `objectId?`, `artworkId?`, `scanId?`, `deletedAt?: number` | `by_device_localId ["deviceId","localId"]`, `by_accountId ["accountId"]` |
| `optOuts` | `venueId?`, `artworkId?`, `objectId?`, `requester: string`, `receivedAt`, `appliedAt?` | `by_venueId ["venueId"]` |
| `takedowns` | same as `optOuts` | `by_artworkId ["artworkId"]` |

Add a top-of-file comment: "Schema per docs/design/art-identifier.md §5.3. Pre-release: change shapes directly; do not add migrations."

**Verify**: `npx convex dev --once` → pushes without schema errors; `npx convex codegen` → `git status` shows `convex/_generated/` changed; `npx tsc --noEmit` → 0.

### Step 5: Current-placement helper (`convex/lib/placements.ts`)

Pure function used by identify (plan 04.03) and the crawler writer:

```ts
export type PlacementLike = { venueId: string; gallery?: string; onView: boolean; from?: number; to?: number; closedAt?: number; confidence: number; source: string };
export function currentPlacement<T extends PlacementLike>(placements: T[], now: number): T | null
```

Rules: exclude rows with `closedAt`; a row is active at `now` when `(from ?? -∞) <= now <= (to ?? +∞)`; among active rows prefer, in order, `source` rank `manual > feed > checklist > proposal > crawl > wikidata`, then higher `confidence`, then latest `from`. Return `null` when nothing is active.

**Verify**: `npx vitest run convex/lib/placements` → tests: none active → null; open-ended home placement vs. dated checklist placement → checklist wins inside its window, home wins outside; `closedAt` excluded; tie-break by confidence.

### Step 6: Health query and convex-test smoke (`convex/health.ts`, `convex/health.test.ts`)

```ts
export const ping = query({
  args: {},
  returns: v.object({ ok: v.literal(true), time: v.number(), modelVersion: v.string() }),
  handler: async () => ({ ok: true as const, time: Date.now(), modelVersion: modelVersion.modelVersion }),
});
```

`health.test.ts` uses `convexTest(schema, import.meta.glob("./**/*.*s"))`, calls `t.query(api.health.ping, {})`, asserts `ok === true` and the model version string; a second test inserts a `museums` row via `t.run` and reads it back via `ctx.db.query("museums").withIndex("by_wikidataId", q => q.eq("wikidataId", "Q160236"))` to prove the schema and indexes load in the test harness.

**Verify**: `npm run test:convex` → 2+ tests pass; `npx convex dev --once` → success (the Convex CLI skips any file under `convex/` whose basename has more than one dot, so `*.test.ts` is never bundled).

### Step 7: Connect the app

`src/lib/convex-client.ts`:

```ts
import { ConvexReactClient } from 'convex/react';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set; copy .env.example to .env.local');
export const convex = new ConvexReactClient(url, { unsavedChangesWarning: false });
```

Wrap the root `Stack` in `src/app/_layout.tsx` with `<ConvexProvider client={convex}>` (from `convex/react`), outside `ThemeProvider`. In `src/components/settings/settings-screen.tsx` add `const health = useQuery(api.health.ping)` (import `api` from `../../../convex/_generated/api` — add a `@convex/*` path alias in `tsconfig.json` → `./convex/*` if you prefer; Metro honors tsconfig paths) and render `Backend: connected · <modelVersion>` or `Backend: connecting…`.

**Verify**: `npm run ios` → Settings tab shows "Backend: connected · c-radiov3-b-int8-448-dinov2-v1" within a few seconds; `npx tsc --noEmit` → 0; `npm run lint` → 0.

## Test plan

- `convex/health.test.ts` (2 tests) and `convex/lib/placements.test.ts` (4+ tests) as above — the first convex-test usage in the repo; later plans copy their structure.
- App side: no component test for the health line (it is a placeholder removed by plan 05.06).

## Done criteria

- [x] `npx convex dev --once` succeeds against the project's dev deployment and `convex/_generated/` is committed
- [x] `npx tsc --noEmit` exits 0; `npm run lint` exits 0
- [x] `npm run test:convex` exits 0 with ≥ 6 tests
- [x] `grep -c "defineTable(" convex/schema.ts` → 18 (the bare pattern also counts the import line)
- [x] `grep -n "vectorIndex" convex/schema.ts` → 1 match with `filterFields: \["modelVersion"\]`
- [x] `.env.example` documents `CONVEX_DEPLOYMENT` and `EXPO_PUBLIC_CONVEX_URL`; `.env.local` is untracked
- [x] Simulator: Settings shows "Backend: connected"
- [x] No files outside the in-scope list are modified (`git status`) — except `jest.setup.ts` and its `setupFiles` entry, see notes
- [x] `docs/plans/README.md` status row updated

## Execution notes — 2026-09-09

- Drift check: `convex/` did not exist. `.env.example` already existed with the
  spike keys (`NEBIUS_API_KEY`, `TAVILY_API_KEY`); the Convex variables were
  appended to it.
- `npx convex whoami` is not a command in convex 1.45. Login was confirmed by the
  stored credential in `~/.convex/config.json` and by the non-interactive
  `npx convex dev --once --configure new --project artlog --dev-deployment cloud`
  succeeding. Project `artlog` (team `daniel-jiang`), dev deployment
  `usable-owl-256`. The CLI wrote `CONVEX_DEPLOYMENT`, `EXPO_PUBLIC_CONVEX_URL`
  and `EXPO_PUBLIC_CONVEX_SITE_URL`; all three are documented in `.env.example`
  and mirrored to the Conductor root checkout's `.env.local`.
- The CLI generated `convex/tsconfig.json` (kept; `resolveJsonModule: true` added
  so the CLI's own typecheck accepts the `../shared/model-version.json` import) and
  a boilerplate `convex/README.md` (removed).
- The vector index accepted `dimensions: 1536` and the nested
  `indexStatus.status` index path; the shared JSON import bundles fine.
- The enums the table used inline (`placementProposals.kind`, `crawlRuns.status`)
  and the per-field contribution shape live in `validators.ts` as `proposalKind`,
  `crawlRunStatus` and `contributionField`, so every enum has one owner.
- `convex/convex.config.ts` was not created: no component is installed yet; plan
  04.04 adds the first.
- convex-test's `import.meta.glob` needs `/// <reference types="vite/client" />`
  in each test file because the root `tsconfig.json` pins `types: ["jest"]`.
- Jest does not load `.env` files and the route tree now constructs the Convex
  client at import time, which broke `app-navigation.test.ts`. `jest.setup.ts`
  (registered under `jest.setupFiles`) sets a placeholder
  `EXPO_PUBLIC_CONVEX_URL` for tests; this is the one addition outside the scope
  list.
- Step 7's expected string (`…-448-…`) predates decision 001; the app shows
  `c-radiov3-b-int8-512-dinov2-v1`, matching `shared/model-version.json`.
- Simulator (iPhone 17 Pro, iOS 26.5, light mode): as in plan 01.02, Expo Go kept
  the stale bundle after `npm run ios` until it was terminated and reopened;
  Settings then showed "Backend: connected · c-radiov3-b-int8-512-dinov2-v1".
  Screenshot in `.context/plan-01-03/` (gitignored).

## STOP conditions

Stop and report back (do not improvise) if:

- `npx convex whoami` fails (no login) — do not use anonymous mode.
- `npx convex dev --once` rejects `vectorIndex` with `dimensions: 1536` or the nested index path `indexStatus.status`; report the exact error.
- The JSON import from `../shared/` fails in the Convex bundler — report; the fallback (duplicating the constant under `convex/lib/`) is a decision for the operator.
- convex-test cannot load the schema (`convexTest(schema, …)` throws) after one fix attempt.
- The Expo app cannot read `process.env.EXPO_PUBLIC_CONVEX_URL` after a Metro restart with `--clear`.

## Maintenance notes

- This file is the contract. Plans 02.01 (Python writer), 04.03 (identify), 04.07/04.08 (contributions, promotion), 03.06 (local snapshots) all name these fields; if you rename anything, grep `docs/plans/` and update every mention.
- `embeddingDim` is baked into the vector index; changing it (plan 00.01 outcome) means editing `shared/model-version.json`, re-pushing the schema (Convex rebuilds the index) and re-running the index build. Do it before any vectors exist.
- Reviewers should check: every enum is a `v.literal` union from `validators.ts`, every table has the indexes listed, no `v.string()` where an id belongs, `convex/_generated` committed.
- Deferred: `dailySpend`/flags tables (plan 04.04), `calibratorVersions` (plan 04.07), retention policy (design §3 deferred).
