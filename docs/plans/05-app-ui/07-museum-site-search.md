# Plan 05.07: Museum-site search on the soft card — consent, progress, on-device image and homography check, "Found on the museum's site"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 55f0673..HEAD -- src/components/scan/result src/components/settings src/lib/museum-search src/lib/settings/museum-search.ts src/lib/label shared/orb convex/lib/orb convex/_generated tsconfig.json package.json vitest.config.mts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (sends the artwork crop off the phone; the consent copy is a product/legal surface; ORB on downloaded images is new phone work)
- **Depends on**: 04.12 (backend), 05.02 (soft and unidentified cards), 05.03 (`image-check.ts`, `verified-fields-form`, `evidence-badge`, the contribute bar), 03.03 (embed), 03.04 (ORB extraction), 03.06 (capture cache: the scan's crop, vector and ORB features)
- **Category**: feature (UI)
- **Planned at**: 2026-09-10, after the crawler was removed (see `docs/plans/README.md`, "No crawler")

## Why this matters

Design §4.4 "Museum-site search": the card keeps working while the museum's own site is searched; the first time, the app asks before a copy of the crop leaves the phone; pixels decide on the phone — a candidate survives only when its embedding is close and an ORB homography holds; a survivor lands on the soft card as "Found on the museum's site: Title, Artist" with the page link, locked fields and the same save and contribute path as a label read. §4.5/§5.5: the crop leaves the phone only with consent and is not retained. §5.1: candidate images are downloaded, embedded and verified on the phone, so the server never needs an embedder or a museum image.

## Current state

- Backend (04.12): `museumSearch.searchMuseumSite({ scanId, imageBase64 })` → `{ stage: 'candidates' | 'none', reason?, candidates: [{ sourceUrl, fields, imageUrls }] }`; `museumSearch.confirmSearchCandidate({ scanId, sourceUrl, imageCheck: { url, cosine, homographyValid } })` → the label flow display with `tavily+image` fields; errors `feature_off`, `rate_limited`, `spend_cap`, `no_venue_site`, `venue_opted_out`, `image_mismatch`, `model_error`.
- Phone: `runCapture` stages (`warper`, `embedder`, `orb` — 03.02–03.04) and the capture cache (03.06) holding the scan's crop path, vector and encoded ORB features per `localId`; 05.03's `src/lib/label/image-check.ts` (download ≤ 3 images, letterbox+embed, cosine) and `crop.ts` (resize + JPEG + base64); `verified-fields-form`, `evidence-badge`, `consent-sheet` and the contribute bar from 05.03; `@expo/ui` `BottomSheet` per the repo skill `expo-ui`.
- ORB matching and RANSAC live in `convex/lib/orb/{hamming,match,homography,verify}.ts` as pure TypeScript with no Convex imports (plan 04.01); the phone needs the same code to verify a downloaded image against the scan's features.
- After 04.12 Step 5, `scans.get` exposes optional `labelFlow` (without `rawOcr`) and `museumSearch`; the card subscribes to these fields and restores them when reopened. Confirm that public contract exists before building the section.
- Jest already includes `shared/`; Vitest includes only `convex/**/*.test.ts`. The ORB suites currently import Vitest APIs, so Step 1 converts the moved suites to Jest.

## Scope

**In scope**: `shared/orb/**` (move the library, fixtures and suites from `convex/lib/orb/`; convert its suites to Jest), all affected backend/app/test imports and `convex/_generated/` (codegen after the move), `tsconfig.json` (shared alias), `src/lib/museum-search/{flow,candidate-check}.ts` (+ tests), `src/lib/label/image-check.ts` (share the homography check), `src/components/scan/result/{museum-search-section,search-consent-sheet}.tsx` (+ tests), `src/components/scan/result-screen.tsx` (button, progress, restored state), `src/lib/settings/museum-search.ts` (consent storage and tests), `src/components/settings/museum-search-section.tsx` (+ tests) and `src/components/settings/settings-screen.tsx` (mount the consent toggle).

**Out of scope**: backend behavior (04.12), the label capture screen (05.03), the broader Settings redesign (05.06 preserves this plan's consent control). The revocation control ships with museum-site search; it does not wait on the P2 Settings plan.

## Steps

### Step 1: Share the ORB verifier with the phone

Move the library, including `index.ts`, tests and fixtures, from `convex/lib/orb/` to `shared/orb/`. Update every backend, app and test import, including direct fixture imports; resolve the existing JSON fixtures relative to the new location and use kebab case for moved filenames such as `test-fixtures.ts` and `python-fixture.test.ts`. Remove the old directory. The app imports `verifyOrb` and `decodeOrbFeatures` from `@/shared/orb` (add `@/shared/*` → `./shared/*` to `tsconfig.json`); backend files use relative imports into `shared/orb`.

Convert the moved suites from Vitest imports to the existing Jest globals, preserving every test case and assertion; translate any Vitest-specific mocks to Jest if added before execution. Keep `vitest.config.mts` scoped to `convex/`: the ORB cases now run in `test:app` under Jest's existing `shared/` root. Record their test count before the move and confirm it afterwards.

**Verify**: `npx jest --listTests --runInBand shared/orb` lists every moved suite; `npx jest --runInBand shared/orb` passes with the preserved case count; `rg -n "vitest" shared/orb` → no matches; `npm run test:convex` passes its remaining backend suites; `npm run test:app` passes including the moved suites; `npx convex codegen` and `npx tsc --noEmit` pass with no stale imports. Commit the generated changes.

### Step 2: Consent

`src/lib/settings/museum-search.ts` owns `getMuseumSearchConsent() → 'unset' | 'granted' | 'declined'` and `setMuseumSearchConsent(value)` in local storage (03.06's store); both the result card and Settings use this module. `search-consent-sheet.tsx` (`@expo/ui` `BottomSheet`), copy verbatim:

> **Search this museum's collection?**
> We'll send a copy of your photo of the painting to a vision model that describes what it shows, then search the museum's website for a match. The photo isn't stored. You can turn this off in Settings.
> [Search] [Not now]

"Search" → persist `granted` before running the flow; "Not now" → dismiss for this scan without changing the stored value (the sheet returns next time; `declined` persists only from Settings).

**Verify**: RTL: copy present verbatim; Search persists `granted` before any upload; Not now leaves the stored value unchanged and sends no image.

### Step 3: Flow orchestrator

`flow.ts`: `runMuseumSearch({ scanId, localId, api, embed, extractOrb, onStage })` → stages `describe | search | check | done | none`:

1. Require the current persisted consent to be `granted`. From the capture cache: the crop path, the scan vector and the scan's ORB features. `crop.ts` (05.03) resizes the letterboxed crop to a 1024 px long side, JPEG 0.8, base64 (≤ 1.5 MB, else 800 px). Recheck consent immediately before the request so revoking it during crop preparation prevents the upload.
2. `searchMuseumSite` → on `none` finish with `none` and the reason.
3. `candidate-check.ts`: for each candidate in order and each of its image URLs (≤ 3 candidates, ≤ 2 images each, stop at the first pass): download to the cache directory, letterbox and embed (03.02/03.03 stages), cosine with the scan vector; when `≥ 0.85`, `extractOrb` on the letterboxed image (03.04) and `verifyOrb(scanFeatures, candidateFeatures, { inputSize })` from `shared/orb`; pass when `verified`. Delete downloaded files afterwards.
4. First pass → `confirmSearchCandidate` with `{ url, cosine, homographyValid: true }` → `done`; no pass → `none` with reason `no_match`.

Error mapping: `feature_off` → "Museum search is paused right now", `rate_limited` → "Try again in a minute", `spend_cap` or a stored `none` reason of `cap` → "Museum search is paused for today", `no_venue_site` / `venue_opted_out` → the section stays hidden, model or network errors → "Couldn't search right now".

**Verify**: `flow.test.ts` with fake api/embed/extractOrb: stage order; unset/declined consent and revocation during preparation send no image; a high-cosine image with a failed homography never confirms; the first passing image confirms and later images are not downloaded; `none` reasons map to copy; downloaded files are removed.

### Step 4: The card

`result-screen.tsx`: on soft and unidentified cards with a `venueId`, above the label button, a secondary button "Search this museum's collection"; tapping with consent `unset` opens the sheet, with `granted` runs the flow, and with `declined` the button is hidden. Reload consent on screen focus and check it before every upload. When consent is `granted` and `isInternetReachable`, the flow also runs automatically once per scan when the card first shows `soft` or `miss` and has no stored museum-search state; the button remains as the manual retry. Subscribe to `scans.get`: restore stored `none`, resume checking stored candidates without another description/search, and render a stored `confirmed` selection with its verified `labelFlow` without any provider call. Resume candidate work only with current consent and connectivity. Confirmed fields come from the public query, so navigating away and back preserves the result.

`museum-search-section.tsx`: while running, "Searching the museum's collection…" with the stage text; on `done`, the header "Found on the museum's site", the `verified-fields-form` from 05.03 (fields locked, `evidence-badge` label "From the museum's site" for `tavily+image`), the source link (`openBrowserAsync`), and the save and contribute bar from 05.03; on `none` with `no_candidates` or `no_match`, one line "Not on the museum's site — point at the label"; other reasons use Step 3's copy. The label button never waits for the search.

**Verify**: RTL with a mocked `useQuery` and flow: button present only with a venue and consent not declined; consent sheet on first tap; running state shows the progress line; `done` renders locked fields, the badge and the link; `none` renders the reason-specific line; remount with stored candidates resumes image checks without a search; remount with a confirmed result restores the fields and source link without a provider call; the label button is present in every state.

### Step 5: Consent revocation in Settings

Create `src/components/settings/museum-search-section.tsx` using the native toggle selected through the repo's `expo-ui` skill, and mount it in the existing `settings-screen.tsx`. Label: "Search museum sites with my photo". It is on only for stored `granted`; turning it off persists `declined`. Turning it on presents the same consent sheet as Step 2 and persists `granted` only after Search; dismissing leaves the value unchanged and toggling in Settings never uploads a photo. Show the consent explanation with the control. Plan 05.06 later incorporates this component into its Privacy section; it must preserve the stored choice and this control's behavior.

**Verify**: storage tests for unset, grant, revoke and relaunch; RTL: the control is reachable in the existing Settings screen, off persists `declined`, re-enabling requires the consent sheet, cancellation leaves it off. Navigate back to a missed scan after revoking and verify the search button is hidden and no automatic/manual flow uploads an image. On iOS in light mode, grant → Settings off → relaunch → new miss produces no upload; turn it on and accept the sheet to restore searches.

## Test plan

`flow.test.ts`, `candidate-check.test.ts` (cosine gate, homography gate, file cleanup), `src/lib/settings/museum-search.test.ts`, RTL tests for the consent sheet and both scan/Settings sections; preserve every ORB test case under `shared/orb` with Jest APIs. Device run against the dev deployment at a Bay Area venue with 04.12's live check as the reference.

## Done criteria

- [ ] `npm run test:app` ≥ 12 new feature tests plus every moved ORB case; `npm run test:convex` passes its remaining suites; tsc/lint/codegen
- [ ] Device: a miss at a venue shows the button; consent sheet once; a real candidate confirms and the card shows "Found on the museum's site" with locked fields and the link; `none` copy on a work the site does not have
- [ ] Consent copy present verbatim (test); `grep -rn "imageBase64" src/lib/museum-search` shows the crop is sent only from `flow.ts`
- [ ] Downloaded candidate images are deleted after the check (test)
- [ ] Stored candidates/confirmation restore through `scans.get` without another paid search (tests)
- [ ] Settings revocation ships with this feature and persists across relaunch; no upload after revocation (tests and iOS light-mode check)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- ORB extraction plus `verifyOrb` on a downloaded image exceeds 500 ms on the device — limit to one image per candidate and report the timing.
- `shared/orb` cannot be bundled by Metro or by Convex's bundler — report the failing import and bundler error before marking the move complete.

## Maintenance notes

- Evidence badge labels map 1:1 to `evidenceKind`; `tavily+image` reads "From the museum's site" on both this card and the label flow's.
- The consent text is the legal surface (§4.4/§4.5/§5.5); changes need the operator's review.
