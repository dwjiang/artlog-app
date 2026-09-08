# Plan 05.01: The Scan screen — viewfinder guidance, venue pill, queue badge, permissions, and dev timings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/components/scan src/app/\(tabs\)/\(scan\)`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 03.01, 03.02, 03.05, 03.06 (all provide the behavior this screen surfaces)
- **Category**: feature (UI)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

The app "opens to the camera with no account, so anyone can scan within seconds" (§2). The viewfinder must tell the user what to change before the shutter enables (§4.1), show which museum the phone thinks it is in (§4.2), and make the offline queue visible ("waiting for signal", §5.1). Everything behind it exists after the `03-on-device/*` plans; this plan is the surface.

## Current state

- `src/components/scan/scan-screen.tsx` (03.01/03.02) has the camera, shutter gating, `viewfinder-overlay.tsx` with quad + guidance text, import button, and two placeholder `Link`s from plan 01.02 ("Open result", "Open label capture") marked for removal.
- Hooks: `useVenue()` (03.05) → `{ status, venue, visitId, … }`; `useQueue()` (03.06) → `{ pending, items }`; `runCapture` returns `sent | queued | retake` (03.01).
- Design tokens: `src/constants/theme.ts` (`Colors.light`, `Spacing`, `Fonts`); primitives `ThemedText`, `ThemedView`; light mode only; HIG rules from the repo skill `expo-native-ui` (glass buttons on cameras via `expo-glass-effect`, SF Symbols via `expo-image` `sf:` or `expo-symbols` — the repo already uses `expo-symbols`'s `SymbolView`; keep that pattern), `expo-haptics`.
- Route: `src/app/(tabs)/(scan)/index.tsx` (headerless).

## Scope

**In scope**: `src/components/scan/{scan-screen,viewfinder-overlay,venue-pill,queue-badge,camera-permission,retake-banner,dev-timings}.tsx` (+ tests for the pure/presentational ones), `src/app/(tabs)/(scan)/index.tsx` (no logic), `src/constants/theme.ts` (add semantic tokens if missing: `accent`, `overlayScrim`, `success`, `warning` in `Colors.light` and matching dark values to keep the shape).

**Out of scope**: result card (05.02), label capture (05.03), queue detail sheet content (05.05 — this plan only shows the badge and navigates to `/queue`, a formSheet route 05.05 adds; until then the badge is non-interactive).

## Steps

### Step 1: Remove placeholders and lay out the screen

Delete the two placeholder `Link`s. Layout (full-bleed camera): top-left `VenuePill` (glass capsule: SF `building.columns` + venue name, or "Finding your museum…" while locating, or "No museum nearby" with a tap to open `/venue-picker`); top-right `QueueBadge` (SF `tray.and.arrow.up` + count, hidden when 0); bottom: import button (SF `photo`), shutter (72 pt, white ring, disabled state at 40% opacity), and a small caption above the shutter showing the guidance text from the tracker. Use `useSafeAreaInsets` for padding; `GlassView` from `expo-glass-effect` for the pills/buttons; haptic `selectionAsync` on shutter, `notificationAsync(Warning)` on `retake`.

**Verify**: device/Simulator: layout matches; `npx tsc --noEmit` → 0.

### Step 2: Viewfinder overlay polish

`viewfinder-overlay.tsx`: quad drawn with Reanimated shared values (corner dots + edges, `accent` color when stable, white otherwise; fade in/out over 150 ms); guidance label uses `ThemedText type="smallBold"` on a scrim; when `searching` for > 3 s show a hint line "Point at a painting; the shutter turns on when it's framed".

**Verify**: `viewfinder-overlay.test.tsx` (RTL) renders the guidance text for each state prop; `npm run test:app` passes.

### Step 3: Retake banner and dev timings

`retake-banner.tsx`: shows the triage message ("Dodge the glare" / "Hold steady and try again") with a "Retake" button that re-enables the shutter; auto-dismiss after 4 s. `dev-timings.tsx` (`__DEV__` only): last capture's stage timings (warp/triage/embed/orb/identify ms) as a tiny monospace overlay bottom-left.

**Verify**: `retake-banner.test.tsx`: message + button visible, `onRetake` called.

### Step 4: Wire outcomes

`sent` → `router.push('/result/' + scanId)`; `queued` → `router.push('/result/local-' + localId)`; `retake` → banner. Camera pauses when the screen loses focus (`useIsFocused`) or the app backgrounds.

**Verify**: device: a scan of an indexed painting navigates to the result; Airplane mode → queued route.

## Test plan

RTL tests for `viewfinder-overlay`, `venue-pill` (each status renders its text), `queue-badge` (hidden at 0, shows count), `retake-banner`; camera and navigation verified on device.

## Done criteria

- [ ] Placeholder links gone (`grep -rn "Placeholder navigation" src/components/scan` → none)
- [ ] `npm run test:app` ≥ 6 new tests; tsc/lint pass
- [ ] Device walkthrough: pill states, badge, gating, retake, both navigations
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `expo-glass-effect` `GlassView` is unavailable on the test device's iOS version — use a translucent `ThemedView` fallback and note it.

## Maintenance notes

- Keep all strings in the component files (no i18n layer yet); English only per §4.8.
