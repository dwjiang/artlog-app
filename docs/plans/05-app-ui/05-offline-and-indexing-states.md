# Plan 05.05: Waiting-for-signal, queued scans, and "update the app" states

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/scan/states src/app/queue.tsx src/app/_layout.tsx src/components/scan/result-screen.tsx`

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: 03.06 (queue), 04.03 (`unsupported_version`), 05.02
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3 "Honest offline", §5.1 "Offline" ("waiting for signal"; "capture the label now so we can finish this when you're back online"), §5.4 ("update the app to identify"), §9 ("Card appears when the connection returns"). These states are where the product's honesty shows.

## Current state

- `result-screen.tsx` (05.02) maps server states; `local-<localId>` routes are not handled yet; `toResultViewState` returns `unsupported | failed` kinds. There is no server-side waiting state: every scan resolves on its first run (the crawler and its waiting scans were removed 2026-09-10).
- Queue (03.06): `useQueue()` → `{ pending, items: [{ localId, status, capturedAt, cropPath, labelPhotoPath?, qrUrl?, scanId?, lastError? }] }`; `setLabelPhoto`, `setQrUrl`, `retry(localId)`.
- Route tree: `venue-picker` formSheet exists; add `queue` as another formSheet route in `src/app/_layout.tsx`.

## Scope

**In scope**: `src/components/scan/states/{waiting-for-signal-card,unsupported-card,failed-card,queue-sheet,queue-row}.tsx` (+ tests), `src/app/queue.tsx` (route → `QueueSheet`), `src/app/_layout.tsx` (formSheet screen), `src/components/scan/result-screen.tsx` (route `local-*` ids to the local card; render the state cards), `src/components/scan/queue-badge.tsx` (make it open `/queue`).

**Out of scope**: the queue logic (03.06), the label flow (05.03; this plan links to it with `?offline=1`).

## Steps

### Step 1: Local pending card

`result-screen.tsx`: when `scanId` starts with `local-` read the pending row live (`useLiveQuery`); `queued`/`identifying` → `WaitingForSignalCard`: crop, "Waiting for signal", the line "Capture the label now so we can finish this when you're back online", a "Point at the label" button → `/label/local-<id>?offline=1` (05.03 stores the photo/QR on the row), and a "Save anyway" (blank title required) path; when the row becomes `identified` with a `scanId` → `router.replace('/result/' + scanId)`; `failed` → `FailedCard` with "Retry" (`retry`) and the error text.

**Verify**: RTL: each card renders its copy and buttons; `identified` triggers `replace` (mocked router).

### Step 2: Unsupported version and failures

`UnsupportedCard`: "Update the app to identify this painting" + a button opening the App Store/TestFlight link (`Linking.openURL(process.env.EXPO_PUBLIC_APP_STORE_URL ?? 'itms-beta://')`), plus "Save anyway". `FailedCard` for `failed` with the server error mapped to friendly copy.

**Verify**: RTL: copy and button.

### Step 3: Queue sheet

`queue.tsx` (formSheet, 0.5 detent) → `QueueSheet`: rows (`QueueRow`: crop thumbnail, relative time, status text "Waiting for signal" / "Identifying…" / "Failed — tap to retry", label-photo icon when attached), tap → the row's card; a footer "Scans are identified in order when you're back online". `QueueBadge` (05.01) opens `/queue`.

**Verify**: RTL: rows render statuses; retry calls the queue.

## Test plan

RTL tests for every card/sheet/row with fixture props; Simulator: Airplane-mode capture → waiting card → label capture → reconnect → replaced by the result.

## Done criteria

- [ ] `npm run test:app` ≥ 8 new; tsc/lint
- [ ] Simulator walkthrough for waiting → identified and for the queue sheet
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The router cannot present two formSheet routes from the root stack simultaneously — present the queue as a pushed screen and note it.

## Maintenance notes

- Copy is product voice from the design; keep the exact "waiting for signal" phrasing.
