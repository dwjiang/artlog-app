# Plan 04.04: Device identity (anonymous sessions + App Attest), rate limits and kill switches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/ src/app/_layout.tsx src/lib package.json .env.example`
> Compare `convex/schema.ts` against plan 01.03's table list before editing; STOP on mismatch.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (auth misconfiguration silently signs everyone out; App Attest verification is cryptographic)
- **Depends on**: `docs/plans/01-foundation/03-convex-project-and-schema.md`
- **Category**: security / feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Every request from the phone goes through a Convex function with "one auth model, one rate limiter" (design §5.2). Sessions are anonymous by default and never require an account (§3, §5.6). Anything that touches shared state — contributions, rejections, venue confirmations, queue bumps — must be attributed to an **App Attest** device identity that Apple binds to one install on one physical iPhone (§5.6, §8), and rate-limited per device with a global daily spend cap and kill switches on the label flow and "Right now" (§8). This plan builds that foundation; `identify` (04.03) and every write path after it call into it.

Design excerpts:

- §5.6: "Convex Auth anonymous sessions carry the app's reads and writes; a visitor opens the app and scans immediately. Anything that touches shared state… is attributed to the device's App Attest key… A reinstall mints a new key."
- §8: "Rate limits via the Convex rate-limiter component, keyed to the device: contributions per device per hour, rejections per device per work per day, venue confirmations and queue bumps per device per day, VL, Nano and Tavily calls per device, and a global daily spend cap with a kill switch on the label flow and on 'Right now.'" "A simple trust weight applies to agreement: new devices count fractionally."
- §8 hackathon build list: "App Attest for sharing, rate limits, provenance with cascade revert…" — trust weights are second priority; this plan only stores `trustWeight` (default 0.5) and does not compute it.

## Current state

- `convex/schema.ts` (plan 01.03) has `devices { appAttestKeyId: string, authUserId?: string, firstSeenAt, trustWeight, banned, accountId? }` with indexes `by_keyId`, `by_authUserId`, `by_accountId`. No auth tables, no `http.ts`, no `auth.config.ts`, no `convex.config.ts` components.
- `src/app/_layout.tsx` wraps the root Stack in `<ConvexProvider client={convex}>` where `convex` comes from `src/lib/convex-client.ts`.
- Verified platform facts (Convex docs, `@convex-dev/auth` 0.0.95, `@convex-dev/rate-limiter` 0.3.2):
  - Convex Auth for React Native: `ConvexAuthProvider` from `@convex-dev/auth/react` with a `storage` adapter backed by `expo-secure-store` (`getItem: SecureStore.getItemAsync`, `setItem: SecureStore.setItemAsync`, `removeItem: SecureStore.deleteItemAsync`); `unsavedChangesWarning: false` on the client is mandatory in RN.
  - Anonymous provider: `import { Anonymous } from "@convex-dev/auth/providers/Anonymous"`; client `signIn("anonymous")`; server `getAuthUserId(ctx)` from `@convex-dev/auth/server`.
  - `auth.config.ts` must exist and be correct or the app is silently always signed out. JWT keys must be generated **headlessly** with `jose` (the interactive `npx @convex-dev/auth` wizard hangs without a TTY) and set with `npx convex env set "JWT_PRIVATE_KEY=…"` (NAME=VALUE form; the value starts with `-----BEGIN`), plus `JWKS` and `SITE_URL`. See the repo skill `.agents/skills/convex-auth/SKILL.md` for the exact `node -e` one-liner.
  - Rate limiter: `app.use(rateLimiter)` in `convex/convex.config.ts`; `new RateLimiter(components.rateLimiter, { name: { kind: "token bucket" | "fixed window", rate, period, capacity? } })`; `await limiter.limit(ctx, name, { key, throws: true })` works in **mutations and actions**; `check()` in queries; test helper `import rateLimiter from "@convex-dev/rate-limiter/test"; rateLimiter.register(t)`.
  - `process.env.X` is readable in every function type; secrets are set with `npx convex env set`.
  - Convex default (V8) runtime has WebCrypto (`crypto.subtle`) and 64 MiB memory; `"use node"` actions get Node 20 and 512 MiB.
- App Attest facts (Apple "Establishing your app's integrity" / "Validating apps that connect to your server"; Expo's `@expo/app-integrity` ~57.0.1 wraps the same calls and takes a **string challenge**, hashing it with SHA-256 natively, and returns attestations/assertions **base64-encoded** — so this plan's functions accept base64 strings): `DCAppAttestService.isSupported` is **false on the Simulator and on macOS**; `generateKey()` → key id; `attestKey(keyId, clientDataHash)` → CBOR attestation object (`fmt: "apple-appattest"`, `attStmt.x5c` chain to Apple's App Attest root CA, `authData` with RP ID hash = SHA-256 of `TEAMID.bundleId`, counter, credential id = key id); `generateAssertion(keyId, clientDataHash)` → CBOR `{ signature, authenticatorData }`, signature is ECDSA-P256 over `authenticatorData ‖ SHA-256(clientData)`, counter must increase. Attestation verification needs X.509 chain validation (Node runtime); assertion verification needs only ECDSA over the stored public key (WebCrypto, default runtime).
- Conventions: object-form functions with `args`+`returns`; `internal*` by default; secrets never in code; tests co-located, vitest + convex-test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install server deps | `npm install @convex-dev/auth @auth/core@0.41.1 @convex-dev/rate-limiter jose cbor-x` | exit 0 |
| Install app deps | `npx expo install expo-secure-store` | exit 0 |
| Node-runtime attestation lib | `npm install node-app-attest` | exit 0 (see STOP conditions) |
| Set env var | `npx convex env set NAME value` / `npx convex env set "NAME=value"` | "Successfully set" |
| Push | `npx convex dev --once` | success |
| Typecheck / lint | `npx tsc --noEmit` / `npm run lint` | exit 0 |
| Tests | `npm run test:convex` | all pass |
| App | `npm run ios` | Settings shows a device id |

## Suggested executor toolkit

- Repo skills: `convex-auth` (headless key generation — follow it exactly), `convex-env`, `convex-expert`, `convex-authz` (run its scan at the end).
- Apple docs: https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
- `@convex-dev/auth` docs: https://labs.convex.dev/auth (setup → React Native; config → Anonymous).

## Scope

**In scope**:

- `package.json`/lockfile (deps above)
- `convex/convex.config.ts` (add rate limiter), `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/schema.ts` (add `...authTables`; extend `devices`; add `attestChallenges`, `dailySpend`), `convex/devices.ts`, `convex/appAttestNode.ts` (`"use node"`), `convex/lib/auth.ts`, `convex/lib/rateLimits.ts`, `convex/lib/flags.ts`, `convex/lib/appAttest.ts`, tests for each
- `src/lib/convex-client.ts`, `src/app/_layout.tsx` (swap to `ConvexAuthProvider`), `src/lib/device-identity.ts` (create), `src/components/settings/settings-screen.tsx` (show device id line)
- `.env.example` (document server env var **names** only)

**Out of scope** (do NOT touch):

- The phone-side App Attest integration (plan 03.07, which uses Expo's official `@expo/app-integrity` package and the App Attest entitlement) — this plan's phone side calls a TypeScript interface `getAppAttest()` that returns `null` until 03.07 lands; write the interface file `src/lib/app-attest.ts` with a stub that returns `null` and a comment pointing at plan 03.07.
- Sign in with Apple / accounts (plan 04.11).
- Any rate-limit *consumer* other than `registerDevice` (04.03+ add their calls).
- Trust-weight computation (design §8 "second priority").

## Git workflow

- Current workspace branch; do not push unless told.
- Commits: `feat(convex): add anonymous auth and device registry`, `feat(convex): add app attest verification`, `feat(convex): add rate limits and kill switches`, `feat(app): sign in anonymously and register device`.

## Steps

### Step 1: Convex Auth with the Anonymous provider

1. `convex/convex.config.ts`: `defineApp()`, `app.use(rateLimiter)` (import from `@convex-dev/rate-limiter/convex.config.js`), export default.
2. `convex/schema.ts`: spread `authTables` from `@convex-dev/auth/server` into `defineSchema({ ...authTables, …existing })`. Extend `devices` with `attestedAt?: number`, `attestPublicKey?: string` (base64 SPKI), `attestCounter: number`, `platform: v.union(v.literal("ios"), v.literal("simulator"))`. Add tables:
   - `attestChallenges { deviceId?: id(devices), authUserId: string, nonce: string, purpose: 'attest' | 'assert', createdAt: number, usedAt?: number }` index `by_nonce ["nonce"]`, `by_authUserId ["authUserId"]`.
   - `dailySpend { day: string (YYYY-MM-DD UTC), tokenFactoryCalls: number, tavilyCredits: number, updatedAt: number }` index `by_day ["day"]`.
3. `convex/auth.ts`: `export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers: [Anonymous] })`.
4. `convex/auth.config.ts`: `{ providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }] }`.
5. `convex/http.ts`: `httpRouter()`, `auth.addHttpRoutes(http)`, export default.
6. Generate keys headlessly with the `jose` one-liner from the `convex-auth` skill; set `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (use `https://artlog.app` as a placeholder site URL — Anonymous sign-in does not redirect) with `npx convex env set "NAME=value"`; delete the temporary key file. Add to `.env.example` a comment block listing server-side env var names (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `APP_ATTEST_REQUIRED`, `APP_ATTEST_APP_ID`, `SUPPORTED_MODEL_VERSIONS`, `FLAG_LABEL_FLOW`, `FLAG_RIGHT_NOW`, `DAILY_TOKEN_FACTORY_CALL_CAP`, `DAILY_TAVILY_CREDIT_CAP`) with the note "set with `npx convex env set`, never in this file".

**Verify**: `npx convex dev --once` → success; `npx convex env list` → the three auth vars present; `npx tsc --noEmit` → 0.

### Step 2: Device registry and `requireDevice`

`convex/lib/auth.ts`:

```ts
export async function requireAuthUserId(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<string>   // getAuthUserId or throw ConvexError({ code: 'unauthenticated' })
export async function requireDevice(ctx: QueryCtx | MutationCtx): Promise<Doc<'devices'>>          // by_authUserId or throw ConvexError({ code: 'device_not_registered' }); throws { code: 'device_banned' } when banned
export async function requireDeviceFromAction(ctx: ActionCtx): Promise<Doc<'devices'>>           // ctx.runQuery(internal.devices.getForCaller)
```

`convex/devices.ts`:

- `registerDevice` (public mutation) args `{ platform, appAttestKeyId?: string }` returns `{ deviceId, attested: boolean, attestRequired: boolean }`: upsert the device for `getAuthUserId(ctx)`; `firstSeenAt` on insert; `trustWeight: 0.5`; `attestCounter: 0`; `attestRequired = process.env.APP_ATTEST_REQUIRED === 'true'`. Rate-limit with `registerDevice` (fixed window 10/hour per auth user). Idempotent.
- `getForCaller` (internal query) → device doc for the caller or null.
- `me` (public query) → `{ deviceId, attested, trustWeight }` for the Settings screen.

**Verify**: `npx vitest run convex/devices` → registering twice returns the same id; unauthenticated call throws `unauthenticated`; banned device throws `device_banned`.

### Step 3: App Attest challenge, attestation (Node), assertion (default runtime)

`convex/lib/appAttest.ts` (default runtime, pure): `decodeAssertion(base64: string) → { signature: Uint8Array, authenticatorData: Uint8Array }` (decode base64 with `atob`, then CBOR) using `cbor-x` (verify it runs in the edge/V8 runtime; if not, hand-write the 2-key CBOR map decoder — the structure is fixed); `parseAuthenticatorData(authData) → { rpIdHash, flags, counter }`; `verifyAssertion({ publicKeySpkiBase64, clientData, assertion, expectedRpIdHash, previousCounter }) → { ok: boolean; counter: number; reason?: string }` using `crypto.subtle.importKey('spki', …, { name: 'ECDSA', namedCurve: 'P-256' })` and `verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), authenticatorData ‖ sha256(clientData))` (App Attest signatures are DER-encoded; convert to raw r‖s).

`convex/appAttestNode.ts` (`"use node"`, actions only): `verifyAttestation` internal action args `{ attestationBase64: string, keyId: string, clientDataHash: bytes }` returns `{ ok, publicKeySpkiBase64?, counter?, reason? }` using `node-app-attest`'s `verifyAttestation({ attestation, challenge, keyId, appId, allowDevelopmentEnvironment })` (or, if that package is unavailable — see STOP — `@peculiar/x509` + `cbor-x` following Apple's nine verification steps). `appId = process.env.APP_ATTEST_APP_ID` (`TEAMID.bundleId`). Accept the development environment only when `process.env.APP_ATTEST_ALLOW_DEV === 'true'`.

`convex/devices.ts` additions:

- `createChallenge` (public mutation) args `{ purpose }` → `{ nonce }` (16 random bytes, base64url; stored with `authUserId`, `createdAt`); rate-limited `attestChallenge` 30/hour.
- `attestDevice` (public action) args `{ keyId, attestationBase64: string, nonce }`: looks up an unused challenge < 5 min old for the caller; `clientDataHash = sha256(utf8(nonce))` (exactly what `@expo/app-integrity` hashes on the phone when given `nonce` as the challenge string); runs `internal.appAttestNode.verifyAttestation`; on success `internal.devices.markAttested({ deviceId, keyId, publicKey, counter })` (sets `appAttestKeyId`, `attestPublicKey`, `attestCounter`, `attestedAt`, marks challenge used).
- `requireAttestedWrite(ctx: MutationCtx, args: { nonce: string; assertionBase64: string; payload: string })`: helper for later plans; verifies challenge (purpose `assert`, unused, < 5 min), `clientData = nonce + "." + payload` (the phone passes this exact string as the challenge to `generateAssertionAsync`), `verifyAssertion` against the device's stored key; on success bumps `attestCounter`, marks challenge used, returns the device. When `APP_ATTEST_REQUIRED !== 'true'` **and** `device.platform === 'simulator'`, skip verification but still consume the challenge (so dev builds on the Simulator work; production sets the flag).

**Verify**: `npx vitest run convex/lib/appAttest` → with a test P-256 key generated in the test via WebCrypto, a signed assertion over `authData ‖ sha256(clientData)` verifies; a modified counter/payload fails; DER→raw conversion tested on a known vector. `npx vitest run convex/devices` → challenge single-use and expiry; simulator bypass only when the flag is off.

### Step 4: Rate limits, spend caps and flags

`convex/lib/rateLimits.ts`:

```ts
export const limiter = new RateLimiter(components.rateLimiter, {
  registerDevice:  { kind: 'fixed window', rate: 10,  period: HOUR },
  attestChallenge: { kind: 'fixed window', rate: 30,  period: HOUR },
  identify:        { kind: 'token bucket', rate: 60,  period: MINUTE, capacity: 20 },
  contribute:      { kind: 'fixed window', rate: 20,  period: HOUR },
  rejectPerWork:   { kind: 'fixed window', rate: 3,   period: DAY },      // key `${deviceId}:${objectId}`
  venueConfirm:    { kind: 'fixed window', rate: 5,   period: DAY },
  queueBump:       { kind: 'fixed window', rate: 3,   period: DAY },
  labelRead:       { kind: 'fixed window', rate: 30,  period: HOUR },
  docent:          { kind: 'fixed window', rate: 60,  period: HOUR },
  rightNow:        { kind: 'fixed window', rate: 60,  period: HOUR },
  sync:            { kind: 'token bucket', rate: 30,  period: MINUTE, capacity: 10 },
});
export async function limitDevice(ctx, name, deviceId, extraKey?)   // throws ConvexError({ code: 'rate_limited', retryAfter })
```

`convex/lib/flags.ts`: `isEnabled(name: 'labelFlow' | 'rightNow')` reads `FLAG_LABEL_FLOW` / `FLAG_RIGHT_NOW` (`'off'` disables; default on). `convex/lib/spend.ts`: `recordSpend(ctx, { tokenFactoryCalls?, tavilyCredits? })` (internal mutation, upsert by UTC day) and `assertUnderCap(ctx, kind)` reading `DAILY_TOKEN_FACTORY_CALL_CAP` / `DAILY_TAVILY_CREDIT_CAP` (default 2000 / 300); throws `ConvexError({ code: 'spend_cap' })`.

**Verify**: `npx vitest run convex/lib/rateLimits convex/lib/spend convex/lib/flags` → the 4th `rejectPerWork` call in a day throws `rate_limited` while a different object key passes; spend cap trips at the configured value; flags default on and honor `off`.

### Step 5: App side — anonymous sign-in and device registration

- `src/lib/convex-client.ts`: keep `ConvexReactClient`; `src/app/_layout.tsx`: replace `ConvexProvider` with `ConvexAuthProvider client={convex} storage={secureStorage}` (adapter as above).
- `src/lib/app-attest.ts`: `export type AppAttest = { isSupported(): boolean; generateKey(): Promise<string>; attestKey(keyId: string, challenge: string): Promise<string>; generateAssertion(keyId: string, challenge: string): Promise<string> }; export function getAppAttest(): AppAttest | null { return null; } // Implemented with @expo/app-integrity in docs/plans/03-on-device/07-app-attest-module.md` (attestation/assertion results are base64 strings).
- `src/lib/device-identity.ts`: `useDeviceIdentity()` hook: when `useConvexAuth().isAuthenticated` is false and not loading → `signIn('anonymous')`; once authenticated → `registerDevice({ platform: Device.isDevice ? 'ios' : 'simulator' })` once per app launch (guard with a module-level promise); if `attestRequired && !attested && getAppAttest()?.isSupported()` → `createChallenge({ purpose: 'attest' })` → `generateKey()` → `attestKey(keyId, nonce)` → `attestDevice({ keyId, attestationBase64, nonce })`. Persist the key id in SecureStore under `appAttestKeyId`.
- Settings screen: show `Device: <deviceId> · attested: yes/no`.

**Verify**: `npm run ios` → Settings shows a device id within a few seconds of launch; killing and relaunching the app keeps the same id (SecureStore session); `npx convex data devices` shows one row with `platform: "simulator"`.

### Step 6: Authorization scan

Run the deterministic scan from the repo skill `convex-authz` over `convex/**/*.ts`: no public function may take `deviceId`/`authUserId` as an argument; every public function calls `requireDevice`/`requireAuthUserId`.

**Verify**: `grep -rn "deviceId: v.id" convex/*.ts | grep -v internal` → no matches in public functions; `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:convex` → all pass.

## Test plan

- `convex/devices.test.ts`: register idempotency; unauthenticated; banned; challenge lifecycle; simulator bypass gated by env (use `vi.stubEnv`).
- `convex/lib/appAttest.test.ts`: assertion verify/deny cases; DER→raw.
- `convex/lib/rateLimits.test.ts` (register the component with `rateLimiter.register(t)`), `spend.test.ts`, `flags.test.ts`.
- `appAttestNode.ts` (Node) is covered only by a test that feeds a syntactically invalid attestation and expects `{ ok: false }`; real attestations can only be produced on a physical device — plan 03.07 adds a manual device check.

## Done criteria

- [ ] `npx convex dev --once` succeeds; `npx convex env list` shows `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:convex` all exit 0; ≥ 15 new tests
- [ ] `grep -n "authTables" convex/schema.ts` → 1; `grep -n "attestChallenges\|dailySpend" convex/schema.ts` → 2
- [ ] Simulator launch registers a device row; relaunch reuses it
- [ ] `.env.example` lists the server env var names with the "set with npx convex env set" note and contains no values
- [ ] No files outside the in-scope list are modified; `docs/plans/README.md` updated

## STOP conditions

- `npm install node-app-attest` fails or the package does not export an attestation verifier — report; the fallback (`@peculiar/x509` + `cbor-x` implementing Apple's steps) is a scope decision for the operator.
- `cbor-x` fails to load in the vitest edge-runtime or in `npx convex dev --once` bundling — write the minimal fixed-shape CBOR decoder instead (assertion = map of 2 byte strings) and report the deviation.
- `@convex-dev/auth` sign-in never becomes authenticated in the app after one round of checking `auth.config.ts` and the three env vars — report with `npx convex logs` output.
- The App Attest verification contract requires `TEAMID` and the bundle id, which come from plan 01.04; if `APP_ATTEST_APP_ID` cannot be set yet, leave verification untestable but wired, and say so.

## Maintenance notes

- Every shared-state mutation added later (`contribute`, `rejectMatch`, `confirmPoiVenue`, `startVisit`'s queue bump, `linkAccount`) must call `requireAttestedWrite` and a named rate limit. Reviewers should grep for public mutations that touch `contributions`, `feedback`, `museums`, `placementProposals` without it.
- `APP_ATTEST_REQUIRED` must be `true` on the production deployment before TestFlight external testing (plan 06.01 checks it).
- Rate-limit numbers are starting points; tune in `rateLimits.ts` only (never per call site).
- Deferred: trust weights (§8), account-linked device aggregation (04.11), CAPTCHA for anonymous sign-up (Convex Auth's own recommendation; App Attest covers it here).
