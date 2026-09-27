---
name: testflight
description: Build the iOS app locally and ship it to internal TestFlight testers on the production Convex deployment. Run only when the user invokes /testflight.
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
   `EXPO_PUBLIC_CONVEX_URL=https://admired-goldfinch-660.convex.cloud` and
   `EXPO_PUBLIC_CONVEX_SITE_URL=https://admired-goldfinch-660.convex.site`. Stop on any other
   deployment. Keep the dev `.env.local` intact; the production build uses the EAS production
   environment. Run `npm run model:check`.
3. **Check production compatibility before building.** Follow the explicit production targeting
   instructions in `docs/operations/production.md`: use a separate env file and unset
   `CONVEX_DEPLOY_KEY` and `CONVEX_DEPLOYMENT_TOKEN` in the command environment. All checks below
   are read-only; do not deploy, seed, or publish an asset as part of this preflight.
   - Inspect production with `npx convex function-spec --prod --env-file <production-env-file>`.
     Compare the public functions used by the selected app ref and their argument/return
     validators with that ref's source. In particular, require `appCompatibility:get`,
     `venueChanges:list`, and `sync:syncJournal` support for every client visit visibility,
     including `friends`. Missing functions or incompatible contracts block the release.
   - Compare every `(id, key)` in the bundled `assets/venues.db` with the production rows from
     the paginated read-only `ingest:exportVenues` query. Require a nonempty bundle with matching
     IDs and keys, and a `meta.changeVersion` no greater than production's
     `venueChanges:latestVersion`. Checking the EAS URLs alone does not validate this asset.
   On either failure, report the mismatch and stop before building or submitting. Backend
   releases require an explicit request and follow `docs/operations/production.md`. A mismatched
   bundle must be re-exported from production with the read-only `export_asset` helper in
   `scripts/data/pipeline/seed_venues.py` (not its seeding CLI), committed, and checked again from
   step 1. Keep evidence in `.context/testflight/`.
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
