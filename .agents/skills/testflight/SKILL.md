---
name: testflight
description: Build the iOS app locally and ship it to internal TestFlight testers on the dev Convex deployment. Run only when the user invokes /testflight.
disable-model-invocation: true
---

# Internal TestFlight release

Invoking this skill is the explicit EAS build and submission request the project guide requires. It ships
to the internal testing group only; a public link or App Store release follows
`docs/todos/release/README.md`.

Signing for the app and `ExpoWidgetsTarget` and the App Store Connect API key live on EAS, and
`eas.json` holds `ascAppId`, so every command runs non-interactively. Local builds do not use EAS
build credits. Keep outputs in `.context/testflight/`.

1. **Pick the ref.** Ship `origin/main` unless the user names another ref. Run `git fetch origin`,
   then stop if the working tree has uncommitted changes or `HEAD` is not that ref: the local build
   packs the working tree, not the commit.
2. **Check the target.** `npx eas-cli env:list production` must show
   `EXPO_PUBLIC_CONVEX_URL=https://usable-owl-256.convex.cloud` and
   `EXPO_PUBLIC_CONVEX_SITE_URL=https://usable-owl-256.convex.site`, and `.env.local` must say
   `CONVEX_DEPLOYMENT=dev:usable-owl-256`. Stop on any other deployment. Run `npm run model:check`.
3. **Sync the backend.** Run `npx convex dev --once` without sourcing `.env.local`. It replaces
   whatever another worktree pushed to the shared dev deployment. On a schema validation failure,
   report the table and document shape and stop; delete dev data only with the user's approval.
4. **Build** in the background (about 20–30 minutes):

   ```sh
   mkdir -p .context/testflight
   sha=$(git rev-parse --short HEAD)
   npx eas-cli build --platform ios --profile production --local --non-interactive \
     --output ".context/testflight/artlog-$sha.ipa" > ".context/testflight/build-$sha.log" 2>&1
   ```

   On failure, report the first errors from the log and stop.
5. **Submit** the step 4 `.ipa` with
   `npx eas-cli submit --platform ios --profile production --path <ipa> --non-interactive`.
6. **Report** the commit, build number
   (`unzip -p <ipa> 'Payload/*.app/Info.plist' | plutil -extract CFBundleVersion raw -`), `.ipa`
   size, and the submission URL. Apple processes the build in about 10–30 minutes; automatic
   distribution then sends it to the internal group.
