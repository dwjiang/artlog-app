# Production backend and release

## Deployment targets

| Purpose | Convex deployment | Client URL |
| --- | --- | --- |
| Development and the current iPhone build | `usable-owl-256` | `https://usable-owl-256.convex.cloud` |
| Production | `admired-goldfinch-660` | `https://admired-goldfinch-660.convex.cloud` |

Both deployments belong to `daniel-jiang/artlog` and use `CALIBRATOR_V2` (`lr-v2`).
The trained configuration and its limitations are in
[decision 009](../decisions/009-calibrator-v2.md). The earlier claim that production
did not exist was stale: it existed with no functions, data, or environment
variables when inspected on 2026-09-13.

Production backend and the verified 10,000-painting corpus are ready as of
2026-09-13. Import counts, all museum and painting metadata/references, every
embedding view, and all ORB bytes matched the package. Authenticated production
recognition passed for Roses, Wheat Field with Cypresses, and The Bedroom using
`lr-v2`; missing geometry returned soft and an unsupported model was refused.
TestFlight build, submission, and physical-iPhone testing against production
remain pending.

## Production configuration

| Setting | Value |
| --- | --- |
| `APPLE_BUNDLE_ID` | `app.artlog.ios` |
| `APP_ATTEST_APP_ID` | `J4UW2CVVY4.app.artlog.ios` |
| `APP_ATTEST_REQUIRED` | `true` |
| `APP_ATTEST_ALLOW_DEV` | `false` |
| `SUPPORTED_MODEL_VERSIONS` | `c-radiov3-b-int8-512-dinov2-v1` |
| `FLAG_LABEL_FLOW`, `FLAG_MUSEUM_SEARCH` | `on` |
| `FLAG_RIGHT_NOW` | `off`, pending the decision 007 verification |
| `DAILY_TOKEN_FACTORY_CALL_CAP` | `2000` |
| `DAILY_TAVILY_CREDIT_CAP` | `20` |
| `SITE_URL` | `https://admired-goldfinch-660.convex.site` |
| `LABEL_VL_MODEL` | `moonshotai/Kimi-K2.6` |
| `FACT_SHEET_MODEL` | `nvidia/nemotron-3-super-120b-a12b` |
| `DOCENT_MODEL`, `MODERATION_MODEL` | `nvidia/Nemotron-3_5-Lightning` |

Production has its own generated `JWT_PRIVATE_KEY` and `JWKS`. Provider credentials
`NEBIUS_API_KEY` and `TAVILY_API_KEY` are configured on the deployment. Secrets
remain outside source control. All 19 values were verified after setting them.
Anonymous sign-in and authenticated device registration passed; unauthenticated
registration and an unattested shared write were refused.

## Initial corpus

| Table | Verified production rows |
| --- | ---: |
| museums | 42,452 |
| artworks | 11,721 |
| objects | 15,427 |
| placements | 14,256 |
| vectors | 13,616 |
| descriptors | 10,000 |

The source is the verified package at `jobs/scratch/calibrator-corpus-10000/`:
10,000 canonical paintings, with all metadata and merged aliases, alternate
embedding views, and selected ORB references. Hub penalties remain zero.
The global museum directory contains 42,452 seeded museums; the two development
POI records were excluded. All 793 museum keys required by the corpus exist.

Museums were imported with the Convex table importer, preserving their collection
site metadata and assigning production IDs. A new SQLite venue asset was then
exported from production and published through `venueTable`. Its 42,452 IDs match
production, and the downloaded 8,568,832-byte asset matches the generated file.
The painting package uses the existing resumable `artlog_jobs.push` importer.

Artifacts are under `jobs/out/06-01-2026-09-13-production/`: dry-run plan, museum
input, venue asset and mapping, import checkpoint/log, configuration/auth audits,
and the completed import/readback/recognition reports. The recognition smoke
check used exact indexed reference vectors and ORB features through the public
authenticated API; it was not a production iPhone camera run.

## Targeting production from this checkout

The normal `.env.local` contains a dev deployment key. A deployment key takes
precedence over project selection, so use a separate target file for production
CLI operations. This preserves the current iPhone's connection to dev.

Create a gitignored `.context/production-target.env` containing only:

```dotenv
CONVEX_DEPLOYMENT=prod:admired-goldfinch-660
```

With Convex account authentication and no deployment key exported in the shell:

```sh
npx convex run ingest:counts --prod --env-file .context/production-target.env
npx convex deploy --env-file .context/production-target.env
```

For Python imports, supply `CONVEX_URL` and `CONVEX_DEPLOY_KEY` for production in
the job process environment and use a production-specific checkpoint. Do not
replace the dev values in `.env.local`. Follow the
[import runbook](../../jobs/README.md#calibrator-index-expansion-2026-09-12).

## Before distributing an iPhone build

Complete [plan 06.01](../plans/06-release/01-testflight-and-app-size.md): remove the
remaining development verification endpoint and its UI caller, configure the EAS
production environment with the production client URL and model asset settings,
build and submit TestFlight, and test the installed build against production.
Physical checks must include Apple sign-in, production App Attest, scanning,
saving, and contributions. The current phone's dev session does not verify these
production flows.

Keep “Right now” off until its acceptance review is complete. The full corpus
import is [deferred until the user resumes it](../todos/production-upload/README.md)
to reduce costs during development. Production retains the verified
10,000-painting release sample.
