# Plan 04.11: Optional account — native Sign in with Apple through Convex Auth, device linking, and collection sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/auth.ts convex/accounts.ts convex/sync.ts src/lib/account src/db/repos app.json`

## Status

- **Priority**: P2 (in scope for MVP per §3, but nothing else depends on it)
- **Effort**: L
- **Risk**: MED (Convex Auth has no built-in native Apple flow; custom credentials provider)
- **Depends on**: 04.04, 04.07 (`collections`), 03.06 (local store), 01.04, `docs/decisions/006-native-modules.md` (question 7)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.6: device identity always; an optional account (Sign in with Apple) is a sync target and nothing more — it links device identities, pulls the collection to a new phone, aggregates contributions and trust across linked devices; local-first stays: signing in on a device used anonymously merges the local collection up with no loss; signing out leaves local data; linked devices do not pool rate limits and agreement still requires distinct keys. §5.1: the user's photo stays local.

## Current state

- Convex Auth with the Anonymous provider (04.04): each device has its own auth user; `devices.by_authUserId`.
- Verified facts (2026-09-08): Convex Auth documents only the OAuth redirect flow for Apple; the escape hatch is a custom `ConvexCredentials` provider whose `authorize(credentials, ctx)` verifies the `identityToken` from `expo-apple-authentication` (`jose` `jwtVerify` against `https://appleid.apple.com/auth/keys`, issuer `https://appleid.apple.com`, audience = the app bundle id) and calls `retrieveAccount`/`createAccount` (`@convex-dev/auth/server`) with `provider: 'apple-native'`, `account: { id: sub }`. `callbacks.createOrUpdateUser` controls which user the session belongs to; returning the **current** (anonymous) user id keeps the device's auth identity stable. `expo-apple-authentication` ~57: plugin `expo-apple-authentication` + `ios.usesAppleSignIn: true`; `signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })` → `{ identityToken, user, email?, fullName? }`; `AppleAuthenticationButton`.
- `collections` rows are per device with `localId`; `accounts { appleUserId, deviceIds, createdAt }`; `devices.accountId`.

## Scope

**In scope**: `convex/auth.ts` (add the `AppleNative` credentials provider + `createOrUpdateUser` callback), `convex/accounts.ts` (`linkAccount`, `unlink`, `me`), `convex/sync.ts` (`syncCollection`), `convex/lib/appleToken.ts` (+ test), `package.json` (`jose` already; app `expo-apple-authentication`), `app.json` (plugin + `usesAppleSignIn`), `src/lib/account/{use-account,sync}.ts` (+ test), `src/db/repos/saved-works.ts` (`listUnsynced`, `markSynced`, `upsertFromRemote`), `src/components/settings/settings-screen.tsx` (sign in/out row — UI polish in 05.06), tests, `.env.example` (name `APPLE_BUNDLE_ID`).

**Out of scope**: pooling rate limits (explicitly not), photo sync (explicitly not), account deletion flows (add a one-line "delete account" that unlinks devices and deletes the account row; data export stays in 05.06).

## Steps

### Step 1: Token verification and provider

`appleToken.ts`: `verifyAppleIdentityToken(token) → { sub, email? }` using `jose` (`createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))`, `jwtVerify(token, jwks, { issuer: 'https://appleid.apple.com', audience: process.env.APPLE_BUNDLE_ID })`). `auth.ts`: `ConvexCredentials({ id: 'apple-native', authorize: async ({ identityToken }, ctx) => { const { sub, email } = await verifyAppleIdentityToken(identityToken); const existing = await retrieveAccount(ctx, { provider: 'apple-native', account: { id: sub } }); if (existing) return { userId: existing.user._id }; const created = await createAccount(ctx, { provider: 'apple-native', account: { id: sub }, profile: { email } }); return { userId: created.user._id }; } })`; `callbacks.createOrUpdateUser(ctx, args)` returns the current session's user id when one exists (`getAuthUserId(ctx)`), otherwise `args.existingUserId ?? create`. Because the device's auth user is kept, linking is our own table (Step 2).

**Verify**: `appleToken.test.ts` with `vi.mock('jose')`: valid → sub; wrong audience → throws. `npx convex dev --once` succeeds (confirm `jose` bundles in the default runtime; if not, move `authorize` to a `"use node"` action — STOP and report first).

### Step 2: Accounts and linking

`accounts.ts`: `linkAccount` (public mutation, `requireDevice`, attested via `requireAttestedWrite`) args `{ appleUserId (the verified `sub`, passed back by the client from the sign-in result), nonce, assertionBase64 }` → upsert `accounts` by `by_appleUserId`, append `deviceId` (unique), set `devices.accountId`; `unlink` (public mutation) clears both; `me` (public query) → `{ linked: boolean, deviceCount }`. Trust aggregation: `devices.trustWeight` on linking = max across the account's devices (design: aggregates trust) — never pooled limits.

**Verify**: tests: link twice is idempotent; two devices → `deviceCount 2`; unlink; limits stay per device (a rate-limited device does not affect its sibling).

### Step 3: Sync

`sync.ts`: `syncCollection` (public mutation, `requireDevice`, `limitDevice('sync')`) args `{ push: [{ localId, snapshot, venueId?, gallery?, savedAt, objectId?, artworkId?, note?, deletedAt? }], since: number }` → upsert each pushed row for this device by `(deviceId, localId)` (immutable snapshot fields are written only on insert; `note`/`deletedAt` may update); then return `{ pulled: rows }` = `collections` rows of all devices in the same account (`accounts.deviceIds`) with `_creationTime > since` or `updatedAt > since` (add `updatedAt`), excluding this device's own; plus `serverTime`. Page at 500.

**Verify**: tests: push idempotent; pull returns sibling devices' rows only when linked; snapshot immutability on re-push.

### Step 4: App side

`use-account.ts`: `signInWithApple()` → `AppleAuthentication.signInAsync` → `signIn('apple-native', { identityToken })` → `linkAccount({ appleUserId: credential.user, …signPayload })`; `signOut()` → `unlink` then Convex `signOut()` then anonymous `signIn` again (the device keeps its row); `sync.ts`: on launch/foreground and after each save: `listUnsynced()` → `syncCollection({ push, since: settings.lastSync })` → `upsertFromRemote(pulled)` (rows without local photos get `photoPath = null`), `markSynced`, store `serverTime`. Settings shows "Signed in as …" / "Sign in with Apple to sync".

**Verify**: `sync.test.ts` (jest, fake API): push/pull/mark; device: two simulators/devices linked to one Apple ID see each other's saved works (titles, no photos).

## Test plan

`convex/lib/appleToken.test.ts`, `convex/accounts.test.ts`, `convex/sync.test.ts` (convex-test), `src/lib/account/sync.test.ts` (jest).

## Done criteria

- [ ] Tests pass (≥ 12 new); tsc/lint; `npx convex dev --once`
- [ ] Manual: sign in on device A, save a work; sign in on device B → the work appears without a photo; sign out on B keeps local data
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `jose`'s remote JWKS fetch fails in the Convex default runtime — report; moving verification to Node is the fallback.
- Convex Auth's `ConvexCredentials` API differs from the shape above in the installed version — read `node_modules/@convex-dev/auth/dist/server/*.d.ts` and adapt; report the difference.

## Maintenance notes

- Account = sync target only. Reviewers should reject any change that keys rate limits or agreement by account.
