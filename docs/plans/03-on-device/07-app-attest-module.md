# Plan 03.07: App Attest on the phone with `@expo/app-integrity`, wired into device registration and attested writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/lib/app-attest.ts src/lib/device-identity.ts src/lib/attested-write.ts app.json package.json`

## Status

- **Priority**: P1 (required before any shared-state write is enabled in production)
- **Effort**: S–M
- **Risk**: LOW (official Expo package; needs a physical device)
- **Depends on**: 04.04 (server side), 01.04 (entitlement), `docs/decisions/006-native-modules.md`
- **Category**: security
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.6/§8: every contribution, rejection, venue confirmation and queue bump is attributed to the device's App Attest key, which Apple binds to one install on one physical iPhone; this is what defeats scripted flooding. The server side (plan 04.04) verifies attestations and assertions; this plan produces them.

## Current state

- `src/lib/app-attest.ts` (04.04) is a stub returning `null`; `src/lib/device-identity.ts` runs the attest flow only when `getAppAttest()?.isSupported()`; server functions: `createChallenge({ purpose })`, `attestDevice({ keyId, attestationBase64, nonce })`, and `requireAttestedWrite({ nonce, assertionBase64, payload })` expecting the assertion challenge string to be exactly `nonce + "." + payload`.
- `app.json` has the entitlement `com.apple.developer.devicecheck.appattest-environment: production` (01.04). Dev deployment env: `APP_ATTEST_ALLOW_DEV=true`, `APP_ATTEST_APP_ID=<TEAMID>.app.artlog.ios`, `APP_ATTEST_REQUIRED` (false on dev, true on prod).
- Verified `@expo/app-integrity` ~57.0.1: `AppIntegrity.isSupported: boolean`, `generateKeyAsync(): Promise<string>`, `attestKeyAsync(keyId, challenge): Promise<string>` (SHA-256 of the UTF-8 challenge computed natively; base64 attestation), `generateAssertionAsync(keyId, challenge): Promise<string>` (base64); Simulator unsupported; add the App Attest capability (entitlement) — no config plugin.

## Scope

**In scope**: `package.json`, `src/lib/app-attest.ts` (real implementation), `src/lib/attested-write.ts` (+ test), `src/lib/device-identity.ts` (persist key id; re-attest when the server reports `attested: false`), `src/components/settings/settings-screen.tsx` (attested yes/no already shown by 04.04).

**Out of scope**: server verification (04.04), the consumers (`contribute` etc. — 04.07/04.05/05.03 call `signPayload`).

## Steps

### Step 1: Implement the interface

`npx expo install @expo/app-integrity`. `app-attest.ts`: `getAppAttest()` returns `null` when `!AppIntegrity.isSupported`, else `{ isSupported: () => true, generateKey: AppIntegrity.generateKeyAsync, attestKey: AppIntegrity.attestKeyAsync, generateAssertion: AppIntegrity.generateAssertionAsync }`.

**Verify**: `npx tsc --noEmit` → 0; on the Simulator `getAppAttest()` is `null`.

### Step 2: Key lifecycle

In `device-identity.ts`: store `appAttestKeyId` in SecureStore; if the server's `registerDevice` reply says `attested: false` and the device is supported → run the attest flow (challenge → `generateKey` (only when no key is stored) → `attestKey(keyId, nonce)` → `attestDevice`); on `attestDevice` failure with code `key_mismatch`/`invalid_attestation`, delete the stored key and retry once with a new key.

**Verify**: device: Convex `devices` row gets `attestedAt` after first launch; relaunch does not re-attest.

### Step 3: Attested writes helper

`attested-write.ts`: `signPayload(payload: object) → Promise<{ nonce: string; assertionBase64: string; payloadJson: string } | null>`: canonical JSON (`JSON.stringify` with sorted keys — implement `stableStringify`), `createChallenge({ purpose: 'assert' })` → `generateAssertion(keyId, nonce + '.' + payloadJson)`; returns `null` when App Attest is unsupported (the server decides whether that is acceptable via `APP_ATTEST_REQUIRED`). Consumers spread `{ nonce, assertionBase64 }` into their mutation args and send `payloadJson` fields as the actual args (the server re-canonicalizes and compares).

**Verify**: `attested-write.test.ts` (jest, mocked module): stable stringify ordering; challenge string composition; null on unsupported.

### Step 4: End-to-end on a device against the dev deployment

Call a test mutation `devices.assertSmoke({ nonce, assertionBase64, payloadJson })` (add to 04.04's `devices.ts` as an `internal`-style public mutation guarded by `__DEV__`? No — keep it public but harmless: it only verifies and returns `{ ok }`; remove it in plan 06.01) and confirm `ok: true`; a replayed assertion (same nonce) returns `ok: false`.

**Verify**: both results observed; `attestCounter` increments.

## Test plan

`attested-write.test.ts`; device checks documented in the PR (attest + assert + replay).

## Done criteria

- [ ] Device attested on first launch; assertion smoke passes; replay rejected
- [ ] Tests, tsc, lint pass; `docs/plans/README.md` updated

## STOP conditions

- `attestKeyAsync` fails with a DeviceCheck error on a real device after checking the entitlement and the `APP_ATTEST_APP_ID` value — report the error code (common: wrong Team ID).

## Maintenance notes

- The assertion challenge format (`nonce.payloadJson`) is a contract with `requireAttestedWrite`; change both together.
- Production must set `APP_ATTEST_REQUIRED=true` (plan 06.01 checklist).
