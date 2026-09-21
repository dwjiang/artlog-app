# Production deployment reference

Deployment observations were recorded on 2026-09-13 and were not rechecked
during documentation cleanup. Remaining build, distribution, and iPhone
verification tasks are in the [release todo](../todos/release/README.md).

## Recorded deployment state

| Purpose | Deployment | Client URL |
| --- | --- | --- |
| Development | `usable-owl-256` | `https://usable-owl-256.convex.cloud` |
| Production | `admired-goldfinch-660` | `https://admired-goldfinch-660.convex.cloud` |

Both belong to `daniel-jiang/artlog` and were deployed with `lr-v2`. Production
has the verified 10,000-painting sample. Import readback matched all metadata,
references, embedding views, and ORB bytes. Authenticated recognition passed for
Roses, Wheat Field with Cypresses, and The Bedroom; missing geometry returned
soft and an unsupported model was refused. Those checks used exact indexed
reference features through the API, not the production iPhone camera.

| Table | Verified production rows |
| --- | ---: |
| museums | 42,452 |
| artworks | 11,721 |
| objects | 15,427 |
| placements | 14,256 |
| vectors | 13,616 |
| descriptors | 10,000 |

The imported package contains canonical paintings, merged aliases, alternate
embedding views, and selected ORB references. All 793 required museum keys
exist. The two development POI records were excluded from the museum directory.
The production venue SQLite was exported with production IDs, published through
`venueTable`, and verified at 8,568,832 bytes. A build must use venue IDs from
the deployment it connects to.

Local evidence lives under `/Users/dwjiang/Documents/Artlog Data/`:
`jobs/scratch/calibrator-corpus-10000/` holds the package;
`jobs/out/06-01-2026-09-13-production/` holds configuration/auth audits, venue
asset and mapping, import checkpoint, readback, and recognition reports.
See the [import instructions](../../scripts/data/README.md) for the existing importer.
The [full corpus upload](../todos/production-upload/README.md) and
[hub scoring](../todos/hub-scoring/README.md) remain deferred.

## Recorded production configuration

| Setting | Value |
| --- | --- |
| `APPLE_BUNDLE_ID` | `app.artlog.ios` |
| `APP_ATTEST_APP_ID` | `J4UW2CVVY4.app.artlog.ios` |
| `APP_ATTEST_REQUIRED` | `true` |
| `APP_ATTEST_ALLOW_DEV` | `false` |
| `SUPPORTED_MODEL_VERSIONS` | `c-radiov3-b-int8-512-dinov2-v1` |
| `FLAG_LABEL_FLOW`, `FLAG_MUSEUM_SEARCH` | `on` |
| `FLAG_RIGHT_NOW` | `off` |
| `DAILY_TOKEN_FACTORY_CALL_CAP` | `2000` |
| `DAILY_TAVILY_CREDIT_CAP` | `20` |
| `SITE_URL` | `https://admired-goldfinch-660.convex.site` |
| `LABEL_MODEL`, `FACT_SHEET_MODEL` | `nvidia/nemotron-3-super-120b-a12b` |
| `DOCENT_MODEL`, `MODERATION_MODEL` | `nvidia/Nemotron-3_5-Lightning` |

Production has independent `JWT_PRIVATE_KEY` and `JWKS` plus provider credentials
`NEBIUS_API_KEY` and `TAVILY_API_KEY`, all outside source control. All 19 values
were verified. Anonymous sign-in and authenticated device registration passed;
unauthenticated registration and an unattested shared write were refused.
Keep “Right now” off for the recorded
[grounding limitations](../experiments/README.md#tavily-and-right-now).

## Selecting production explicitly

The normal `.env.local` targets dev and contains a dev deployment key. Keys take
precedence over project selection. Create a gitignored
`.context/production-target.env` containing only:

```dotenv
CONVEX_DEPLOYMENT=prod:admired-goldfinch-660
```

With Convex account authentication and no deployment key or deployment token
exported in the shell, inspect production from the repository root:

```sh
npx convex run ingest:counts --prod --env-file .context/production-target.env
npx convex run health:ping --prod --env-file .context/production-target.env
```

For an authorized backend release, the explicit deployment command is:

```sh
npx convex deploy --env-file .context/production-target.env
```

Python imports use production `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in the job
process with a production-specific checkpoint. Keep the dev `.env.local` intact;
the [upload todo](../todos/production-upload/README.md) owns import preparation and
verification.

