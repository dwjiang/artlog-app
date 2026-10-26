# Project agent guide

Keep agent docs focused on project constraints and task-specific routing.
Code, types, tests, and configuration are the source of implementation details.
Docs and comments state what stays true. Leave out dates, commit IDs, status or
progress notes (“not implemented yet”, “(new)”), implementation plans, and rules
tied to an event or release phase.

## Communication

- At the start of each session, read `.agents/skills/i-have-adhd/SKILL.md`
  and apply it by default to user-facing responses.
- Match each claim's strength to its evidence. Name the sample or eval behind a
  number, label unchecked causes, what-ifs, and predictions as inferences,
  and say "never", "none", "all", or "by design" only after checking. When
  shortening a reply, cut words, not these qualifiers.

## Maintaining agent docs

- Unless asked to update agent docs, edit them only to correct a false statement
  or prevent an identified recurring failure, never just to record completed work.
  Keep them the same size or smaller.
- Give each rule one owner. Merge duplicates and omit implementation descriptions
  that a behavior-preserving refactor would make stale.
- Put directory-specific rules in nested `AGENTS.md` with a one-line `CLAUDE.md`
  pointing to it; keep cross-directory rules in the root guide.
  Root routes use plain relative paths to existing guides, never `@` imports.
- Read guides that apply to the files being changed; tests follow their production
  code's guides. Load supporting docs only when relevant to the task.

## Engineering principles

- Choose the simplest complete implementation; avoid speculative abstractions and
  temporary stopgaps. When the same UI or logic appears in multiple places, extract
  one shared component or helper and migrate every copy to it.
- Where a skill such as `ponytail` conflicts with this guide, this guide wins: no
  `ponytail:` comment tags or ad-hoc self-checks; finish requested work end to end.
- Prefer established libraries when they reduce total complexity. Check existing
  dependencies, docs, and types before adding a package or rebuilding common behavior.
- Keep route modules thin; extract route-independent UI and behavior.
- Report unexpected failures in new or changed critical flows, including background
  work, through the shared Sentry helpers. Exclude expected cancellations, validation
  and offline retries; never attach user content or credentials or disrupt the operation.
- Use names, types, and tests to explain code. Comments should capture only
  non-obvious reasons, invariants, tradeoffs, platform quirks, or safety boundaries
  those cannot express. Keep comments concise and remove redundant ones; reserve
  JSDoc for externally consumed contracts TypeScript cannot express.
- Do not implement changes the user has deferred or marked out of scope.
- Before changing model providers, the Token Factory or Tavily runtime paths,
  `LICENSE`, or the README's setup and model claims, read `docs/integrations.md`
  and preserve its integration and licensing contracts.

## Project conventions

- Store temporary artifacts (mockups, throwaway mocks, scratch scripts, and
  debugging output) in the gitignored `.context/` directory.
- **iOS is the only product target.** Do not extend web/Android residue or gate
  work on its scripts.
- For Expo or React Native code changes, read relevant Expo SDK 58 docs at
  https://docs.expo.dev/versions/v58.0.0/ before implementation, never `/latest/`.
  Confirm APIs against installed package types; add packages with `npx expo install`.
- Commit generated Convex output under `convex/_generated/`. Run `npx convex codegen`
  after a Convex schema or backend function-signature change.
- New source filenames use kebab case; Convex modules use camel case. Keep
  framework-reserved filenames and platform-specific suffixes.
- When adding a variable to `.env.local`, document it in `.env.example` using
  a non-secret placeholder and set the same variable to the same value in the
  Conductor root repository's `.env.local`. Locate that repository via
  `CONDUCTOR_ROOT_PATH`, or the primary checkout in `git worktree list` if unset.

## Design

- **Light mode only:** Do not implement, polish, or verify dark mode. Existing dark
  token values may remain to keep the token shape stable.
- Read `DESIGN.md` before UI work and follow existing UI patterns. It holds the
  reusable design-language rules; token values live in `src/constants/theme.ts`,
  and component behavior belongs in code, tests, or an applicable local guide.
- For new or changed UI interactions and transitions, use
  `.agents/skills/expo-animation/SKILL.md` to decide what should animate and how.

## Test policy

- Add focused automated coverage for meaningful behavior changes and reproducible
  bugs. Prefer test-first for pure logic, parsing, persistence, and authorization;
  UI work may find its test boundary during implementation. Avoid tests that merely
  mirror implementation details.
- Co-locate tests with the code as `*.test.ts`/`*.test.tsx`; organize them by
  observable behavior and contracts, not implementation functions. Keep tests
  outside `src/app/`, where Expo Router treats files as routes; test rendered
  components under `src/components/`.
- Query UI by visible role, label, or text; use test IDs only when no semantic
  surface exists.
- Use the existing test tooling and scripts in `package.json`.

## Completion

- Complete the requested behavior end to end, including applicable verification.
  Fix failures caused by the change and rerun affected local checks without
  asking for approval at each step.
- Code changes: run `npx tsc --noEmit`, `npm run lint`, and relevant automated tests.
  For changed app behavior, also check iOS in light mode using `npm run ios`.
- Once required checks pass, broaden or repeat them only for new changes, failures,
  or unresolved concerns. Report checks that could not run and verification gaps.
- Documentation-only changes: check the diff, referenced paths, and commands;
  app tests are unnecessary unless behavior also changes.
- EAS deployment, submission, and store commands require an explicit request.
