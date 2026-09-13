# Plan 06.01: Production hardening, the first TestFlight build, external testing, and the public link

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`. **Every `eas build`/`eas submit` here spends
> quota and touches App Store Connect: run them only when the operator has
> explicitly asked for this plan to be executed (AGENTS.md rule).**
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- eas.json app.json docs/runbooks convex/devices.ts`

## Status

- **Priority**: P1 (submit early — §11: "submit the first external build early so Beta App Review clears before museum testing")
- **Effort**: M (plus waiting on Apple)
- **Risk**: MED (irreversible-ish: store records, review)
- **Depends on**: 01.04, 03.03 (model asset in the build), 03.07, 04.04; the app should have at least 05.01–05.02 for a meaningful build
- **Category**: release
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Judging runs through a TestFlight public link (§2). TestFlight external testing needs Beta App Review for the first build and builds expire after 90 days (§11). Production must have App Attest required, flags and caps set, the right model version list, and the ~90 MB model inside a < 200 MB app (§5.1).

## Current state

- `eas.json` profiles (01.04); `ios.bundleIdentifier`, usage strings, entitlement (01.04); model fetched by `eas-build-pre-install` (03.03). Updated 2026-09-13: production `admired-goldfinch-660` already existed empty. Backend/schema with v2 and all 19 environment settings are now deployed; the 10,000-painting corpus import, full byte/reference audit, and authenticated recognition checks passed. See [the release runbook](../../runbooks/release.md).
- Convex env var names (04.04+): `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `APP_ATTEST_REQUIRED`, `APP_ATTEST_APP_ID`, `APP_ATTEST_ALLOW_DEV`, `SUPPORTED_MODEL_VERSIONS`, `FLAG_LABEL_FLOW`, `FLAG_MUSEUM_SEARCH`, `FLAG_RIGHT_NOW`, `DAILY_TOKEN_FACTORY_CALL_CAP`, `DAILY_TAVILY_CREDIT_CAP`, `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `LABEL_VL_MODEL`, `DOCENT_MODEL`, `FACT_SHEET_MODEL`, `MODERATION_MODEL`, `APPLE_BUNDLE_ID`.
- EAS facts: free tier 15 iOS builds/month; `eas build --platform ios --profile production`; `eas submit --platform ios --latest` (needs `ascAppId`/Apple credentials in `eas.json` `submit.production.ios` or an ASC API key); the 200 MB figure is the cellular-download prompt threshold, not a hard limit.

## Scope

**In scope**: `docs/runbooks/release.md` (create), `eas.json` (`submit.production.ios`), `app.json` (`version`, `ios.buildNumber` handled by `autoIncrement`; `privacy` manifest entries if required by Xcode 26), `convex/devices.ts` (remove `assertSmoke`), `.env.example` (prod URL note), `README.md` (TestFlight link placeholder → real link).

**Out of scope**: App Store submission (not needed for judging), marketing metadata beyond what TestFlight requires.

## Steps

### Step 1: Production Convex deployment and env

The backend portion was completed on 2026-09-13: production code/schema, independent authentication keys, all environment settings, the museum directory, and the verified 10,000-painting package. The import method, checks, and explicit deployment-target commands are in [the release runbook](../../runbooks/release.md). Keep `FLAG_RIGHT_NOW=off` until decision 007's acceptance review is complete. Production build configuration remains pending: set its EAS `EXPO_PUBLIC_CONVEX_URL` to `https://admired-goldfinch-660.convex.cloud` and configure the model asset settings before the requested TestFlight build.

**Verify**: with the runbook's target file, `npx convex env list --prod --env-file .context/production-target.env` shows every name and `npx convex run health:ping --prod --env-file .context/production-target.env` succeeds. Backend checks passed; the installed production iPhone build must still show "connected".

### Step 2: Remove dev-only surface

Delete `devices.assertSmoke` (03.07); ensure `dev-tools.tsx` renders only under `__DEV__`; confirm `FLAG_*` defaults.

**Verify**: `grep -rn "assertSmoke" convex src` → none; `npm run test:convex` passes.

### Step 3: Build and size check (operator-approved)

`eas build --platform ios --profile production` → download the `.ipa`; `unzip -l app.ipa | tail -1` and note the uncompressed `Payload/*.app` size; must be < 200 MB (record the number in the runbook). If over, STOP.

**Verify**: build succeeds; size recorded.

### Step 4: TestFlight

`eas submit --platform ios --latest`; in App Store Connect: add the internal group, then create an external group with a **public link**, fill the Beta App Review information (contact, notes: "Point the camera at a painting; try the label flow on any wall label"), export compliance already answered by `ITSAppUsesNonExemptEncryption: false`; submit for Beta App Review.

**Verify**: internal testers can install; external review submitted; the public link recorded in `README.md` once approved.

### Step 5: Runbook

`docs/runbooks/release.md`: the checklist above, the 90-day expiry reminder (ship a fresh build before day 80), the flag/cap toggles for museum testing vs. release, how to roll back (`npx convex deploy` of the previous commit; TestFlight build selection), and the incident contacts.

**Verify**: runbook reviewed by the operator.

## Test plan

No automated tests; the verification is the installed TestFlight build identifying a painting against prod.

## Done criteria

- [x] Prod deployment configured with every env var; `APP_ATTEST_REQUIRED=true`
- [ ] Production build < 200 MB; TestFlight internal install works; external review submitted; public link (when approved) in README
- [x] `docs/runbooks/release.md` exists
- [x] `docs/plans/README.md` updated

## STOP conditions

- The operator has not explicitly approved spending EAS builds/submitting — do everything up to Step 3 and stop.
- Apple Developer enrollment is not complete — stop before Step 3.
- App size ≥ 200 MB — report; options are 4-bit palettization (00.01 data) or a downloadable model (§3 deferred).

## Maintenance notes

- TestFlight builds expire after 90 days; put a calendar reminder in the runbook.
