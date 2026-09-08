# Plan 05.03: The label capture flow — framing overlay, QR, reading progress, locked verified fields, consent and contribution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/scan/label src/components/scan/label-capture-screen.tsx src/lib/label`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (multi-step async UI; consent copy is a product/legal surface)
- **Depends on**: 04.06, 04.07 (backend), 03.01 (camera, QR hook), 03.03 (local embedding for the image check), 03.06 (offline label photo), 03.07 (attested writes), 05.02
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.4 "The label flow" and §4.5: "Not in our index yet — point at the label"; a framing overlay; QR → exact answer; read with a vision model; verify; present verified fields locked, unverified editable; unlocking a verified field downgrades its evidence (§8 made visible); contribute opt-in with a consent sheet that says exactly what leaves the phone. §5.1: with no signal, the label photo is queued beside the crop and processed on reconnect.

## Current state

- Backend (04.06): `fetchQr({ scanId, url })`, `readLabel({ scanId, imageBase64 })` → fields with confidence, `verifyLabel({ scanId, fields, imageCheck? })` → `{ fields: { value, evidence, locked }, warnings, wikidataId?, imageUrls? }`; (04.07) `requestCropUpload`, `contribute({ scanId, descriptors, keypoints, fields, evidence, wikidataId?, cropStorageId, consent: true, nonce, assertionBase64 })`, `resolveRejection`.
- Phone: `useQrScanner` (03.01), `runCapture` stages (`warper`, `embedder`, `orb` — 03.02–03.04), `signPayload` (03.07), pending row helpers (03.06: `setLabelPhoto(localId, path)`, `setQrUrl`), `expo-image-manipulator` (`manipulate(uri).resize({ width }).renderAsync()` → `saveAsync({ format: JPEG, compress, base64 })`), `expo-file-system`.
- Route `label/[scanId]` (title "Label"); the scan's ORB features must be resent with `contribute` — keep them in memory from the capture (03.01 stores the last payload per `localId` in the pending row or an in-memory map `captureCache`).

## Scope

**In scope**: `src/components/scan/label-capture-screen.tsx`, `src/components/scan/label/{label-viewfinder,progress-steps,verified-fields-form,evidence-badge,consent-sheet,contribute-result}.tsx` (+ tests), `src/lib/label/{flow,image-check,crop}.ts` (+ tests), `src/lib/capture/capture-cache.ts`.

**Out of scope**: the reading/verification logic (server), offline flusher (03.06 calls `runLabelFlow` exported from `flow.ts` — this plan must export it), Settings' sharing default (05.06 provides `getSharingDefault()`; use `true` until it exists).

## Steps

### Step 1: Flow orchestrator (pure-ish)

`flow.ts`: `runLabelFlow({ scanId, labelPhotoUri?, qrUrl?, api, embed, onStage })` → stages `qr | read | verify | image-check | done`: if `qrUrl` → `fetchQr`; else downscale the photo (long side 1600, JPEG 0.8, base64) → `readLabel`; then `verifyLabel(fields)`; if `imageUrls` → `image-check.ts`: download ≤ 3 images to cache, letterbox+embed each (03.02/03.03 stages), cosine with the scan vector (from the capture cache); best ≥ 0.85 → `verifyLabel` again with `imageCheck`; return the final verification. Exported for 03.06's flusher. Errors map to user messages (`feature_off` → "Label reading is paused right now", `rate_limited` → "Try again in a minute", model errors → "Couldn't read the label — try a sharper shot").

**Verify**: `flow.test.ts` with fake api/embed: QR path skips reading; image check triggers the second verify only ≥ 0.85; stage callbacks in order; error mapping.

### Step 2: Capture UI

`label-capture-screen.tsx`: header copy "Not in our index yet — point at the label"; camera with `LabelViewfinder` (a 3:2 guide rectangle, hint "Fill the frame with the label, flat and in focus"); `useQrScanner(true, onCode)` → when a code is scanned show "Found a QR code" and run the flow with `qrUrl` immediately; shutter → run the flow with the photo. Offline (`isInternetReachable === false`): save the photo to the pending row (`setLabelPhoto`) or `setQrUrl`, show "Saved — we'll finish this when you're back online", and return to the queued card.

**Verify**: RTL test for `label-viewfinder` hint text; device: QR from a printed test code triggers `fetchQr`.

### Step 3: Progress and the form

`progress-steps.tsx`: a vertical stepper with the stage labels "Reading the label…", "Checking the museum's records…", "Checking Wikidata…", "Searching the web…", "Comparing images…" (checkmarks as stages complete; 3–6 s expected). `verified-fields-form.tsx`: fields from `verifyLabel`; locked fields show a lock icon + `EvidenceBadge` ("From the museum's records" for `accession`/`qr`, "Wikidata" for `wikidata`, "From the web" for `tavily`); tapping the lock asks "Edit this field? It was verified against <source>; editing means your entry needs a second confirmation before it can be shared." → unlock → field editable, badge changes to "Edited by you", `edited: true`; unverified fields are editable with no badge; warnings from plausibility shown as a yellow note ("The date is outside the artist's lifespan — please check").

**Verify**: RTL tests: locked field not editable until unlocked; unlocking sets the edited state and badge; warnings render.

### Step 4: Save and contribute

Bottom bar: "Save to collection" (same path as 05.02's save; `suggested` = null for label results — label saves never count as confirms of a match) and "Add to the shared index" (shown when the sharing default is on **or** always with the consent sheet — show it always; the sheet is the opt-in). `consent-sheet.tsx` copy (verbatim intent of §4.5):

> **Share this work with other visitors?**
> What leaves your phone: a numeric fingerprint of your photo (not the photo), the details read from the label, and a small crop of your own photo of the painting. The crop becomes the thumbnail other visitors see for this work. Full photos never leave your phone. You can withdraw a contribution from Settings.
> [Share] [Not now]

On Share: `crop.ts` resizes the letterboxed crop to 256 px JPEG q85 → `requestCropUpload` → POST → `storageId` → `contribute({ … descriptors/keypoints from the capture cache, fields (value + edited), evidence, wikidataId, cropStorageId, consent: true, …signPayload })` → `contribute-result.tsx` "Thanks — shared privately until it's verified" (or the duplicate/rejected message). If the card came from a "Not right?" rejection, call `resolveRejection({ kind: 'label', contributionId })` after contributing.

**Verify**: RTL: consent sheet text present; Share calls the upload then `contribute` (mocked); "Not now" saves nothing; device: a real contribution row appears in Convex with `status: private`.

## Test plan

`flow.test.ts`, `image-check.test.ts` (cosine + threshold), `crop.test.ts` (mocked manipulator), RTL tests for the form, badges, consent sheet, progress steps; device run against the dev deployment.

## Done criteria

- [ ] `npm run test:app` ≥ 15 new tests; tsc/lint
- [ ] Device: label read → verified fields locked → contribution created; offline path stores the label photo and completes on reconnect (with 03.06)
- [ ] Consent copy present verbatim (test)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- Base64 of a 1600-px JPEG exceeds 1.5 MB on the test device — lower to 1280 px and report.

## Maintenance notes

- Evidence badge labels map 1:1 to `evidenceKind`; adding a kind means adding a label.
- The consent text is the legal surface (§4.5/§5.5); changes need the operator's review.
