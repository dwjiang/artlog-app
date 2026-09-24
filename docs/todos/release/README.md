# Production release

**Status: production backend current but empty; TestFlight release outstanding.** See the dated
[deployment state, configuration, and targeting instructions](../../operations/production.md).
EAS builds and submissions require an explicit request under the
[project guide](../../../AGENTS.md).

## Release tasks

- [ ] Repopulate production, which was wiped and redeployed at `f3c13782` on
      2026-09-24: seed museums and publish its venue table, then import the corpus.
      Set `LABEL_MODEL`, `OPENAI_API_KEY`, and `SENTRY_DSN` there; production only
      has the retired `LABEL_VL_MODEL`. Redeploy `main` first if it has moved on.
- [ ] Remove `devices.assertSmoke` and its Settings caller; retain development
      tools only under `__DEV__`. Run the affected tests, TypeScript, and lint.
- [ ] Configure the EAS production environment with
      `EXPO_PUBLIC_CONVEX_URL=https://admired-goldfinch-660.convex.cloud`, the correct
      venue asset, and the [model asset settings](../../../scripts/model/README.md).
      Confirm Apple enrollment, signing, App Store Connect record, submission
      credentials, and current privacy/export declarations before building.
- [ ] When requested, build with `eas build --platform ios --profile production`.
      Record the build ID and uncompressed installed app size; the project target
      is below 200 MB. If exceeded, review the packaging rather than adopting the
      rejected 4-bit model recipe.
- [ ] Submit the selected build with `eas submit --platform ios --latest` after
      confirming it is the intended production build. Verify internal installation,
      complete external Beta App Review, and add the approved TestFlight public
      link to the [README](../../../README.md).
- [ ] Test the installed production build on an iPhone in light mode: Apple
      sign-in, production App Attest, scanning, saving, and contributions. Record
      the build/deployment, results, size, public link, expiry, and a refresh reminder.
      The prior release checklist used TestFlight's 90-day lifetime; confirm the
      displayed expiry when distributing.

Record the last known working build and backend revision, recovery steps for
that release, and the release contact. The [hackathon todo](../hackathon/README.md)
owns submission material and the video.
