# Terms and Privacy policy pages

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the **Status** line below.
>
> **Drift check (run first)**: `git diff --stat 2a3a14c..HEAD -- convex/http.ts src/components/settings/about-section.tsx src/components/settings/settings-screen.test.tsx README.md docs/todos/release/README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

**Status: TODO** — the About screen still opens a placeholder Terms URL.

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `2a3a14c` (plus the uncommitted Graphic Index restyle on this branch), 2026-09-18

## Why this matters

The About screen has a "Terms" row that opens `https://google.com` as a placeholder and a "Privacy policy" row that opens the in-app Privacy settings section instead of a policy page. App Store Connect requires a public privacy policy URL, and the hackathon rules (`docs/hackathon/README.md`, rule 8 "Third-party terms") require the README's data-source and terms section to stay current. Shipping real, linkable Terms and Privacy pages removes a visible placeholder from the product and unblocks the release checklist's "privacy/export declarations" item.

## Current state

- `src/components/settings/about-section.tsx` — the About list. Its link constants:

  ```ts
  const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';
  // Placeholder until terms exist; tracked in docs/todos.
  const TERMS_URL = 'https://google.com';
  const FEEDBACK_URL = `${SOURCE_URL}/issues/new`;
  ```

  and the rows:

  ```tsx
  <NavigationRow label="Privacy policy" onPress={() => router.push({ pathname: '/settings-detail', params: { section: 'privacy' } })} />
  <NavigationRow label="Terms" onPress={() => { void open(TERMS_URL); }} />
  <NavigationRow label="Send feedback" onPress={() => { void open(FEEDBACK_URL); }} />
  ```

  `open(url)` wraps `Linking.openURL` and shows a footer error on failure.
- `src/components/settings/privacy-section.tsx` — exports `PRIVACY_COPY`, one paragraph describing what leaves the phone (fingerprints, label photos, consented crops, private backups without metadata, on-phone location). This is the authoritative plain-language privacy summary; reuse its wording rather than inventing a new description.
- `convex/http.ts` — the Convex HTTP router. It already serves app routes:

  ```ts
  const http = httpRouter();
  http.route({ path: '/collection-photo', method: 'POST', handler: upload });
  http.route({ path: '/collection-photo', method: 'GET', handler: download });
  http.route({ path: '/display-media', method: 'GET', handler: displayMedia });
  ```

  The app reads the router's public origin from `process.env.EXPO_PUBLIC_CONVEX_SITE_URL` (see `src/lib/account/photo-transfer.ts:9-10`, which throws when it is unset). Serving `/terms` and `/privacy` from this router gives public URLs with no new hosting.
- `README.md` — has a `## Data sources and terms` section and a `## Privacy` section. The hackathon guide says README setup and model claims must stay accurate; adding links to the new pages is additive and safe.
- `docs/todos/release/README.md` — the release checklist mentions confirming "current privacy/export declarations" before building.
- Conventions: Convex modules use camelCase filenames; new source files elsewhere use kebab-case. Tests are co-located as `*.test.ts(x)`. Convex tests use `vitest` (`npm run test:convex`) and app tests use Jest. After adding any module under `convex/`, run `npx convex codegen` and commit `convex/_generated/`. Copy in the app is sentence case with short sentences; match `PRIVACY_COPY`'s register.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` | exit 0, 0 problems |
| App tests | `npx jest src/components/settings` | all pass |
| Convex tests | `npm run test:convex` | all pass |
| Codegen | `npx convex codegen` | regenerates `convex/_generated/` |

## Scope

**In scope** (the only files you should modify):
- `shared/legal/terms.ts` (create) — the Terms of Service text as a string constant
- `shared/legal/privacy.ts` (create) — the Privacy Policy text, built from `PRIVACY_COPY`'s facts
- `convex/legal.ts` (create) — two `httpAction`s returning the pages as HTML
- `convex/legal.test.ts` (create) — route tests
- `convex/http.ts` — register `/terms` and `/privacy`
- `convex/_generated/**` — codegen output
- `src/components/settings/about-section.tsx` — point both rows at the hosted pages
- `src/components/settings/settings-screen.test.tsx` — assert the rows open the hosted URLs
- `README.md` — add the two URLs under `## Data sources and terms` and `## Privacy`
- `docs/todos/release/README.md` — record the URLs for App Store Connect

**Out of scope** (do NOT touch):
- `LICENSE` and the README's setup, model, and license claims (hackathon eligibility).
- `src/components/settings/privacy-section.tsx` — keep the in-app Privacy settings and its copy; the Settings "Privacy" row still opens it.
- Any legal review. Mark both pages "Draft — review before public release" in their headings; do not remove that marker.

## Git workflow

- Branch: `advisor/001-terms-and-privacy-pages`
- Conventional commits as in `git log`, for example `feat(app): serve terms and privacy pages from the convex site`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the page text

Create `shared/legal/terms.ts` exporting `TERMS_TITLE = 'Terms of Service'` and `TERMS_SECTIONS: { heading: string; body: string }[]` covering: acceptance, the service (a personal art journal with optional sharing), your content and ownership (you own your photos and notes; sharing publishes only what you select), acceptable use (no unlawful content, respect museum photo rules), third-party data sources (Wikidata, museum sites, Tavily, NVIDIA/Nebius models as listed in the README), disclaimers, termination, contact. Keep each body under 120 words. Add the line `Draft — review before public release.` as the first section body.

Create `shared/legal/privacy.ts` exporting `PRIVACY_TITLE` and `PRIVACY_SECTIONS` with the same shape. Derive the facts from `PRIVACY_COPY` in `src/components/settings/privacy-section.tsx`; add sections for account data (Apple sign-in identifier, email if shared), sharing (public wall, shared visits), retention and deletion (removing a work removes its cloud copy), and contact. Keep the same draft marker.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Serve the pages from the Convex router

Create `convex/legal.ts`:

```ts
import { httpAction } from './_generated/server';
import { TERMS_SECTIONS, TERMS_TITLE } from '../shared/legal/terms';
import { PRIVACY_SECTIONS, PRIVACY_TITLE } from '../shared/legal/privacy';

function page(title: string, sections: { heading: string; body: string }[]): Response {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Artlog</title></head><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #111; background: #FCFCF9;"><h1>${escape(title)}</h1>${sections.map((section) => `<h2>${escape(section.heading)}</h2><p>${escape(section.body)}</p>`).join('')}</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

export const terms = httpAction(async () => page(TERMS_TITLE, TERMS_SECTIONS));
export const privacy = httpAction(async () => page(PRIVACY_TITLE, PRIVACY_SECTIONS));
```

In `convex/http.ts`, import `{ privacy, terms } from './legal'` and add:

```ts
http.route({ path: '/terms', method: 'GET', handler: terms });
http.route({ path: '/privacy', method: 'GET', handler: privacy });
```

Run `npx convex codegen`.

**Verify**: `npx tsc --noEmit` → exit 0; `git status --short convex/_generated` shows the regenerated files.

### Step 3: Test the routes

Create `convex/legal.test.ts` with `vitest` and `convex-test` (model after any existing `convex/*.test.ts` that builds `convexTest(schema, modules)` and calls `t.fetch('/path')`). Cover: `/terms` returns 200 with `text/html` and contains `Terms of Service`; `/privacy` returns 200 and contains `Privacy Policy`; both contain `Draft — review before public release`; no `<` from section text leaks unescaped (include a section body with `<b>` in a test-only fixture only if the page helper is exported; otherwise assert the real text renders).

**Verify**: `npm run test:convex` → all pass, including the new file.

### Step 4: Point About at the hosted pages

In `src/components/settings/about-section.tsx`:
- Replace the `TERMS_URL` placeholder and its comment with:

  ```ts
  const SITE_URL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  const TERMS_URL = `${SITE_URL}/terms`;
  const PRIVACY_URL = `${SITE_URL}/privacy`;
  ```

- Change the "Privacy policy" row to `onPress={() => { void open(PRIVACY_URL); }}`. Leave the Settings screen's "Privacy" row (in `settings-screen.tsx`) pointing at the in-app section; it is a different row.

In `src/components/settings/settings-screen.test.tsx`, in the test named `keeps privacy and About details accessible`, mock `expo-linking` (`jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => {}) }))`), set `process.env.EXPO_PUBLIC_CONVEX_SITE_URL = 'https://test.convex.site'` in `beforeEach`, press the "Terms" and "Privacy policy" buttons, and assert `openURL` was called with `https://test.convex.site/terms` and `https://test.convex.site/privacy`.

**Verify**: `npx jest src/components/settings` → all pass; `npm run lint` → 0 problems.

### Step 5: Record the URLs

- `README.md`: under `## Data sources and terms`, add one line linking the hosted Terms page; under `## Privacy`, add one line linking the hosted Privacy Policy. Use the production site origin from `docs/operations/production.md` (the `.convex.site` origin that matches the production deployment listed there); do not paste any deploy key or token.
- `docs/todos/release/README.md`: in the EAS production-environment task, add "Privacy policy URL for App Store Connect: `<production site origin>/privacy`."

**Verify**: `git diff README.md docs/todos/release/README.md` shows only added lines in those two sections.

## Test plan

- `convex/legal.test.ts`: the two routes, content type, draft marker, escaping.
- `settings-screen.test.tsx`: Terms and Privacy policy rows open the site URLs (happy path) and the footer error appears when `openURL` rejects.
- Verification: `npm run test:convex` and `npx jest src/components/settings` → all pass.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test:convex` and `npx jest src/components/settings` pass, including the new tests
- [ ] `grep -rn "google.com" src/ convex/ shared/` returns no matches
- [ ] `convex/_generated/api.d.ts` includes `legal`
- [ ] Both pages contain the draft marker (checked by the route tests)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] The **Status** line at the top of this file updated

## STOP conditions

- The About rows or `convex/http.ts` no longer match the excerpts above.
- `EXPO_PUBLIC_CONVEX_SITE_URL` is not set in `.env.example` or the app cannot read it at runtime (the Terms row would open `undefined/terms`).
- `convex-test` cannot exercise `http.ts` routes in this repo (no existing `t.fetch` pattern) — report instead of adding a new test harness.
- The operator asks for legally reviewed text; this plan only ships a clearly marked draft.

## Maintenance notes

- Any change to what the app sends off-device (new model provider, new data source, cloud backups) must update `shared/legal/privacy.ts` and `PRIVACY_COPY` together; a reviewer should diff both.
- The pages are cached for an hour by `Cache-Control`; a text change is live after that without an app release.
- Deferred: an in-app reader for the pages (offline) and localization. Both need the hosted pages to exist first.
