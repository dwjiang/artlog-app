# Plan 03.06: Local-first store (collection, visits, notes) and the offline pending-scan queue

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/db src/lib/queue src/lib/capture drizzle.config.ts babel.config.js metro.config.js package.json`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (data model on the phone; a queue that must never lose a scan)
- **Depends on**: 03.01 (pipeline `enqueue`), 04.03 (`identify`); 04.07 (`saveToCollection`) is consumed by 05.02, not here
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3 "Honest offline" and §5.1 "Offline": a scan taken with no signal is embedded on the spot and kept — vector, descriptors, venue, timestamp, and the label photo or decoded QR URL — then identified in order on reconnect, with the label flow run automatically on a miss; the collection is local-first and browsable anywhere; saved records are immutable snapshots (§4.2 *Moves*); the crop stays on the phone as the card image and the re-embedding source after a model update (§5.4). §6 names `expo-sqlite` + Drizzle and `expo-file-system`.

## Current state

- Pipeline (03.01) calls `enqueue(payload)` when offline or on a network error; `CapturePayload` has `localId, vector, descriptors, keypoints, modelVersion, venueId?, visitId?, capturedAt, cropUri`.
- Convex: `identify` (04.03; idempotent on `localId`), `saveToCollection` (04.07), `scans.get`. `convex/react` queues **mutations** in memory while offline but fails in-flight **actions** on disconnect — the queue here is the durable retry for `identify` (an action).
- Verified SDK facts: `expo-sqlite` `openDatabaseSync('artlog.db', { enableChangeListener: true })`; Drizzle: `drizzle(db)` from `drizzle-orm/expo-sqlite`, `useMigrations(db, migrations)` from `drizzle-orm/expo-sqlite/migrator`, `useLiveQuery`; `drizzle.config.ts { dialect: 'sqlite', driver: 'expo', schema: './src/db/schema.ts', out: './drizzle' }`; Metro `sourceExts.push('sql')`; Babel `plugins: [['inline-import', { extensions: ['.sql'] }]]` (`babel-plugin-inline-import`); `expo-file-system` `File`, `Directory`, `Paths.document`; `expo-network` `addNetworkStateListener` / `useNetworkState`. Tests can run the same Drizzle schema against `better-sqlite3` in Jest.

## Scope

**In scope**: `package.json` (`drizzle-orm`, `expo-sqlite`, `expo-file-system`, `expo-network`; dev `drizzle-kit`, `babel-plugin-inline-import`, `better-sqlite3`), `babel.config.js` (create), `metro.config.js` (add `sql`), `drizzle.config.ts`, `drizzle/` (generated migrations, committed), `src/db/{schema,client,migrations}.ts`, `src/db/repos/{saved-works,visits,notes,pending-scans,settings}.ts` (+ tests), `src/lib/files/photos.ts`, `src/lib/queue/{queue,flush,use-queue}.ts` (+ tests), `src/lib/capture/default-stages.ts` (real `enqueue`), `src/app/_layout.tsx` (run migrations before rendering).

**Out of scope**: collection UI (05.04), waiting/queued UI (05.05), cloud sync (04.11), the label flow itself (05.03 exposes `runLabelFlow(scanId, labelPhotoUri | qrUrl)` that the flusher calls).

## Steps

### Step 1: Schema and migrations

`src/db/schema.ts` (Drizzle sqlite):

- `visits`: `localId` PK, `venueId`, `venueName`, `startedAt`, `endedAt?`, `remoteVisitId?`
- `savedWorks`: `localId` PK, `visitLocalId?`, `venueId?`, `venueName?`, `gallery?`, `savedAt`, `title`, `artist`, `date?`, `medium?`, `institution?`, `objectId?`, `artworkId?`, `scanId?`, `photoPath` (full frame, local), `cropPath`, `syncedAt?`, `deletedAt?`
- `notes`: `savedLocalId` PK/FK, `text`, `updatedAt`
- `pendingScans`: `localId` PK, `cropPath`, `vector` (JSON text), `descriptors` (blob), `keypoints` (blob), `modelVersion`, `venueId?`, `visitLocalId?`, `capturedAt`, `labelPhotoPath?`, `qrUrl?`, `status` (`queued | identifying | identified | failed`), `attempts`, `lastError?`, `scanId?`, `createdAt`
- `settings`: `key` PK, `value`

`drizzle-kit generate` → `drizzle/0000_*.sql`; `src/db/client.ts` opens `artlog.db` and exports `db`; `_layout.tsx` uses `useMigrations` and renders a minimal loading view until done.

**Verify**: `npx drizzle-kit generate` produces a migration; app launches with migrations applied (`PRAGMA user_version` via a debug log).

### Step 2: Files

`photos.ts`: `Paths.document/photos/` and `/crops/`; `persistCapture({ photoUri, cropUri, localId })` moves both into place with stable names and returns paths; `deleteCapture(localId)`.

**Verify**: unit test with a mocked `File` API; device: files exist after a capture.

### Step 3: Repositories

One file per table with typed functions (`insertSavedWork`, `listSavedWorks({ search? })` using `LIKE` over title/artist/institution, `listVisits`, `upsertVisit`, `setNote`, `enqueuePendingScan`, `nextQueued`, `markIdentifying/Identified/Failed`, `getSetting/setSetting`). All queries go through Drizzle; no raw SQL outside `listSavedWorks`' search.

**Verify**: `src/db/repos/*.test.ts` run the schema on `better-sqlite3` (jest): insert/list/search/soft-delete; queue transitions.

### Step 4: The queue and the flusher

`queue.ts`: `enqueue(payload)` persists the crop (`persistCapture`) and inserts a `pendingScans` row (`status: queued`). `flush.ts`: `flushQueue({ identify, runLabelFlow, isOnline, reembed })`: process rows in `capturedAt` order; per row: if `row.modelVersion !== current` → `reembed(row.cropPath)` (embedder + ORB stages) and update the row; `markIdentifying` → `identify({ localId, … })` → on success `markIdentified(scanId)`; if outcome ∈ `soft|miss` and `labelPhotoPath || qrUrl` → `runLabelFlow(scanId, …)`; on error `attempts += 1`, backoff `min(2^attempts, 60) s`, `failed` after 5 (keeps the row and the crop for manual retry). Triggered by `expo-network` state changes (offline → online), app foreground, and after each capture; single-flight (a module-level promise). `use-queue.ts`: `useQueue()` → `{ pending: number, items }` via `useLiveQuery`.

**Verify**: `flush.test.ts` (jest, fake repos + fakes): ordering, backoff, label-flow trigger on soft/miss only, re-embed on version mismatch, single-flight; device: Airplane mode → capture → row queued; disable Airplane mode → identified within seconds.

### Step 5: Wire

`default-stages.ts`: `enqueue = queue.enqueue`; `_layout.tsx` starts the flusher listeners. Saved works are written locally by 05.02's Save action through `insertSavedWork` and mirrored later by 04.11 (`syncedAt` stays null until then).

**Verify**: full offline → online capture works on device; `npm run test:app` passes.

## Test plan

`src/db/repos/*.test.ts` (better-sqlite3), `queue.test.ts`, `flush.test.ts`, `photos.test.ts` (jest).

## Done criteria

- [ ] Airplane-mode capture is identified on reconnect (device)
- [ ] Migrations committed under `drizzle/`; `npm run test:app` ≥ 15 new tests; tsc/lint pass
- [ ] A saved work row is immutable by construction: no `update` function on snapshot fields in `saved-works.ts` (only `setNote`, `softDelete`, `markSynced`) — grep confirms
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `babel-plugin-inline-import` breaks the Babel config with the React Compiler enabled — report; the alternative is Drizzle's `migrations.js` export via `drizzle-kit` `--custom`, an operator choice.
- `better-sqlite3` cannot run in Jest on the machine (native build) — report; fall back to testing pure functions only and say so.

## Maintenance notes

- The queue row keeps the crop path; `deleteCapture` only runs after the row is identified **and** saved-or-dismissed (05.05 owns that UX).
- Model updates: the flusher's re-embed path is the design's "the updated app re-embeds them locally" (§5.4).
