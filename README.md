# Artlog — an art identifier for museum-goers

Point your iPhone at a painting and Artlog names it in about a second: title, artist, date,
medium and institution, saved to a private collection tied to the visit where you found it.
Identification is visual retrieval, not a language model guessing from pixels. The phone embeds
the painting with NVIDIA's C-RADIOv3-B, one versioned index on Convex returns candidates, ORB
descriptors and a homography verify them, and a small calibrator decides whether to say
*confident*, *soft* or *unidentified*. When a work is not in the index, the app searches the
museum's own site (with consent) or reads the wall label, verifies what it read against the
museum's records or Wikidata and, with the visitor's consent, adds the work to a shared index so
the next visitor gets an instant match. Nemotron on Nebius Token Factory writes the cited
"about this work" text once per artwork; Tavily finds museum-site evidence and fact-sheet
sources. A scan taken with no signal waits on the phone and is identified when the connection
returns.

Built for the Nebius × NVIDIA Global AI Hackathon. iOS only.
[Open work](docs/todos/) and [experiment findings](docs/experiments/README.md).

## Demo

- **TestFlight public link:** _PLACEHOLDER — available once Beta App Review clears._
- **Video (under 3 minutes, YouTube):** _PLACEHOLDER — outline in
  [video outline](docs/hackathon/video-outline.md)._
- Hackathon deliverables: [feedback notes](docs/hackathon/feedback-notes.md),
  [submission checklist](docs/todos/hackathon/README.md).

The app opens to the camera with no account; anyone with the TestFlight build can scan within
seconds.

## Where NVIDIA and Nebius are used

| Component | Model / service | Code | Runs |
|---|---|---|---|
| Image embedding, every scan | **NVIDIA C-RADIOv3-B**, DINOv2 adaptor summary, 512 px input, 1,536-d output, exported to CoreML with int8 weights and fp16 compute (`modelVersion` `c-radiov3-b-int8-512-dinov2-v1`) | `modules/coreml-embed/`, export recipe in `scripts/model/` | On the phone's Neural Engine, about 67 ms per crop on an iPhone 16 Pro. Normal identification sends features without uploading the crop |
| Image embedding, index build | The **same weights**: the int8 state recovered from the CoreML export, dequantized to fp16, gated by a drift check against 200 committed iPhone reference embeddings before every build | `scripts/data/pipeline/model.py`, `embed.py`, `drift_check.py` | On the operator's Mac (see below) |
| Fact sheets | **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`, `FACT_SHEET_MODEL`) writes discrete facts, each citing the owner's page, Wikidata or a score-filtered Tavily result | `convex/docent.ts`, sources in `convex/lib/docentSources.ts` | Token Factory, live on the first identification of an artwork with no cached fact sheet; cached on the artwork afterwards |
| Docent prose | **NVIDIA Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`, `DOCENT_MODEL`) writes three or four English sentences citing only those facts; a validator drops any sentence without a valid citation | `convex/docent.ts`, `convex/lib/docentValidator.ts` | Token Factory, once per artwork, then cached and served with the card |
| Text moderation | **NVIDIA Nemotron 3.5 Lightning** (`MODERATION_MODEL`) screens label fields, museum-page fields and contributions before they reach a screen or the shared index | `convex/lib/moderation.ts` | Token Factory, live on every label read, museum-site candidate and contribution |
| Label reading and artwork description | **Moonshot Kimi K2.6** (`moonshotai/Kimi-K2.6`, `LABEL_VL_MODEL`). Not an NVIDIA model: no NVIDIA vision endpoint was on Token Factory's public catalog on 2026-09-08 (Nemotron Nano Omni's public endpoint was retired 2026-08-31, Nano 2 VL on 2026-04-13). Kimi read title and artist correctly on 24 of 25 test labels ([model evaluation](docs/experiments/README.md#token-factory-models)) | `convex/label.ts`, `convex/museumSearch.ts`, prompts in `convex/lib/labelPrompt.ts` and `convex/lib/describePrompt.ts` | Token Factory, live on every label capture and every consented museum-site search |
| Token Factory client | OpenAI-compatible chat completions at `api.tokenfactory.nebius.com/v1` with strict `json_schema` output and thinking disabled; per-device rate limits and a global daily call cap | `convex/lib/tokenFactory.ts`, `convex/lib/spend.ts` | From Convex actions only; the phone never calls a model provider |
| Nebius Serverless AI Jobs | Measured with three probe jobs: an L40S job, a lifecycle-managed scratch bucket and a service-account REST path ([findings](docs/experiments/README.md#batch-infrastructure)) | [archived probes](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/nebius-jobs) | **Not on any production path.** See the next paragraph |

**Where the index was actually built.** The corpus build ran on the operator's Mac (Apple M5 Pro, PyTorch on the
MPS backend, fp16), shard by shard with the same fake-quantized weights the phone runs, because
the Wikimedia Commons download sets the wall clock, not GPU time, and the Commons robot policy
applies wherever the job runs ([scripts/data/README.md](scripts/data/README.md), "Index build"). No Nebius job
has embedded, enriched or migrated the index; the only Nebius compute spent was three
probe jobs, about $0.20. Nothing idles on Nebius by design: the request path is the phone and
Convex, and what runs on Nebius is Token Factory, live, on every label read, every consented
museum-site search, every moderation check and the first identification of every uncached
artwork.

## Tavily

Tavily supports the runtime calls below and the batch enrichment worker. Runtime features
sit behind feature flags; runtime and batch calls share a daily credit cap
(`DAILY_TAVILY_CREDIT_CAP`, reserved atomically before each call). Visual index matching
does not depend on Tavily.

| Call | Code | What it does |
|---|---|---|
| Museum-site search | `convex/museumSearch.ts`, client in `convex/lib/tavily.ts` | On a miss, with consent: first search the venue's current exhibitions with source-linked images. The phone checks up to six images on each of three pages by embedding and homography. A match is identified only from artwork metadata or a caption attached to that image; otherwise the visitor is asked for the label. If no image matches, a second search uses the vision model's painting description and checks individual object pages. One credit per search, at most two per attempt. `FLAG_MUSEUM_SEARCH`, on by default |
| Label verification | `convex/label.ts` | When the accession and Wikidata checks fail, one museum-scoped search for the label's title and artist; a page image is confirmed on the phone the same way. `FLAG_LABEL_FLOW`, on by default |
| Fact-sheet research | `convex/docent.ts` through `convex/lib/docentSources.ts` | On the first identification of an uncached artwork, results filtered by per-domain source scores (`shared/sources/source-scores.json`) become sources Nemotron 3 Super must cite |
| "Right now" | `convex/rightNow.ts`, acceptance rules in `convex/lib/rightNowAccept.ts` | One search with `include_answer`, `topic: news`, a one-month window and the venue region's domain list; a sentence is shown only when the cited source contains it and names an explicit event date. `FLAG_RIGHT_NOW`, **off by default** following the [evaluation](docs/experiments/README.md#tavily-and-right-now) |

## Architecture

```text
                     ~20 KB per scan: vector + ORB descriptors, no pixels
 iPhone (Expo dev client) ────────────────────────────────▶ Convex (the whole request path)
   camera → subject crop → CoreML C-RADIOv3-B → ORB           identify: vector search → ORB/RANSAC → calibrator
   venue table (SQLite, on device) · local collection         label · museumSearch · docent · rightNow actions
   App Attest key · offline scan queue  ◀── scans ────────    promotion cron · sync · rate limits · spend caps
                                          subscription             │                 │              │
                                                                   ▼                 ▼              ▼
                                                        Nebius Token Factory       Tavily      one page on the
                                                        (Kimi, Nemotron)                       venue's own hosts

 Mac, batch, runs to completion (scripts/data/):
   seed venues → corpus metadata → download / drift check / embed → dedupe / hubs → push ──▶ Convex
```

## Run the app against the hosted backend

You need macOS with Xcode 26, Node 22.13 or newer, and a physical iPhone on iOS 17 or later
(scanning, the label flow and museum-site search need the camera).

```sh
brew install git-lfs
git lfs install
git clone https://github.com/dwjiang/artlog-app.git && cd artlog-app
npm ci
cp .env.example .env.local
# edit .env.local: EXPO_PUBLIC_CONVEX_URL=https://admired-goldfinch-660.convex.cloud
npm run model:check
npx expo prebuild --platform ios --clean && npx expo run:ios --device
```

The compiled CoreML model is tracked with Git LFS under `modules/coreml-embed/ios/Models/`.
Cloning downloads it using your GitHub repository access; for an existing checkout, run
`git lfs install` and `git lfs pull`. Local Conductor workspaces reuse the repository's LFS cache.
`npm run model:check` verifies the version, dimensions, compiled files and weights checksum;
it also runs before `npm run ios` and during EAS pre-install. EAS uploads include the local
model files, so resolve LFS pointers before starting a build. CI checkouts must fetch LFS files.
`npx expo run:ios --device` builds with Xcode,
installs on the chosen iPhone and starts Metro; `npm run ios` also builds and launches the iOS
app through Expo. Expo Go cannot load the native modules.

The hosted production backend is `admired-goldfinch-660`; its corpus and configuration
are recorded in the [deployment reference](docs/operations/production.md). Remaining release
checks are in the [release checklist](docs/todos/release/README.md). Scanning, saving, the
label flow and museum-site search work from any build.
Writes to the shared index (contributions, rejections, venue confirmations) are signed with App
Attest, which Apple binds to our Team ID, so a build signed by another team is refused for those;
use the TestFlight build, or run your own backend.

### Test a Conductor workspace

Select the workspace to test, then choose an action from Conductor's **Run** menu:

| Action | What it does |
| --- | --- |
| **iOS** (default) | Starts this workspace's Expo server and opens the installed development build in the iOS Simulator. |
| **iPhone** | Starts this workspace's Expo server and displays a QR code. Scan it with your iPhone's Camera while the phone and Mac are on the same Wi-Fi. |
| **Rebuild iOS** | Regenerates the iOS project, then builds and installs a development client. Choose a simulator or connected iPhone in the terminal's device picker. |

Use **Rebuild iOS** once for each target, and again after changing native modules,
native dependencies, or native app configuration. Use **iOS** or **iPhone** for
JavaScript/TypeScript changes. In the Expo terminal, **Shift+i** selects a simulator.
If iOS asks, allow Artlog access to the local network.

Each server uses its workspace's `CONDUCTOR_PORT` and prints the workspace name.
Starting a Run action stops the previous Run action; to switch workspaces, start
**iOS** in the new workspace or start **iPhone** and scan its new QR code.
The installed app's local data is shared when switching workspaces, and the backend
still comes from each workspace's `.env.local`.

## Run your own backend

For the first setup, start at the repository root and remove `CONVEX_DEPLOYMENT`,
`CONVEX_DEPLOY_KEY` and `CONVEX_URL` from the copied `.env.local`. Clear them from the shell
too, then choose a cloud dev deployment when prompted. This lets the CLI select your backend
and update the app's URL without placeholder credentials or a second URL variable interfering.

```sh
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_URL
npx convex dev    # creates a dev deployment on your Convex account and writes
                  # CONVEX_DEPLOYMENT and EXPO_PUBLIC_CONVEX_URL into .env.local
```

Leave it running, or use `npx convex dev --once` to push and exit. Server-side settings are
Convex environment variables, set with `npx convex env set NAME value`
([.env.example](.env.example) lists them):

| Variable | What it does |
|---|---|
| `NEBIUS_API_KEY` | Token Factory key for the label flow, museum-site search, moderation, fact sheets and docent prose |
| `LABEL_VL_MODEL`, `FACT_SHEET_MODEL`, `DOCENT_MODEL`, `MODERATION_MODEL` | Model IDs: `moonshotai/Kimi-K2.6`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3_5-Lightning` |
| `TAVILY_API_KEY` | Tavily key for the four calls above |
| `DAILY_TOKEN_FACTORY_CALL_CAP`, `DAILY_TAVILY_CREDIT_CAP` | Global daily spend caps; defaults are 2,000 calls and 20 credits |
| `FLAG_LABEL_FLOW`, `FLAG_MUSEUM_SEARCH`, `FLAG_RIGHT_NOW` | `on` / `off` kill switches; "Right now" defaults off |
| `SUPPORTED_MODEL_VERSIONS` | Embedding versions `identify` accepts; an older client is told to update |
| `APP_ATTEST_REQUIRED`, `APP_ATTEST_APP_ID`, `APP_ATTEST_ALLOW_DEV` | App Attest for shared writes: `true` in production, `TEAMID.app.artlog.ios`, and whether Apple's development environment is accepted. Leave `APP_ATTEST_REQUIRED` unset on a personal dev deployment |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `APPLE_BUNDLE_ID` | Convex Auth keys (generate headlessly with jose) and the audience for Sign in with Apple tokens |
| `CRAWLER_CONTACT`, `MODERATION_BLOCKLIST` | Contact address in the page fetcher's User-Agent; optional additions to the moderation blocklist |

An empty deployment has no venues and no index. The Python jobs fill it
([scripts/data/README.md](scripts/data/README.md)):

Before running the jobs, add `CONVEX_URL` to `.env.local` with the same literal URL as
`EXPO_PUBLIC_CONVEX_URL` written by the CLI. The token command below writes only the deploy key.

```sh
npx convex deployment token create artlog-jobs-local --deployment dev --save-env   # CONVEX_DEPLOY_KEY into .env.local
cd scripts/data && uv sync
uv run python -m pipeline.smoke                                       # prints the torch device and live table counts
uv run python -m pipeline.seed_venues --countries US --out out/ --publish   # or --all for the full 42k-venue census
cp out/venues.db ../../assets/venues.db      # the app must ship the venue table exported from the deployment it talks to
```

Continue with the rebuild steps below. The model export and corpus metadata are required for
both a 1,000-object pilot and the full index; the commands include every stage through import.

## Journal and social foundation

Journal data has one canonical Convex owner: `{ kind: "device", deviceId }` before Apple
linking, or `{ kind: "account", accountId }` after linking. The authenticated device resolves
that owner; a client `scope` from `accounts.me` only rejects requests from a stale session.
SQLite uses the installation ID for anonymous ownership before registration, and account IDs
for linked ownership. Composite owner/UUID keys and foreign keys isolate visits, saves, notes,
and pending captures. Label drafts, checkpoints, current visits and photo work use the same local owner.

Apple sign-in creates neither a profile nor a publication. Linking records a claim target;
`journalClaims.resume` transfers at most 50 records / 512 KiB per call, visits before saves.
Call it until complete before journal sync. Local claiming then atomically moves only anonymous
rows, preserves photos/notes/tombstones, and rejects UUID collisions. Sign-out hides account
rows and suspends their queued work; signing into the same account restores them. The client
finishes its claim before disconnecting. Unlink and account deletion reject incomplete claims
with `claim_required`; unlink drops the device's finished claim, and account deletion waits for
every claim on the account, then immediately revokes profile/publication access. Account-owned data is never claimed into a different account.

Implemented APIs (derive wire types from `convex/_generated/api` or the shared validators):

| API | Arguments | Return / behavior |
|---|---|---|
| `accounts.me` | `{}` | `{ linked, deviceCount, accountId, email, scope }` |
| `journalClaims.resume` | `{ scope }` | `{ claimId, complete, moved }`; server chooses the target account |
| `sync.syncJournal` | `{ scope, since, visits, saves }` | `{ visits, saves, acceptedVisits, acceptedSaves, checkpoint, hasMore }`; at most 50 records / 512 KiB each direction |
| `visits.upsertJournal` | `{ scope, visit }` | Canonical private visit document; UUID idempotent, no server time-window merging |
| `collections.saveToCollection` | `{ scope, localId, savedAt, snapshot, visitLocalId?, venueId?, venueName?, gallery?, objectId?, artworkId?, scanId?, suggested }` | `{ collectionId, updatedAt, updatedBy, deletedAt? }`; preserves the immutable snapshot and records eligible scan confirmation once |
| `collections.listMine` / `remove` | `{ scope, cursor?, limit? }` / `{ scope, localId }` | `{ page, cursor, isDone }` / `null`; terminal deletion invalidates publication references |
| `profiles.create` | `{ username, name, bio? }` | Public profile; repeated creation returns the original profile and username |
| `profiles.update` | `{ name, bio? }` | Public profile; username is immutable; omitted bio clears it |
| `profiles.getPublic` | `{ profileId }` | Public profile or `null` for unavailable accounts |
| `profiles.search` | `{ query, cursor?, limit? }` | `{ page, cursor, isDone }`, normalized case/accent/whitespace full-text search |

`JournalVisit` is `{ localId, venueId, visitedOn, timeZone, startedAt?, endedAt?, reflection? }`.
`visitedOn` is a valid `YYYY-MM-DD` calendar day in an IANA time zone; actual capture/start/end
timestamps are retained. `JournalSave` contains `localId`, `savedAt`, `snapshot`, optional
`visitLocalId`/venue/catalog references, `note` and `deletedAt`. Parents arrive before saves.
Checkpoints are owner-scoped monotonic change versions, independent of wall clocks. Private
edits use server last-write stamps (`updatedAt`, `updatedBy`); photo arrivals advance the change
version without changing those edit stamps. Clients discard responses from previous scopes.
Private JPEG transfer uses authenticated `/collection-photo?scope=…&localId=…&kind=photo|crop`
GET/POST, with a 10 MiB limit; the client cannot attach arbitrary storage IDs.

Public profiles allow only `profileId`, username, name, optional bio and `publishedWallCount`.
Artwork projections allow title, artist, date, medium and eligible media. Shared-visit cards
never include artwork notes; wall notes require explicit visibility consent. Public media is
an eligible catalog URL or a contextual derivative reference (`wallItem` or `sharedVisit`)
with dimensions, source and rights metadata. Private storage IDs and owner-photo URLs are
excluded. Missing, revoked or ineligible imagery renders a square placeholder.

Foundation owns both schemas, claims, ownership/access helpers, profile APIs, journal sync,
photo ownership, shared limits/errors/projections, and city/ISO alpha-2 country plumbing.
The venue pipeline and bundled SQLite schema preserve absent geography as absent values.
Journal owns future history/detail screens and APIs; wall owns layout/publication workflows;
social owns accepted friendships, blocks and shared-visit workflows; media/reporting own
image delivery and submission. Their tables, indexes, independent revisions and reusable
validators exist, but **no callable wall, friendship, feed, shared-publication, public-media or
reporting endpoints are registered**. Publication requires a linked account and explicit
profile; shared visits require accepted friendship with neither direction blocked. Registered
anonymous devices can be report owners; reporting must check target accessibility.

Shared bounds are in `shared/journal/limits.ts`: pages default 20/max 50, cursor 8 KiB,
search 2–100 characters, profile name 1–60/bio 160/username 3–30, private notes and reflections
20,000, snapshot fields 10,000, wall selections 100, post selections 50, accepted friends 200,
shared reflection 1,200, city 120, report reason 1–120/details 2,000. Validators also check
UUIDs, dates, zones, timestamps, revisions, dimensions and layout numbers. Future mutations
must enforce capacity and revision checks transactionally and call the shared access helpers.

This is a pre-release schema break: use a fresh local app database. The initialization SQL is
regenerated directly; there is no legacy migration path. Refresh the migration entry module
when regenerating SQL so Metro invalidates the inline SQL transform cache. The foundation targets development
`usable-owl-256`; it has not been released to the production backend described above.

## Rebuild the index from scratch

After the backend and jobs setup above, start in `scripts/data/` on an Apple silicon Mac with `uv`
installed. The commands below build and import a 1,000-object pilot. For the full corpus, omit
`--limit 1000` in steps 4 and 5. If a pilot already exists, use a new `SCRATCH_DIR` and repeat
step 3 before starting the full build: checkpoints cannot mix pilot and full runs.
`scripts/data/README.md` covers setup and common workflows; each job's `--help` lists its flags.

1. **Export the model** ([scripts/model/README.md](scripts/model/README.md)). Recreates the
   int8 weights and writes `fakequant_state.pt`, which gives the index the phone's rounding.
   Exporting takes about 20 s after the 546 MB checkpoint download. From `scripts/data/`:

   ```sh
   cd ../model
   uv sync
   uv run python export_coreml.py --out out/
   cd ../data
   ```

   This leaves the tracked iOS model unchanged. Run `scripts/model/compile-model.sh` from the
   repository root only when replacing the app's compiled model, then commit its LFS files and manifest.
2. **Seed venues**, if not done above:
   `uv run python -m pipeline.seed_venues --all --out out/ --publish`, then
   `cp out/venues.db ../../assets/venues.db`. The full seed contains 42,452 museums and galleries
   with coordinates and a website from Wikidata; an 8.6 MB SQLite the app bundles.
3. **Corpus metadata**, from `scripts/data/`:

   ```sh
   uv run python -m pipeline.sources.fetch --met --aic --aic-live
   uv run python -m pipeline.sources.fetch --wikidata
   uv run python -m pipeline.build_metadata --sources met,aic,wikidata
   ```

   About 405k artworks, 410k objects and 296k
   placements with `rightsStatus` and `multiplicity`. The Met's per-object API at one request per
   second takes about 90 minutes; the Wikidata census is 883 batched queries.
4. **Download, drift-check, embed**:

   ```sh
   uv run python -m pipeline.build_index --stage download,drift,embed --limit 1000
   ```

   Every build checks the job model against the committed iPhone reference (mean cosine 0.997,
   min 0.993, thresholds 0.99 and 0.97). One shard of up to 10,000 images exists at a time
   and is deleted once embedded; no image outlives the build. About 1.6 days of wall clock for the
   full corpus's Commons images at the Wikimedia robot policy's rate (embedding runs at about 65 images/s on an
   M5 Pro). Compute cost $0 locally.
5. **Dedupe and import preparation**:

   ```sh
   uv run python -m pipeline.build_index --stage dedupe
   ```

   [Hub scoring is deferred](docs/todos/hub-scoring/README.md) as of 2026-09-12.
   Sample exports and imports require no penalty artifacts; the importer assigns zero
   hub penalties. A development/preview sample can contain 1,000 surviving paintings
   across sources, retaining alternate views and related metadata.
   See [the import workflow](scripts/data/README.md#small-corpus-for-development-and-previews).
6. **Enrichment:** run the [batch fact-sheet and docent worker](scripts/data/README.md#enrichment)
   to populate the cache. The app also generates and caches missing fact sheets and prose
   on the first identification of each artwork (`docent.ensure`).

Measured per-call Token Factory costs at the 2026-09-08 list prices: Kimi label read about
$0.002, Super fact sheet about $0.0012, Lightning docent call about $0.00007, Lightning
moderation call about $0.00001. Tavily: one credit per search. Nebius compute for the build: $0.

## Data sources and terms

| Source | Use and terms |
|---|---|
| The Met Open Access | CC0. Paintings marked public domain with an API image URL; thumbnails hotlinked from the Met's CDN, never copied |
| Art Institute of Chicago API | Metadata only (CC0 fields; `description` is CC BY 4.0), including current on-view placements. The IIIF image host answers identified requests with 403, so no AIC image is embedded or shown |
| Wikidata and Wikimedia Commons | Wikidata is CC0; Commons files carry their own rights. Paintings with a `P18` image are embedded from standard thumbnail renditions fetched under the Wikimedia robot policy (two connections, at most 25 Mbps, never an original) and deleted after embedding. Commons thumbnails are hotlinked only for artworks the rights rule classifies as public domain |
| Museum websites | Never crawled. One page is fetched on a visitor's request (a QR code, an accession lookup, a search candidate), only on the venue's own hosts, with an identified User-Agent, per-device rate limits and the daily cap; the per-museum opt-out registry is checked before every fetch. Nothing fetched is stored |
| WikiArt (`huggan/wikiart`) | Not used: unknown license limited to non-commercial research, and no stable artwork identities |
| Tavily, Convex, Nebius Token Factory | Under their API terms. Keys live only in Convex environment variables and the gitignored `.env.local` |

Museum images are retained only in temporary build scratch and deleted after embedding.
Rights classification is implemented in `scripts/data/pipeline/rights.py`;
[data-source findings](docs/experiments/README.md#data-sources) record the evidence and limits.

## Privacy

- **A scan sends no pixels.** The phone crops, embeds and extracts ORB descriptors itself and
  sends a 1,536-float vector, the descriptors and keypoints, the model version, the venue, the
  visit and the capture time (about 20 KB). None of it can be turned back into the photo.
- **Seeded venue lookup runs on the phone.** After a one-shot While Using location fix, the
  app finds nearby rows in its bundled venue table and sends the selected venue id to Convex.
  If there is no nearby match, it sends a search area centered on the device's coordinates to
  Apple's [MapKit search service](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/EnablingSearch/EnablingSearch.html).
  Confirming a returned place sends that place's name, coordinates and optional website to
  Convex to register the venue; the device's GPS fix is not sent to Convex.
- **Three images can leave the phone, each at the visitor's request:** the label photo (read by
  the vision model, not retained), the artwork crop for museum-site search (after a one-time
  consent that Settings can revoke; not stored), and a contribution crop of at most 256 px the
  visitor chooses to share, the only image the system keeps, as the card thumbnail for the next
  visitor.
- **Identity is the device:** an App Attest key Apple binds to one install on one iPhone.
  Contributions, rejections and venue confirmations carry an assertion, are rate-limited per
  device and stay private until promoted. Sign in with Apple is optional and only syncs the
  collection between devices; an account is never required to scan, save or contribute.
- **The collection is local-first**, in SQLite on the phone. Saved photos and crops back up privately to Convex file storage; collection rows hold storage IDs. Authenticated `/collection-photo` uploads and downloads check the caller's collection ownership. Cloud copies are JPEGs (up to 2,560 px for photos, 512 px for crops), without camera/location metadata. Linked devices download them for offline viewing; originals remain on the capturing phone. Retries are idempotent, and deletion removes stored files once no active collection copy references them.

## Development

Run these commands from the repository root:

```sh
npm run typecheck                                    # tsc --noEmit
npm run lint                                         # expo lint (ESLint)
npm test                                             # Jest (src/, modules/, shared/), Vitest + convex-test (convex/), model validation tests
(cd scripts/data && uv run pytest -q && uv run ruff check .)   # Python jobs
npx convex dev --once                                # push backend functions to your deployment
npx convex codegen                                   # after a schema or function-signature change; commit convex/_generated/
npm run ios                                          # reopen the installed dev client on a Simulator or device
```

Layout: `src/` (Expo Router app; pure logic under `src/lib/`, Drizzle + expo-sqlite under
`src/db/`), `modules/` (native modules `vision-rect`, `coreml-embed`, `poi-search`), `convex/`
(backend, pure libraries under `convex/lib/`), [`scripts/data/`](scripts/data/README.md) (Python data
pipeline), `shared/` (contracts shared by phone, backend and jobs), `scripts/model/` (CoreML export),
[`scripts/model/benchmark/`](scripts/model/benchmark/README.md) (iPhone model measurements),
[`scripts/evals/token-factory/`](scripts/evals/token-factory/README.md) (model quality comparisons),
[`docs/`](docs/README.md) (experiment findings, operations, hackathon materials, and open work).
Agent guide: [AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
