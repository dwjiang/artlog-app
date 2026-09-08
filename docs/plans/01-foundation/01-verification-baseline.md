# Plan 01.01: Establish the verification baseline — green typecheck, ESLint, Jest for the app, Vitest for Convex

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- package.json tsconfig.json src/ .gitignore`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch STOP.

## Status

- **Priority**: P0 (first plan; every other plan's done criteria use these commands)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tests
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

`AGENTS.md` requires every code change to pass `npx tsc --noEmit` and `npm run lint`, and to add focused automated tests — but the repo has no ESLint setup, no test runner, and `npx tsc --noEmit` currently fails with two errors from web-only CSS imports. Every later plan's done criteria are commands from this plan; nothing can be verified until it lands. It also removes the web residue that causes the type errors, which is consistent with the design (§2: "web build removed") and with `AGENTS.md` ("iOS is the only product target").

## Current state

- `npx tsc --noEmit` → 2 errors:
  ```
  src/components/animated-icon.web.tsx(5,21): error TS2307: Cannot find module './animated-icon.module.css' or its corresponding type declarations.
  src/constants/theme.ts(6,8): error TS2882: Cannot find module or type declarations for side-effect import of '@/global.css'.
  ```
  Cause: the CSS module declarations live in `node_modules/expo/types/global.d.ts`, which is only pulled in through `expo-env.d.ts` (`/// <reference types="expo/types" />`), a gitignored file Metro generates on first `expo start`. Rather than depend on generated files, remove the web-only imports.
- `src/constants/theme.ts` line 6: `import '@/global.css';` — web font variables; nothing else uses them on iOS.
- Web-only files: `src/components/animated-icon.web.tsx`, `src/components/animated-icon.module.css`, `src/components/app-tabs.web.tsx`, `src/hooks/use-color-scheme.web.ts`, `src/global.css`. `src/components/web-badge.tsx` is imported by the template screens and is removed with them in plan 01.02 — leave it now.
- `package.json` scripts: `start`, `reset-project`, `android`, `ios`, `web`, `lint: "expo lint"`. No `eslint` dependency, no `eslint.config.js`, no `jest`, no `vitest`.
- `tsconfig.json`: extends `expo/tsconfig.base`, `strict: true`, `paths: { "@/*": ["./src/*"], "@/assets/*": ["./assets/*"] }`, `include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]`.
- Installed: `expo` 57.0.20, `react-native` 0.86.3, `react` 19.2.3, `typescript` 6.0.3.
- Versions verified on npm 2026-09-08: `jest-expo` 57.0.5 (Expo's pin for SDK 57; depends on Jest 29), `eslint-config-expo` 57.0.2 (flat config), `@testing-library/react-native` 14.0.1 (peer `test-renderer ^1.0.0`), `vitest` latest, `@edge-runtime/vm`, `convex-test` 0.0.56 (installed later by plan 01.03).
- Exemplar component for the first RTL test: `src/components/themed-text.tsx` — `ThemedText({ style, type = 'default', themeColor, ...rest })` renders a `Text` with variant styles.
- Repo conventions: tests co-located as `*.test.ts(x)`, outside `src/app/`; query by visible text/role; kebab-case filenames; Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| App tests | `npm run test:app` | pass |
| Convex tests | `npm run test:convex` | pass (no tests yet → `--passWithNoTests`) |
| Everything | `npm test` | exit 0 |

## Scope

**In scope**: `package.json`, `package-lock.json`, `eslint.config.js` (generated), `vitest.config.mts` (create), `jest.setup.ts` (create if needed), `.gitignore` (add `coverage/`), delete the five web-only files listed above, `src/constants/theme.ts` (remove one import), `src/components/themed-text.test.tsx` (create).

**Out of scope**: any other file under `src/`; `app.json`; dependencies unrelated to tooling; removing `react-native-web`/`react-dom` (separate `deps` change); Convex packages (plan 01.03).

## Git workflow

- Current workspace branch; do not push unless told.
- Commits: `chore(config): remove web-only css imports`, `build(config): add eslint, jest and vitest`, `test(ui): add themed-text smoke test`.

## Steps

### Step 1: Remove the web residue that breaks typecheck

Delete `src/components/animated-icon.web.tsx`, `src/components/animated-icon.module.css`, `src/components/app-tabs.web.tsx`, `src/hooks/use-color-scheme.web.ts`, `src/global.css`. In `src/constants/theme.ts` delete the line `import '@/global.css';`. Also remove the `reset-project`, `android` and `web` npm scripts and `scripts/reset-project.js` if plan 01.02 has not already (whichever runs first does it).

**Verify**: `npx tsc --noEmit` → exit 0, no output.

### Step 2: ESLint

Run `npx expo lint`. When prompted, accept installing `eslint` and `eslint-config-expo`; it writes a flat `eslint.config.js` (`defineConfig` + `require('eslint-config-expo/flat')`). Add `ignores: ['convex/_generated/**', 'ios/**', 'android/**', 'coverage/**', 'jobs/**']` to the config. Fix any reported problems in the remaining template files (expect none or trivial ones).

**Verify**: `npm run lint` → exit 0.

### Step 3: Jest + React Native Testing Library for `src/`

`npx expo install jest-expo jest @types/jest --dev` then `npm install -D @testing-library/react-native test-renderer@^1.2.0`. In `package.json` add:

```json
"jest": {
  "preset": "jest-expo",
  "roots": ["<rootDir>/src", "<rootDir>/modules"],
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)"
  ]
}
```

(`modules/` does not exist yet; Jest tolerates a missing root only if you create the directory — create `modules/.gitkeep`.) Write `src/components/themed-text.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';

import { ThemedText } from './themed-text';

describe('ThemedText', () => {
  it('renders its children as visible text', () => {
    render(<ThemedText>Hello museum</ThemedText>);
    expect(screen.getByText('Hello museum')).toBeOnTheScreen();
  });
});
```

Add scripts: `"test": "npm run test:app && npm run test:convex"`, `"test:app": "jest"`, `"test:convex": "vitest run --passWithNoTests"`, `"typecheck": "tsc --noEmit"`.

**Verify**: `npm run test:app` → 1 passed; `npx tsc --noEmit` → 0 (the test file typechecks; if `toBeOnTheScreen` is untyped, add `import '@testing-library/react-native/extend-expect'` to a `jest.setup.ts` referenced by `setupFilesAfterEach` — RTL 14 registers matchers automatically, so this should not be needed).

### Step 4: Vitest for `convex/`

`npm install -D vitest @edge-runtime/vm`. Create `vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['convex/**/*.test.ts'],
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
  },
});
```

`convex-test` is installed by plan 01.03; the `inline` entry is harmless until then.

**Verify**: `npm run test:convex` → "No test files found" and exit 0 (because of `--passWithNoTests`); `npm test` → exit 0.

### Step 5: Housekeeping

Add `coverage/` to `.gitignore`. Confirm `.gitignore` still ignores `expo-env.d.ts` and `.expo/` (it does at `86571a3`).

**Verify**: `git status --short` shows only the in-scope changes; `npm run lint && npm run typecheck && npm test` → all exit 0.

## Test plan

- `src/components/themed-text.test.tsx` — one behavior test (visible text) that doubles as the RTL wiring check.
- No Convex tests yet (plan 01.03 adds the first).

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0 and `eslint.config.js` exists
- [ ] `npm run test:app` exits 0 with 1 passing test
- [ ] `npm run test:convex` exits 0
- [ ] `ls src/components/*.web.* src/hooks/*.web.* src/global.css src/components/*.css 2>/dev/null` → nothing
- [ ] `grep -n "global.css" src/constants/theme.ts` → no match
- [ ] No files outside scope modified (`git status`)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- `npx expo lint` does not offer to install or generates a legacy `.eslintrc` — report the output.
- `npx expo install jest-expo` selects Jest 30 and `jest-expo` fails to run — pin `jest@^29` and report.
- `@testing-library/react-native` 14 cannot render with React 19.2 / RN 0.86 after one attempt at the `test-renderer` peer — report versions.
- `npx tsc --noEmit` still errors after Step 1 — the cause is something other than the CSS imports; report the errors.

## Maintenance notes

- Two runners on purpose: Jest (`jest-expo` preset) for React Native code under `src/` and `modules/`, Vitest (`edge-runtime`) for `convex/`. Keep `convex/**` out of Jest's roots and `src/**` out of Vitest's `include`.
- Python jobs (plan 02.01) use `pytest` under `jobs/`; they are not part of `npm test`.
- Typed routes (`.expo/types/router.d.ts`) are generated by Metro; if CI typechecking ever needs them, run a short `npx expo start` in CI or drop `experiments.typedRoutes`.
