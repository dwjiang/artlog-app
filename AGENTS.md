# Project agent guide

Agent docs record routing, workflow gates, and durable invariants; code, types,
tests, configuration, and history record implementation.

## Maintaining agent docs

- Refactor test: omit statements made stale by a behavior-preserving rename,
  move, or rewrite. Before editing agent docs, identify the false statement
  replaced or recurring costly failure prevented, unless the user explicitly
  requests the documentation change.
- Give each rule one owner; remove or merge before adding. Without an explicit
  request, agent docs shrink or stay level and do not serve as a completion
  artifact. Keep the root guide concise.
- When directory-local rules are needed, use nested `AGENTS.md` with a one-line
  `CLAUDE.md` pointing to it. Use `docs/agents/` for cross-directory rules when
  needed. Root guide routes use plain relative paths, never `@` imports, and
  must point to existing guides.
- Read every matching guide before editing. Tests follow the guides for their
  production code.

## Engineering principles

- **Important — this is pre-release:** There are no real users or data worth
  preserving. Make breaking data-shape, schema, component-API, and
  function-signature changes directly, then update every caller. Do not add
  migrations, compatibility shims, version flags, deprecation paths, or dual
  code paths solely for old data or callers.
- Choose the simplest implementation that fully meets the current requirement.
  Avoid speculative abstractions, configuration, and indirection.
- Build the smallest working end-to-end version first, then layer capabilities
  without leaving the product partially migrated.
- Remove superseded code instead of adding fallbacks or compatibility layers
  unless compatibility is an explicit requirement. Update every affected caller
  when changing an API or function signature.
- Write self-explanatory code through names, types, structure, and tests.
  Comments preserve only a non-obvious reason, invariant, tradeoff, platform
  quirk, or safety boundary that those surfaces cannot express. Keep them
  concise and remove them when they become redundant. Use JSDoc only for
  externally consumed contracts that TypeScript cannot express.
- Keep concerns separated: extract route-independent UI and behavior before a
  route accumulates unrelated components, state, or platform branches.
- Prefer established libraries when they reduce total complexity; check
  existing dependencies, docs, and types before adding a package or
  reimplementing common behavior.
- Favor durable architectural choices over stopgaps intended to be replaced.
- When the user defers a suggested change (for example, "later" or "out of
  scope"), do not implement it.

## Project conventions

- **iOS is the only product target.** Do not extend web/Android residue or gate
  work on its scripts.
- **Expo HAS CHANGED:** Read the exact versioned docs at
  https://docs.expo.dev/versions/v57.0.0/ before writing any code. Never
  substitute `/latest/`. This project uses Expo SDK 57, React Native 0.86, and
  React 19.2; also consult installed package types when confirming APIs.
  Add packages with `npx expo install`.
- Commit generated Convex output under `convex/_generated/`. Run
  `npx convex codegen` after a Convex schema or backend function-signature
  change.
- New source filenames use kebab case; Convex modules use camel case. Keep
  framework-reserved filenames and platform-specific suffixes.
- When adding a variable to `.env.local`, document it in `.env.example` using
  a non-secret placeholder and set the same variable to the same value in the
  Conductor root repository's `.env.local`. Locate that repository via
  `CONDUCTOR_ROOT_PATH`, or the primary checkout in `git worktree list` if unset.

## Design

- **Do not implement, polish, or verify dark mode.** Light mode is the
  product for now. Existing dark token values may remain to keep the token
  shape stable; don't gate or test work on dark appearance until this rule is
  removed.
- Follow existing UI patterns for UI changes. Applying an existing pattern or
  changing one component belongs in code and relevant tests.
- Keep reusable design-language rules about tokens, typography, shape, motion,
  voice, and layout separate from component-specific behavior. Component rules
  belong with the component in code, tests, or an applicable local guide.

## Test policy

- Add focused automated coverage for meaningful behavior changes and regression
  tests for reliably reproducible bugs. Prefer test-first for pure logic,
  parsing, persistence, and authorization. UI work may find its test boundary
  during implementation. Avoid tests that merely mirror implementation details.
- Co-locate tests with the code as `*.test.ts`/`*.test.tsx`; organize them by
  observable behavior and contracts, not implementation functions. Keep tests
  outside `src/app/`, where Expo Router treats files as routes. Keep route
  modules thin and test the components they render under `src/components/`.
- Query UI by visible role, label, or text; use test IDs only when no semantic
  surface exists.
- This repo has no automated test runner configured yet. For work that needs
  automated coverage, establish suitable test tooling as part of that work and
  make any remaining verification gap explicit.

## Completion

- Code changes: run `npx tsc --noEmit` and, when ESLint is configured,
  `npm run lint`. The lint script exists, but ESLint dependencies and
  configuration are not set up yet. Report any checks that could not run.
- Run relevant automated tests when test tooling is available; there is
  currently no `npm test` script.
- Check changed app behavior on iOS in light mode using `npm run ios`.
- Documentation-only changes: check the diff, referenced paths, and commands;
  app tests are unnecessary unless behavior also changes.
- EAS deployment, submission, and store commands require an explicit request.
