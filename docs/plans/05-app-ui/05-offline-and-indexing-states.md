# Plan 05.05: Waiting-for-signal, queued scans, "Indexing this museum", and "update the app" states

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/scan/states src/app/queue.tsx src/app/_layout.tsx src/components/scan/result-screen.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 03.06 (queue), 04.03 (`waiting`, `unsupported_version`), 04.05 (`museums.getStatus`), 05.02
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3 "Honest offline", §4.2 *Priority* ("Indexing this museum — 640 of 2,100 works", re-runs on completion, the label button stays available throughout), §5.1 "Offline" ("waiting for signal"; "capture the label now so we can finish this when you're back online"), §5.4 ("update the app to identify"), §9 ("Card appears when the connection returns"). These states are where the product's honesty shows.

## Current state

- `result-screen.tsx` (05.02) maps server states; `local-<localId>` routes are not handled yet; `toResultViewState` returns `waiting | unsupported | failed` kinds.
- Queue (03.06): `useQueue()` → `{ pending, items: [{ localId, status, capturedAt, cropPath, labelPhotoPath?, qrUrl?, scanId?, lastError? }] }`; `setLabelPhoto`, `setQrUrl`, `retry(localId)`.
- `museums.getStatus({ venueId })` → `{ name, indexStatus: { status, pagesMapped, worksIndexed } }` (live query).
- Route tree: `venue-picker` formSheet exists; add `queue` as another formSheet route in `src/app/_layout.tsx`.

## Scope

**In scope**: `src/components/scan/states/{waiting-for-signal-card,indexing-card,unsupported-card,failed-card,queue-sheet,queue-row}.tsx` (+ tests), `src/app/queue.tsx` (route → `QueueSheet`), `src/app/_layout.tsx` (formSheet screen), `src/components/scan/result-screen.tsx` (route `local-*` ids to the local card; render the state cards), `src/components/scan/queue-badge.tsx` (make it open `/queue`).

**Out of scope**: the queue logic (03.06), the label flow (05.03; this plan links to it with `?offline=1`).

## Steps

### Step 1: Local pending card

`result-screen.tsx`: when `scanId` starts with `local-` read the pending row live (`useLiveQuery`); `queued`/`identifying` → `WaitingForSignalCard`: crop, "Waiting for signal", the line "Capture the label now so we can finish this when you're back online", a "Point at the label" button → `/label/local-<id>?offline=1` (05.03 stores the photo/QR on the row), and a "Save anyway" (blank title required) path; when the row becomes `identified` with a `scanId` → `router.replace('/result/' + scanId)`; `failed` → `FailedCard` with "Retry" (`retry`) and the error text.

**Verify**: RTL: each card renders its copy and buttons; `identified` triggers `replace` (mocked router).

### Step 2: Indexing state

Server `status: 'waiting'` → `IndexingCard`: "Indexing this museum — {worksIndexed} of {pagesMapped} works" from `museums.getStatus` (live), a progress bar, the soft candidates below it ("Maybe one of these?" if any), and the label button "Get the exact answer — point at the label" (always). When the scan flips to `identified` the card re-renders automatically (same query).

**Verify**: RTL: numbers interpolate; label button present; progress bar width from the ratio (pure helper tested).

### Step 3: Unsupported version and failures

`UnsupportedCard`: "Update the app to identify this painting" + a button opening the App Store/TestFlight link (`Linking.openURL(process.env.EXPO_PUBLIC_APP_STORE_URL ?? 'itms-beta://')`), plus "Save anyway". `FailedCard` for `failed` with the server error mapped to friendly copy.

**Verify**: RTL: copy and button.

### Step 4: Queue sheet

`queue.tsx` (formSheet, 0.5 detent) → `QueueSheet`: rows (`QueueRow`: crop thumbnail, relative time, status text "Waiting for signal" / "Identifying…" / "Failed — tap to retry", label-photo icon when attached), tap → the row's card; a footer "Scans are identified in order when you're back online". `QueueBadge` (05.01) opens `/queue`.

**Verify**: RTL: rows render statuses; retry calls the queue.

### Step 5: Scan-time banner

When the current venue's `indexStatus.status ∈ { queued, building }`, the Scan screen's `VenuePill` shows "Indexing…" with the count (subscribe via `museums.getStatus`).

**Verify**: RTL: pill variant renders "Indexing · 640 of 2,100".

## Test plan

RTL tests for every card/sheet/row with fixture props; pure test for the progress ratio; Simulator: Airplane-mode capture → waiting card → label capture → reconnect → replaced by the result.

## Done criteria

- [ ] `npm run test:app` ≥ 10 new; tsc/lint
- [ ] Simulator walkthrough for waiting → identified and for the queue sheet
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The router cannot present two formSheet routes from the root stack simultaneously — present the queue as a pushed screen and note it.

## Maintenance notes

- Copy is product voice from the design; keep the exact "waiting for signal" and "Indexing this museum" phrasing.
