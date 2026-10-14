# Production operations

| Purpose     | Deployment              | Client URL                                   |
| ----------- | ----------------------- | -------------------------------------------- |
| Development | `usable-owl-256`        | `https://usable-owl-256.convex.cloud`        |
| Production  | `admired-goldfinch-660` | `https://admired-goldfinch-660.convex.cloud` |

Both belong to `daniel-jiang/artlog`. Production uses its own Pinecone index
`artlog-prod-512` and a private R2 bucket. Convex file IDs identify R2 objects.
Deployment counts and import progress belong in live queries and checkpoint
reports, not in this reference; see [corpus imports](corpus-imports.md).

## Configuration boundaries

Production requires `APPLE_BUNDLE_ID=app.artlog.ios`,
`APP_ATTEST_APP_ID=J4UW2CVVY4.app.artlog.ios`, `APP_ATTEST_REQUIRED=true`, and
`APP_ATTEST_ALLOW_DEV=false`. Supported model versions must match the bundled
CoreML asset and corpus. Keep `FLAG_RIGHT_NOW=off` because source retrieval does
not establish semantic grounding; see [the evaluation limits](../experiments/README.md#tavily-and-right-now).
Leave `DEMO_BOT_JWKS` and `FLAG_DEMO_ACTIVITY` unset unless demo activity on
production was explicitly requested; see [demo activity](../demo-activity.md).

Account deletion revokes Sign in with Apple with a Sign in with Apple key whose
primary App ID is `app.artlog.ios`: set `APPLE_TEAM_ID=J4UW2CVVY4`, `APPLE_KEY_ID`,
and `APPLE_PRIVATE_KEY` (`npx convex env set APPLE_PRIVATE_KEY --from-file AuthKey_<id>.p8`).
Without them, deletion still completes and Sentry reports `apple_unconfigured`
under `accounts.revoke_apple`.

Authentication uses independent `JWT_PRIVATE_KEY` and `JWKS`. Runtime providers
require `NEBIUS_API_KEY`, `TAVILY_API_KEY`, and `OPENAI_API_KEY`. Without the OpenAI
key, narration reports `narration_not_configured`; shared-text moderation uses
its local fallback. Configure provider call/credit caps for the deployment.

Search requires `PINECONE_API_KEY` and `PINECONE_INDEX_HOST`; private file storage
requires `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY`. Keep credentials outside source control. The site's
origin is `https://admired-goldfinch-660.convex.site`; `/privacy` and `/support` supply
the App Store Connect Privacy Policy and Support URLs. Provider/model configuration belongs in
[the environment template](../../.env.example) and runtime adapters.

Push notifications use Expo's push service. Apple delivery requires an APNs key
for `app.artlog.ios` in the project's EAS credentials (`eas credentials -p ios`,
Push Notifications). Missing credentials fail receipts and report
`push_invalid_credentials` through Sentry under `push.receipts`. EAS/store
commands require an explicit request.

## Select production explicitly

The normal `.env.local` targets development and can contain a development key.
Keys take precedence over project selection. Create the gitignored
`.context/production-target.env` with only:

```dotenv
CONVEX_DEPLOYMENT=prod:admired-goldfinch-660
```

With Convex account authentication and no deployment key or token exported in
the shell, inspect production from the repository root:

```sh
npx convex run ingest:counts --prod --env-file .context/production-target.env
npx convex run health:ping --prod --env-file .context/production-target.env
```

For an explicitly authorized backend deployment:

```sh
npx convex deploy --env-file .context/production-target.env
```

Python imports use production `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in their own
job process with a target-specific checkpoint. Preserve development `.env.local`.

## Derived catalog data

Home's museum picks depend on placements. Rebuild them after corpus imports or
when initializing a deployment:

```sh
npx convex run museumPicks:rebuild --prod --env-file .context/production-target.env
```

Search's popular tags refresh on a weekly cron. Initialize or refresh them with:

```sh
npx convex run tags:refreshPopular --prod --env-file .context/production-target.env
```

Search uses artwork search text, artist keys, counts, and covers. `convex import`
skips the trigger that sets search fields. After importing a corpus or initializing
a deployment, populate search fields and refresh artist covers:

```sh
npx convex run artworks:backfillSearchFields '{"cursor":null}' --prod --env-file .context/production-target.env
npx convex run artists:refreshCovers --prod --env-file .context/production-target.env
```

These jobs return before their scheduled pages complete. Inspect completion and
errors rather than treating command return as completion. Export the venue asset
from the actual target before building the iOS app; IDs from another deployment
cannot serve as its catalog references.

## Report review

The terms require report review within 24 hours. Review open reports daily:

```sh
npx convex run review:listReports --prod --env-file .context/production-target.env
npx convex run review:decideReport '{"reportId":"<report ID>","operator":"<reviewer>","decision":"remove","reason":"<reason>"}' --prod --env-file .context/production-target.env
```

`review:getReport` returns the saved reported-content snapshot. `remove` deletes
a comment, hides a wall item or post, or deactivates a profile; `dismiss` retains
it. Inspect the report before choosing the action.

## App Review test friend

Seed the test friend described in [social-and-journal.md](../social-and-journal.md)
once per deployment, with a friends-only visit so a new friend has a post to
read and report. Visits take the demo seed's shape (`demoPersonArgs` in
`convex/lib/demoAccounts.ts`); upload their photos with `demoSeed:storeImages`.

```sh
npx convex run reviewFriend:seed '{"username":"testfriend","name":"Test Friend","bio":"A test account. Adds you back right away.","avatar":"<preset ID>","visits":[<visit>]}' --prod --env-file .context/production-target.env
```

Give App Review the username in the review notes.

## iOS distribution

Production builds need the production Convex URL, a venue asset exported from
that deployment, the bundled model asset, Apple signing, and App Store Connect
configuration. Build and submission commands require explicit authorization.
Verify the selected installed build on an iPhone in light mode: sign-in,
production App Attest, scanning, saving, sharing, and deletion. Backend import
readback does not establish device capture or attestation behavior.

Build numbers must increase. A required-update minimum can be raised only after
the replacement is available to affected users; see [app compatibility](app-updates.md).
