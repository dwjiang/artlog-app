# Plan 05.02: The result card — confident, soft and unidentified states, edit and save, docent with sources, "Right now", and "Not right?"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/scan/result src/components/scan/result-screen.tsx src/app/\(tabs\)/\(scan\)/result`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW–MED (the most-seen screen; many states)
- **Depends on**: 04.03, 04.07, 04.09 (backend), 03.06 (local save), 05.01
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3/§4.4/§4.5/§4.6/§4.8/§9: the card shows title, artist, date, medium and institution the moment the calibrator decides, with a confidence indicator; the soft card shows runner-ups ("Maybe one of these?") and an honest "Unidentified" state with blank title/artist; every field is editable before saving; docent sentences render with a tappable source chip per fact; "Right now" is labeled "From the web" with its source; "Not right?" shows runner-ups first, then label capture; the card thumbnail is the user's own photo (in-copyright works never show a museum image, §5.5); nothing on the card waits for a model call.

## Current state

- `scans.get` (04.03/04.09) → `{ status, outcome, best: { objectId, artworkId, probability, corners?, title, artist, date?, medium?, institution?, thumbnailUrl?, rightsStatus }, runnerUps: [...same shape], docent?: [{ sentence, factIds }], factSheet?: [{ id, sourceUrl, sourceLabel }], rightNow?: { text, sourceUrl, sourceLabel }, labelFlow?, error? }`; `useQuery` re-renders as fields arrive.
- Mutations: `saveToCollection` (04.07), `rejectMatch`, `resolveRejection` (04.07); local `insertSavedWork` (03.06); `signPayload` (03.07) for attested writes; the crop path for a `scanId` is in `pendingScans` (03.06) — expose `getCaptureForScan(scanId)`.
- Repo UI conventions: `ThemedText`/`ThemedView`, `Spacing`, `@expo/ui` for form controls (`FieldGroup`, `TextField`, `Button`, `BottomSheet`) per the repo skill `expo-ui`; `expo-image` for images; `expo-web-browser` `openBrowserAsync` for source links; `expo-haptics`.
- Route `result/[scanId]` with a Stack header (title "Result"); `local-<id>` ids belong to 05.05.

## Scope

**In scope**: `src/components/scan/result-screen.tsx`, `src/components/scan/result/{card-header,fields-form,confidence-chip,corners-overlay,docent-section,right-now-section,runner-ups,not-right-sheet,save-bar}.tsx` (+ tests), `src/lib/result/{state,snapshot}.ts` (+ tests: pure mapping from the scan doc to view state; snapshot builder).

**Out of scope**: label capture (05.03 — this plan only navigates to `/label/[scanId]`), waiting/queued/unsupported states (05.05), collection detail (05.04).

## Steps

### Step 1: View state (pure)

`state.ts`: `toResultViewState(scan) → { kind: 'loading' | 'confident' | 'soft' | 'unidentified' | 'waiting' | 'unsupported' | 'failed', primary?, runnerUps, docent, rightNow, editable: boolean }` — `confident` when `outcome === 'confident'`; `soft` when `outcome === 'soft'` (primary = best, shown as "Maybe" not as fact); `unidentified` when `miss` or no best; `waiting`/`unsupported`/`failed` pass through for 05.05. `snapshot.ts`: `buildSnapshot(fields, viewState) → { snapshot, suggested }` where `suggested` is the server's title/artist for `confident` only (soft cards never count as confirms).

**Verify**: `state.test.ts` and `snapshot.test.ts` cover each branch.

### Step 2: Card layout

`result-screen.tsx` (ScrollView, `contentInsetAdjustmentBehavior="automatic"`): `CardHeader` — the user's crop (from `getCaptureForScan`) with `CornersOverlay` (polyline from `best.corners` scaled to the image) and a `ConfidenceChip` ("Match" for confident, "Maybe" for soft, "Unidentified"); `FieldsForm` — title, artist, date, medium, institution as `@expo/ui` `TextField`s pre-filled (blank title/artist for unidentified), all editable; `SaveBar` — "Save to collection" (primary) and, when not confident, a secondary "Get the exact answer — point at the label" button routing to `/label/[scanId]`; `DocentSection` and `RightNowSection` below (confident only).

**Verify**: `result-screen.test.tsx` (RTL with a mocked `useQuery` returning fixtures): confident shows fields + chip "Match"; soft shows "Maybe" and the label button; unidentified shows blank title/artist and the label button.

### Step 3: Docent and "Right now"

`docent-section.tsx`: while `docent` is undefined on a confident card show a one-line skeleton "Writing about this work…" (max 10 s, then hide); render sentences as a paragraph; after each sentence, one small chip per `factId` labeled with `sourceLabel` (tap → `openBrowserAsync(sourceUrl)`). `right-now-section.tsx`: header "From the web", the text, the source link; hidden when absent.

**Verify**: tests: chips render one per fact id with the right label; tapping calls the browser opener (mocked); section hidden without data.

### Step 4: Save

`SaveBar` → `buildSnapshot` → local `insertSavedWork` (with `cropPath/photoPath`, `venueId`, `visitLocalId`, `gallery`, `objectId/artworkId`, `scanId`) → `saveToCollection({ localId, …, snapshot, suggested })` (fire-and-forget with retry via the sync path — 04.11; until then, call and ignore network errors) → haptic success → "Saved · View in collection" link. Saving is allowed from every state (blank fields allowed only if the user typed a title — require a non-empty title).

**Verify**: test: save with untouched fields passes `suggested` equal to the server fields; editing the title passes the edited snapshot and still passes `suggested` (server-side rule decides the confirm).

### Step 5: "Not right?"

`not-right-sheet.tsx` (`@expo/ui` `BottomSheet`): opened from a "Not right?" text button under the header; on open call `rejectMatch({ scanId, objectId: primary.objectId, …signPayload })`; list `runnerUps` as `RunnerUps` rows (thumbnail if `thumbnailUrl`, else a placeholder frame; title · artist · institution); picking one → `resolveRejection({ feedbackId, resolution: { kind: 'runner_up', objectId } })` and the card re-renders with that candidate as primary (soft styling, `confidence: 'Maybe'`); "None of these — point at the label" → `/label/[scanId]` (05.03 resolves the rejection with `label` on contribution). Runner-ups are also shown inline on soft/unidentified cards ("Maybe one of these?") without a rejection.

**Verify**: tests: opening the sheet calls `rejectMatch` once; picking calls `resolveRejection`; the label button routes.

## Test plan

RTL tests per component with fixture scan docs (`src/components/scan/result/__fixtures__/scan.ts`); pure tests for `state`/`snapshot`; device walkthrough for a confident and a miss.

## Done criteria

- [ ] `npm run test:app` ≥ 15 new tests; tsc/lint
- [ ] Device: confident card shows fields instantly, docent appears within seconds, "Right now" when flagged on; soft and unidentified cards match the design copy
- [ ] No museum image is ever shown as the main card image (`grep -n "thumbnailUrl" src/components/scan/result/card-header.tsx` → none; thumbnails only in runner-up rows)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `@expo/ui` `TextField`/`BottomSheet` are missing at the installed version — fall back to RN `TextInput` and a Stack `formSheet`, and note it.

## Maintenance notes

- The copy strings are product voice; change them deliberately ("Maybe one of these?", "Get the exact answer — point at the label", "From the web").
