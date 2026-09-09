# Plan 01.04: Development client, iOS permissions/entitlements, and the EAS configuration

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- app.json eas.json package.json .gitignore`
> On drift in `app.json`, re-read it and merge rather than overwrite.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (local builds only; no EAS minutes are spent by this plan)
- **Depends on**: `docs/plans/01-foundation/02-app-shell.md`
- **Category**: dx / release
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Every on-device plan (`03-on-device/*`) needs native code that Expo Go cannot run: VisionCamera, a CoreML runner, OpenCV, App Attest, MapKit search. That requires a development client (design §6: "dev client; TestFlight needs one anyway"). This plan installs `expo-dev-client`, declares the iOS bundle identifier, usage strings and entitlements the later modules need, writes `eas.json` for the three build profiles, and proves a local dev build runs on the Simulator. It stops short of any cloud build: `AGENTS.md` says EAS deployment and submission commands require an explicit request, and cloud builds consume the free tier's 15 iOS builds per month.

## Current state

- `app.json` (`expo.ios` block) has only `"icon": "./assets/expo.icon"`; no `bundleIdentifier`, no `infoPlist`, no `entitlements`; `plugins: ["expo-router", ["expo-splash-screen", {...}]]`; `experiments: { typedRoutes: true, reactCompiler: true }`; `userInterfaceStyle: "light"` after plan 01.02.
- `.gitignore` ignores `/ios` and `/android` — the project uses continuous native generation (`npx expo prebuild` output is disposable).
- No `eas.json`, no `expo-dev-client`, `eas-cli` not installed.
- Verified facts (Expo SDK 57 docs, EAS docs, 2026-09-08): `expo-dev-client` ~57.0.18; `eas.json` shape below; `eas init` links the project (`extra.eas.projectId`); EAS free tier: 15 iOS builds/month, 45-minute timeout; App Attest needs the entitlement `com.apple.developer.devicecheck.appattest-environment` (`production`); VisionCamera 5 has no config plugin and needs `NSCameraUsageDescription` in `ios.infoPlist`; `expo-location` plugin option `locationWhenInUsePermission`; `expo-image-picker` plugin option `photosPermission`.
- Conductor's `run.ios` script is `npm run ios` (`expo start --ios`), which launches the installed dev client when `expo-dev-client` is present.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npx expo install expo-dev-client` | exit 0 |
| EAS CLI | `npm install -g eas-cli && eas whoami` | prints the account (operator must be logged in) |
| Link project | `eas init` | writes `extra.eas.projectId` into `app.json` |
| Prebuild | `npx expo prebuild --platform ios --clean` | creates `ios/` (gitignored) |
| Local dev build | `npx expo run:ios` | builds with Xcode and launches on the Simulator |
| Typecheck / lint | `npx tsc --noEmit` / `npm run lint` | exit 0 |

## Scope

**In scope**: `package.json`/lockfile (`expo-dev-client`), `app.json` (`ios.bundleIdentifier`, `ios.infoPlist`, `ios.entitlements`, `plugins` additions, `extra.eas.projectId`), `eas.json` (create), `.easignore` (create), `README.md` (one "Run a development build" subsection).

**Out of scope**: running `eas build`/`eas submit` (plan 06.01, on request only); installing any camera/location/OpenCV package (those plans add their own packages and plugin entries); Apple Developer enrollment (operator).

## Git workflow

- Commits: `build(config): add dev client and ios permissions`, `build(config): add eas profiles`.

## Steps

### Step 1: Dev client and iOS declarations

`npx expo install expo-dev-client`. Edit `app.json`:

```json
"ios": {
  "icon": "./assets/expo.icon",
  "bundleIdentifier": "app.artlog.ios",
  "supportsTablet": false,
  "infoPlist": {
    "NSCameraUsageDescription": "Artlog uses the camera to identify paintings and read wall labels.",
    "NSPhotoLibraryUsageDescription": "Artlog can identify paintings from photos you already took.",
    "NSLocationWhenInUseUsageDescription": "Artlog uses your location to work out which museum you are in. Coordinates never leave your phone.",
    "ITSAppUsesNonExemptEncryption": false
  },
  "entitlements": {
    "com.apple.developer.devicecheck.appattest-environment": "production"
  }
}
```

Use the bundle identifier the operator registered in App Store Connect if one exists; otherwise `app.artlog.ios` is the placeholder to register. Add `"expo-dev-client"` to `plugins`.

**Verify**: `npx expo config --type introspect | grep -n "bundleIdentifier\|NSCameraUsageDescription\|appattest"` → 3 matches.

### Step 2: EAS project and profiles

`eas whoami` (STOP if not logged in). `eas init` (accept creating/linking the project). Create `eas.json`:

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "ios": { "simulator": false } },
    "development-simulator": { "developmentClient": true, "distribution": "internal", "ios": { "simulator": true } },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

Create `.easignore` with `docs/`, `jobs/`, `.context/`, `coverage/`, `*.test.*` so archives stay small (the 2 GB archive limit is far away, but the model asset in plan 03.03 will be fetched at build time, not uploaded).

**Verify**: `grep -n projectId app.json` → 1; `eas build:list --limit 1` → runs (empty list is fine) — proves the link without building.

### Step 3: Local development build on the Simulator

`npx expo prebuild --platform ios --clean` then `npx expo run:ios`. The dev client launches, connects to Metro, and shows the app shell from plan 01.02. Then quit Metro and run `npm run ios` to confirm the Conductor script path also opens the dev client.

**Verify**: Simulator shows the Scan tab inside the dev client; `git status` shows no `ios/` files (ignored).

### Step 4: README note

Add to `README.md` a subsection "Run a development build": `npx expo prebuild --platform ios --clean && npx expo run:ios` for local builds; `eas build --platform ios --profile development` for device builds ("uses EAS build minutes; ask before running"). Keep it under 15 lines; plan 06.02 rewrites the README fully.

**Verify**: `grep -n "development build" README.md` → 1+.

## Test plan

No automated tests (configuration only). Verification is the local build launching.

## Done criteria

- [ ] `npx tsc --noEmit` and `npm run lint` exit 0
- [ ] `npx expo run:ios` launches the dev client with the app shell
- [ ] `eas.json` has `development`, `development-simulator`, `preview`, `production` profiles
- [ ] `app.json` has `ios.bundleIdentifier`, the three usage strings and the App Attest entitlement
- [ ] No `ios/` directory tracked (`git ls-files ios | wc -l` → 0)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- `eas whoami` fails — the operator must `eas login`; do not create an Expo account.
- `npx expo run:ios` fails on Xcode/CocoaPods errors after one `--clean` retry — report the log tail.
- The operator's App Store Connect bundle id differs from `app.artlog.ios` — do not guess; ask.

## Maintenance notes

- Later plans append to `ios.infoPlist`/`plugins` (VisionCamera, location, image picker, Apple sign-in); merge, never replace.
- App Attest environment follows the signed entitlement. Spike 00.06 observed a production AAGUID in a development-signed build with the `production` entitlement; development signing does not automatically select sandbox. `APP_ATTEST_ALLOW_DEV=true` permits development attestations on the dev backend; it does not select the phone’s environment.
- Cloud builds cost minutes/quota; the `development-simulator` profile exists for teammates without Xcode, not for routine use.
