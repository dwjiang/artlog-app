# Plan 05.06: Settings — sharing default, account, export as JSON, privacy copy, about, dev tools

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/settings src/lib/export src/app/\(tabs\)/\(settings\)`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 03.06 (settings/repos), 04.11 (account), 04.04 (device id), 03.03 (dev tools), 05.03 (sharing default consumer), 05.07 (museum-search consent control)
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3: "Shared index — opt-in, no account needed"; "Optional account — sign in to sync… never required"; "Private, local-first storage; export collection metadata as JSON". §4.5: the consent sheet says exactly what leaves the phone; Settings is where the user can see the same promise, withdraw contributions, and sign in/out.

## Current state

- `settings-screen.tsx` holds the 01.03 health line, the 04.04 device line, a placeholder link, and the 03.03 dev tools; 04.11 added a sign-in row.
- 05.07 mounts `src/components/settings/museum-search-section.tsx` in Settings and owns `getMuseumSearchConsent`/`setMuseumSearchConsent` under `src/lib/settings/museum-search.ts`. The search feature already includes revocation; this redesign preserves the component and stored choice.
- Repos: `getSetting/setSetting` (03.06); `listSavedWorks`, `listVisits`, notes; `contributions.mine` (04.07) and a `withdraw` mutation (add in 04.07's file: sets `status: rejected` with `rejectedReason: 'withdrawn'` and, if promoted, calls `revertObject` — in scope by exception, small); `accounts.me`, `useAccount()` (04.11).
- `@expo/ui` `List`/`ListItem`/`Switch`/`Button` for grouped settings rows (repo skill `expo-ui`); `expo-sharing` + `expo-file-system` for exporting a file; `expo-constants` for the app version.

## Scope

**In scope**: `src/components/settings/{settings-screen,sharing-section,account-section,export-section,privacy-section,about-section,dev-tools}.tsx` (+ tests), `src/lib/export/build-export.ts` (+ test), `src/lib/settings/sharing.ts` (`getSharingDefault`, `setSharingDefault`), `convex/contributions.ts` (`withdraw`), `package.json` (`expo-sharing`).

**Out of scope**: account internals (04.11), the contribution consent sheet (05.03), museum-search consent logic and its sheet (05.07; reuse its existing Settings component).

## Steps

### Step 1: Sections

`settings-screen.tsx`: `@expo/ui` `List` with sections: **Sharing** — switch "Offer to share confirmed labels" (default on; stored via `setSharingDefault`; when off, 05.03 hides the Share button but the consent sheet remains the per-contribution opt-in), a row "My contributions (n)" → a simple list with status and a "Withdraw" action per row; **Account** — "Sign in with Apple to sync across devices" (`AppleAuthenticationButton`) or "Signed in · n devices" with "Sign out"; **Export** — "Export collection as JSON"; **Privacy** — reuse 05.07's `museum-search-section.tsx` with its "Search museum sites with my photo" control and consent explanation, plus static copy: "Identification sends a numeric fingerprint of your photo. Label reading sends the label photo; museum-site search sends a crop of the painting only with your consent. These images aren't stored. Contributions keep a small crop only when you choose to share it. Your location is used on the phone to find the museum; coordinates never leave your phone."; **About** — app version, model version, backend status (the 01.03 health line moves here), links to the source repo and licenses; **Developer** (`__DEV__` only) — the 03.03 calibration export and timings toggle. Remove the placeholder link.

**Verify**: RTL: each section title and the privacy copy render; the sharing switch persists (mocked settings repo); withdraw calls the mutation; the museum-search control remains reachable, displays the prior stored choice, and disabling it still prevents uploads after navigating back to a scan. Run 05.07's existing consent tests after the redesign.

### Step 2: Export

`build-export.ts`: `buildExport({ works, visits, notes }) → { version: 1, exportedAt, visits: [...], works: [{ localId, title, artist, date, medium, institution, venue, gallery, savedAt, note, objectId, artworkId }] }` (no photos, no paths); `export-section.tsx`: write to `Paths.cache/artlog-export-<date>.json` and `Sharing.shareAsync(uri)`.

**Verify**: `build-export.test.ts`: shape, notes joined, no file paths; device: share sheet opens with the file.

## Test plan

RTL tests for sections; pure test for the export; device check for share and sign-in rows.

## Done criteria

- [ ] `npm run test:app` ≥ 8 new; tsc/lint; `npm run test:convex` covers `withdraw`
- [ ] Placeholder link gone; health line lives in About
- [ ] Museum-search consent control and persisted revocation survive the Settings redesign
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `@expo/ui` `List` misbehaves inside the tab's Stack (known virtualization caveat) — use a `ScrollView` of grouped `ThemedView`s and note it.

## Maintenance notes

- The privacy copy must stay consistent with 05.03's consent sheet and the README's privacy section (06.02).
