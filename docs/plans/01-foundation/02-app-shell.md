# Plan 01.02: Replace the template screens with the Art Identifier app shell

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/ app.json assets/images package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 01.01 is *expected* to have
> removed the web-only files listed below; that is not drift.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `docs/plans/01-foundation/01-verification-baseline.md`
- **Category**: feature (greenfield)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

The repo is still the `create-expo-app` template (a "Welcome to Expo" home tab and an "Explore" tab). Every later UI plan (`05-app-ui/*`) needs a stable route tree to drop screens into, and every backend plan needs the app to have a place to call it from. This plan installs the route skeleton the design doc implies — a Scan tab that opens to the camera, a Collection tab, a Settings tab, and the stack screens the identification and label flows push — with placeholder screen components, so later plans only fill in bodies and never restructure navigation.

Product facts from `docs/design/art-identifier.md` that fix the shape:

- §2: "The app opens to the camera with no account, so anyone can scan within seconds." → Scan is the first tab and the default route.
- §3 in-scope list: Scan, Identify (result card), Label capture, Collection (grid and canvas views, search), Visits, Settings-type items (sharing opt-in, optional account, export).
- §4.2: the "Looks like you're at X" venue picker is a sheet, not a screen.
- §5.1: result card and label capture are pushed from the scan flow.
- AGENTS.md: iOS only; light mode only; routes thin, bodies under `src/components/`.

## Current state

Files as they exist at `86571a3` (after plan 01.01 the `.web.tsx`, `.module.css`, `global.css` files are gone; everything else below still exists):

- `src/app/_layout.tsx` — root layout, renders the template tabs:
  ```tsx
  import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
  import * as SplashScreen from 'expo-splash-screen';
  import { useColorScheme } from 'react-native';

  import { AnimatedSplashOverlay } from '@/components/animated-icon';
  import AppTabs from '@/components/app-tabs';

  SplashScreen.preventAutoHideAsync();

  export default function TabLayout() {
    const colorScheme = useColorScheme();
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AppTabs />
      </ThemeProvider>
    );
  }
  ```
- `src/app/index.tsx` — template "Welcome to Expo" screen (uses `AnimatedIcon`, `HintRow`, `WebBadge`).
- `src/app/explore.tsx` — template "Explore" screen (uses `Collapsible`, `ExternalLink`, `WebBadge`, tutorial images).
- `src/components/app-tabs.tsx` — `NativeTabs` with two triggers `index` and `explore`, PNG icons from `assets/images/tabIcons/`:
  ```tsx
  import { NativeTabs } from 'expo-router/unstable-native-tabs';
  ...
      <NativeTabs
        backgroundColor={colors.background}
        indicatorColor={colors.backgroundElement}
        labelStyle={{ selected: { color: colors.text } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/home.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
  ```
- `src/components/themed-text.tsx`, `src/components/themed-view.tsx` — keep; they are the text/view primitives every screen uses. Exemplar of the repo's component style (named export, `@/` imports, `StyleSheet.create` at the bottom, `type` prop for variants):
  ```tsx
  export type ThemedTextProps = TextProps & {
    type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
    themeColor?: ThemeColor;
  };
  export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) { ... }
  const styles = StyleSheet.create({ ... });
  ```
- `src/constants/theme.ts` — tokens: `Colors.light/dark` (`text`, `background`, `backgroundElement`, `backgroundSelected`, `textSecondary`), `Fonts`, `Spacing` (`half:2, one:4, two:8, three:16, four:24, five:32, six:64`), `BottomTabInset`, `MaxContentWidth`. Keep and extend, never replace.
- `src/hooks/use-theme.ts`, `src/hooks/use-color-scheme.ts` — keep.
- `src/components/hint-row.tsx`, `src/components/ui/collapsible.tsx`, `src/components/animated-icon.tsx`, `src/components/external-link.tsx` — template-only; delete (`external-link.tsx` may be kept if you use it for the docent source chips later, but nothing in this plan needs it — delete it; plan 05.02 will add what it needs).
- `assets/images/` — template art: `react-logo*.png`, `tutorial-web.png`, `expo-badge*.png`, `expo-logo.png`, `logo-glow.png`, `tabIcons/*` → delete. Keep `icon.png`, `splash-icon.png`, `favicon.png`, `android-icon-*.png` (referenced from `app.json`) and `assets/expo.icon/` (iOS icon).
- `app.json` — `"userInterfaceStyle": "automatic"`; `experiments.typedRoutes: true` (typed routes are generated into `.expo/types/router.d.ts` when Metro runs).
- `package.json` scripts: `start`, `reset-project`, `android`, `ios`, `web`, `lint` (plus `test*` scripts added by plan 01.01).

Repo conventions to honor (from `AGENTS.md`):

- Kebab-case filenames under `src/`. Route files live only in `src/app/`; screen bodies and anything testable live in `src/components/<feature>/`.
- Light mode only: do not add dark-mode branches; existing dark token values may stay.
- Pre-release: delete superseded code, no compatibility shims.
- Follow existing UI patterns (`ThemedText`, `ThemedView`, `Spacing` tokens).
- Expo SDK 57 docs live at `https://docs.expo.dev/versions/v57.0.0/` (never `/latest/`). Router reference: `https://docs.expo.dev/versions/v57.0.0/sdk/router/` and `https://docs.expo.dev/router/advanced/native-tabs/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Lint | `npm run lint` | exit 0 |
| App tests | `npm run test:app` | all pass |
| Run on iOS Simulator | `npm run ios` | Metro starts; app opens in Simulator (Expo Go is fine for this plan — no native modules yet) |

## Suggested executor toolkit

- Skill `expo-router` (repo path `.agents/skills/expo-router/SKILL.md`, references `tabs.md` and `route-structure.md`) — NativeTabs + nested Stack pattern and form sheets.
- Skill `expo-native-ui` for HIG rules (ScrollView first child, `contentInsetAdjustmentBehavior="automatic"`).
- Xcode MCP tools (`session_show_defaults`, `screenshot`) to confirm the shell on the Simulator.

## Scope

**In scope** (the only files you should create, modify, or delete):

- `src/app/**` (rewrite the tree as specified below)
- `src/components/scan/scan-screen.tsx`, `src/components/scan/result-screen.tsx`, `src/components/scan/label-capture-screen.tsx` (create)
- `src/components/collection/collection-screen.tsx`, `src/components/collection/saved-work-screen.tsx` (create)
- `src/components/settings/settings-screen.tsx` (create)
- `src/components/venue/venue-picker-sheet.tsx` (create)
- `src/components/hint-row.tsx`, `src/components/ui/collapsible.tsx`, `src/components/animated-icon.tsx`, `src/components/external-link.tsx`, `src/components/app-tabs.tsx`, `src/components/web-badge.tsx` if still present (delete)
- `assets/images/react-logo.png`, `react-logo@2x.png`, `react-logo@3x.png`, `tutorial-web.png`, `expo-badge.png`, `expo-badge-white.png`, `expo-logo.png`, `logo-glow.png`, `assets/images/tabIcons/` (delete)
- `app.json` (only `userInterfaceStyle`)
- `package.json` (only remove the `reset-project`, `android`, `web` scripts) and `scripts/reset-project.js` (delete)

**Out of scope** (do NOT touch):

- `src/constants/theme.ts`, `src/components/themed-*.tsx`, `src/hooks/*` — shared primitives; later plans extend them deliberately.
- `app.json` `android`/`web` blocks and the `react-native-web`/`react-dom` dependencies — harmless residue; removing deps is a separate `deps` change.
- Any real screen behavior (camera, lists, sheets content) — placeholders only. Bodies arrive in `05-app-ui/*`.
- `convex/`, `modules/`, `jobs/` — other workstreams.

## Git workflow

- Work on the current workspace branch (Conductor manages branch naming; do not rename it).
- One commit per step or logical unit. Conventional Commits, matching `git log` (e.g. `chore(agents): add improve skill`): use `feat(app): add scan, collection and settings shell`, `chore(app): remove template screens`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the template screens, components, assets and scripts

Delete every file listed under "delete" in Scope. Remove the `reset-project`, `android` and `web` entries from `package.json` `scripts` (keep `start`, `ios`, `lint`, and the `test*` scripts). Do not touch dependencies.

**Verify**: `git status --short | grep -c '^ D'` → at least 14 deleted paths; `grep -n '"reset-project"\|"android"\|"web"' package.json` → no output.

### Step 2: Lock light mode

In `app.json` set `"userInterfaceStyle": "light"` (was `"automatic"`). This is the AGENTS.md rule "light mode is the product" expressed in config so the OS never renders the dark tokens.

**Verify**: `grep -n userInterfaceStyle app.json` → `"userInterfaceStyle": "light"`.

### Step 3: Create the placeholder screen components

Create these files under `src/components/`. Each is a named-export function component that renders a `ThemedView` with `flex: 1`, a `ThemedText type="subtitle"` heading, and a one-line `ThemedText themeColor="textSecondary"` description. Use `Spacing` tokens for padding. No logic.

| File | Export | Heading text | Props |
|---|---|---|---|
| `scan/scan-screen.tsx` | `ScanScreen` | `Scan` | none |
| `scan/result-screen.tsx` | `ResultScreen` | `Result` | `{ scanId: string }` — render the id in a `type="code"` text |
| `scan/label-capture-screen.tsx` | `LabelCaptureScreen` | `Point at the label` | `{ scanId: string }` |
| `collection/collection-screen.tsx` | `CollectionScreen` | `Collection` | none |
| `collection/saved-work-screen.tsx` | `SavedWorkScreen` | `Saved work` | `{ savedId: string }` |
| `settings/settings-screen.tsx` | `SettingsScreen` | `Settings` | none |
| `venue/venue-picker-sheet.tsx` | `VenuePickerSheet` | `Looks like you're at…` | none |

Screens that will scroll later (`CollectionScreen`, `SavedWorkScreen`, `SettingsScreen`, `ResultScreen`) wrap their content in `<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>` as the first child so the nested Stack header insets are handled natively. `ScanScreen` and `LabelCaptureScreen` are full-bleed (no ScrollView; black background is fine later, plain `ThemedView` now).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 4: Rewrite the route tree

Replace `src/app/` with exactly this tree (delete `index.tsx` and `explore.tsx`):

```
src/app/
  _layout.tsx
  venue-picker.tsx
  (tabs)/
    _layout.tsx
    (scan)/
      _layout.tsx
      index.tsx
      result/[scanId].tsx
      label/[scanId].tsx
    (collection)/
      _layout.tsx
      index.tsx
      [savedId].tsx
    (settings)/
      _layout.tsx
      index.tsx
```

`src/app/_layout.tsx` — root Stack, light theme only, tabs headerless, venue picker as a form sheet:

```tsx
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="venue-picker"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.45],
            sheetGrabberVisible: true,
            headerShown: false,
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
```

(Drop `SplashScreen.preventAutoHideAsync()` and the `AnimatedSplashOverlay`; the default splash behavior is what we want — the app should reach the camera as fast as possible.)

`src/app/(tabs)/_layout.tsx` — NativeTabs with SF Symbols (no PNG assets). Scan first so it is the default:

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(scan)">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(collection)">
        <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

Each group `_layout.tsx` is a `Stack` from `expo-router/stack`. `(scan)/_layout.tsx` hides the header on `index` (full-screen camera later) and gives `result/[scanId]` the title `Result` and `label/[scanId]` the title `Label`. `(collection)/_layout.tsx` uses `headerLargeTitle: true` with title `Collection` on `index`; `[savedId]` title `Saved work`. `(settings)/_layout.tsx` title `Settings`, large title.

Route files are thin — a default export that reads params and renders the component, nothing else:

```tsx
// src/app/(tabs)/(scan)/result/[scanId].tsx
import { useLocalSearchParams } from 'expo-router';

import { ResultScreen } from '@/components/scan/result-screen';

export default function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return <ResultScreen scanId={scanId} />;
}
```

`src/app/venue-picker.tsx` renders `<VenuePickerSheet />`.

So that the shell is navigable before real flows exist, give `ScanScreen` two temporary `Link`s (from `expo-router`): `href="/result/demo"` labeled "Open result" and `href="/label/demo"` labeled "Open label capture"; give `CollectionScreen` a `Link href="/demo"` labeled "Open saved work" (inside the `(collection)` group this resolves to `[savedId]`); give `SettingsScreen` a `Link href="/venue-picker"` labeled "Open venue picker". Mark each with a comment `// Placeholder navigation; removed by docs/plans/05-app-ui/*`.

**Verify**: `npx tsc --noEmit` → exit 0. `npm run lint` → exit 0. `find src/app -type f | sort` → exactly the 12 files listed above.

### Step 5: Run on the Simulator and walk every route

`npm run ios` (press `i` if Metro asks). In the Simulator: the app opens on the Scan tab; three tabs are visible with SF Symbol icons; each placeholder link pushes its screen with a native header and back button; "Open venue picker" presents a form sheet at roughly half height with a grabber. Take a screenshot of the tab bar for the PR.

**Verify**: manual walk-through completed; no red-box errors in Metro; `ls .expo/types/router.d.ts` exists (typed routes generated) and `npx tsc --noEmit` still exits 0 with typed routes present.

## Test plan

- No new automated tests: the placeholders have no behavior, and NativeTabs/Stack layouts cannot be rendered under jest-expo. The screen components will get behavior tests in `05-app-ui/*` when they get behavior.
- Verification is the typecheck with typed routes (Step 5), lint, and the manual route walk-through.

## Done criteria

- [x] `npx tsc --noEmit` exits 0 (with `.expo/types/router.d.ts` present after a Metro run)
- [x] `npm run lint` exits 0
- [x] `npm run test:app` exits 0
- [x] `find src/app -type f | wc -l` → 12
- [x] `grep -rn "Welcome to\|reset-project\|tabIcons\|explore" src/ app.json package.json` → no matches
- [x] `grep -n '"userInterfaceStyle": "light"' app.json` → 1 match
- [x] Simulator walk-through done: Scan default tab, all three tabs, both stack pushes, saved-work push, venue-picker sheet
- [x] No files outside the in-scope list are modified (`git status`)
- [x] `docs/plans/README.md` status row updated

## Execution notes — 2026-09-09

- Drift check matched: only plan 01.01 had changed in-scope files, and it had
  already removed the `reset-project`, `android` and `web` scripts, so Step 1
  touched no scripts.
- `headerLargeTitle` is deprecated in the installed expo-router 57.0.19 types;
  the Collection and Settings stacks use `headerLargeTitleEnabled`.
- All three tab groups resolve `/`, and the router's config sorter fell back to
  filesystem order, so the app first opened on Collection. `(tabs)/_layout.tsx`
  exports `unstable_settings.anchor = '(scan)'` and `(scan)/_layout.tsx` exports
  `anchor = 'index'`; only an anchored index config wins the tie, so do not add
  an `index` anchor to the other groups.
- The Scan index keeps `headerShown: false` but sets `title: 'Scan'` so the back
  button on pushed screens reads "Scan" instead of "index".
- `ScanScreen` wraps its placeholder text in `SafeAreaView` because its header
  is hidden; the camera in 05.01 replaces it.
- Expo Go on the simulator kept the stale template bundle until it was
  terminated and reopened against Metro; a hot reload did not swap route trees.
- Walk-through on iPhone 17 Pro (iOS 26.5), light mode: Scan is the default
  tab, three SF Symbol tabs, Result and Label pushes with back buttons, Saved
  work push, venue picker form sheet at 45% with a grabber. Screenshots are in
  `.context/plan-01-02/` (gitignored).

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 01.01 has not been executed (`npm run test:app` script missing, or `src/components/app-tabs.web.tsx` still exists) — this plan depends on its baseline.
- `NativeTabs.Trigger.Icon` does not accept the `sf` prop in the installed `expo-router` (check `node_modules/expo-router/build/native-tabs/NativeTabTrigger.d.ts`); report rather than falling back to PNG assets.
- `presentation: 'formSheet'` is rejected by the installed `expo-router` Stack types.
- The Simulator cannot launch (Xcode/Simulator issue) — report; do not mark done without the walk-through.

## Maintenance notes

- Every later UI plan assumes this exact route tree. Adding a route means adding it here first; do not create routes under `src/app/` from a component plan without updating `docs/plans/README.md`.
- Typed routes: `.expo/types/router.d.ts` is generated by Metro and gitignored; CI typechecks must run `npx expo customize`-free — if typed-route errors appear in CI, generate types with a short `npx expo start` or drop `experiments.typedRoutes`; decide in plan 01.01's follow-up, not here.
- The placeholder `Link`s are intentionally ugly and are removed by `05-app-ui/01`, `05-app-ui/04`, `05-app-ui/06`.
- A reviewer should check: no logic in route files, no new files under `src/app/` that are not routes, light-only theme.
