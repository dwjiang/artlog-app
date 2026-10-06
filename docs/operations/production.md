# Production deployment reference

The full production corpus import completed on 2026-09-27 at 22:58 PDT.
Remaining build, distribution, and iPhone verification tasks are in the
[release todo](../todos/release/README.md).

## Current deployment state

| Purpose     | Deployment              | Client URL                                   |
| ----------- | ----------------------- | -------------------------------------------- |
| Development | `usable-owl-256`        | `https://usable-owl-256.convex.cloud`        |
| Production  | `admired-goldfinch-660` | `https://admired-goldfinch-660.convex.cloud` |

Both belong to `daniel-jiang/artlog`. Production now has the batched direct-to-R2
import backend, the PCA512 model configuration, and its own Pinecone index
`artlog-prod-512`. R2 uses the private `artlog` bucket; Convex file IDs identify
objects. No billing threshold or plan was changed.

The full production import started on 2026-09-27 at 10:52 PDT. All 3,924 required
museums are restored, and the 30-object pilot passed 100% readback and Pinecone
verification. All six upload stages completed at 20:25 PDT: 404,653 artworks,
409,973 objects, 296,344 placements, 402,139 vectors, 397,047 descriptors, and
409,973 penalty checks. Pinecone sync is ready. The user separately expanded
the museum directory to 42,452 records. **Final counts match; all 46,412 sampled
record checks and 8,201 thumbnail checks passed with zero mismatches or
violations.** Public API checks confidently identified the correct AIC, Met,
and Wikidata reference objects with `lr-v3`; missing geometry returned a soft
result and an unsupported model was rejected. Usage was recorded and the
temporary import credentials were revoked and removed. The durable run directory is
`/Users/dwjiang/Documents/Artlog Data/jobs/out/production-full-2026-09-26/`.
See `run-status.json`, `push-prod-full.report.json`, `recognition-audit.json`,
`usage-after.json`, and `credential-cleanup.json` for completion evidence.
The [upload runbook](../todos/production-upload/README.md) owns completion gates
and recovery. [Hub scoring](../todos/hub-scoring/README.md) remains deferred.

The job restarted at 11:29 PDT with four concurrent preflight reads and feature
preparation batches, 32 pooled R2 upload workers, and ordered metadata commits.
Its 1,000-object pilot passed counts, sampled readback, and Pinecone checks at
11:32 PDT. The full job then resumed with progress saved during preflight too.
At 16:06 PDT it resumed with continuous preparation and 32 concurrent file
verification requests, after a production benchmark passed sampled readback.
The benchmark measured 69.6 vectors/s and 73.0 descriptors/s, with some descriptor
file reuse; the runbook records the conservative estimate and evidence. Each
ordered commit now advances the checkpoint by at most 100 records.

The September 13 verified 10k production sample and its exported venue SQLite
are historical: the pre-release backend reset subsequently emptied production.
Their evidence remains in `jobs/out/06-01-2026-09-13-production/` under the same
Artlog Data root. Those old counts, recognition measurements, and production IDs
must not be treated as current. The next build must export venue IDs from its
actual deployment. No iPhone camera or TestFlight acceptance is claimed by this
backend import.

## Recorded production configuration

| Setting                            | Value                                       |
| ---------------------------------- | ------------------------------------------- |
| `APPLE_BUNDLE_ID`                  | `app.artlog.ios`                            |
| `APP_ATTEST_APP_ID`                | `J4UW2CVVY4.app.artlog.ios`                 |
| `APP_ATTEST_REQUIRED`              | `true`                                      |
| `APP_ATTEST_ALLOW_DEV`             | `false`                                     |
| `SUPPORTED_MODEL_VERSIONS`         | `c-radiov3-b-int8-512-dinov2-pca512-v1`     |
| `FLAG_LABEL_FLOW`                  | `on`                                        |
| `FLAG_RIGHT_NOW`                   | `off`                                       |
| `DAILY_TOKEN_FACTORY_CALL_CAP`     | `2000`                                      |
| `DAILY_TAVILY_CREDIT_CAP`          | `2000`                                      |
| `SITE_URL`                         | `https://admired-goldfinch-660.convex.site` |
| `LABEL_MODEL`, `FACT_SHEET_MODEL`  | `nvidia/nemotron-3-super-120b-a12b`         |
| `DOCENT_MODEL`, `MODERATION_MODEL` | `nvidia/Nemotron-3_5-Lightning`             |

Production has independent `JWT_PRIVATE_KEY` and `JWKS` plus provider credentials
`NEBIUS_API_KEY`, `TAVILY_API_KEY`, and `OPENAI_API_KEY` (narration speech and post
moderation; without it every Listen fails with `narration_not_configured` and comments,
reflections, notes and bios fall back to the word list), all outside source control. The import adds
`PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, `R2_BUCKET`,
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` without changing
authentication or provider settings. The September 13 anonymous sign-in, device
registration, and negative authorization checks remain historical evidence;
the current import runs fresh public recognition API checks after readback.
Keep “Right now” off for the recorded
[grounding limitations](../experiments/README.md#tavily-and-right-now).

Push notifications go through Expo's push service and need no Convex variable. Apple
delivers them only after an APNs key for `app.artlog.ios` is in the project's EAS
credentials (`eas credentials -p ios`, Push Notifications). Without it, every receipt
fails and Sentry records `push_invalid_credentials` under `push.receipts`.

## Daily report review

The terms promise a review of every report within 24 hours, and nothing alerts on
new ones. Once a day, list open reports and resolve each one:

```sh
npx convex run review:listReports --prod --env-file .context/production-target.env
npx convex run review:decideReport '{"reportId":"…","operator":"…","decision":"remove","reason":"…"}' --prod --env-file .context/production-target.env
```

`review:getReport` shows the saved copy of the reported content. `remove` deletes a
comment, hides a wall item or post, and deactivates a profile; `dismiss` keeps it.

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

Home's "Don't miss" reads per-museum picks scored from placements. Rebuild them after
the first deploy that includes `museumPicks`, and after every corpus import:

```sh
npx convex run museumPicks:rebuild --prod --env-file .context/production-target.env
```

The command returns at once; scheduled steps finish the rebuild and log
`Museum picks rebuilt`.

Search's popular tags are picked by a Monday cron. After the first deploy that
includes `popularTags`, pick them once so Search doesn't wait for the cron:

```sh
npx convex run tags:refreshPopular --prod --env-file .context/production-target.env
```

Python imports use production `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in the job
process with a production-specific checkpoint. Keep the dev `.env.local` intact;
the [upload todo](../todos/production-upload/README.md) owns import preparation and
verification.
