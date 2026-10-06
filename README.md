# Artlog — an art identifier for museum-goers

Point your iPhone at a painting and Artlog names it in about a second: title, artist, date,
medium and institution, saved to a private collection tied to the visit where you found it.
Identification is visual retrieval, not a language model guessing from pixels. The phone embeds
the painting with NVIDIA's C-RADIOv3-B, a versioned Pinecone index returns candidates, ORB
descriptors and a homography verify them, and a small calibrator decides whether to say
_confident_, _soft_ or _unidentified_. When a work is not in the index, the app reads the wall
label on the phone, verifies what it read against the museum's records or Wikidata and, when
the visitor saves the confirmed work, adds it to a shared
index so the next visitor gets an instant match. Nemotron on Nebius Token Factory writes the cited
"about this work" text once per artwork; Tavily finds museum-site evidence and fact-sheet
sources. A scan taken with no signal waits on the phone and is identified when the connection
returns.

Built for the Nebius × NVIDIA Global AI Hackathon. iOS only.
[Open work](docs/todos/) and [experiment findings](docs/experiments/README.md).

## Demo

- **TestFlight public link:** _PLACEHOLDER — available once Beta App Review clears._
- **Video (under 3 minutes, YouTube):** _PLACEHOLDER._
- Hackathon deliverables: [event requirements](docs/hackathon/README.md),
  [feedback notes](docs/hackathon/feedback-notes.md),
  [submission checklist](docs/todos/hackathon/README.md).

The app opens to the camera with no account; anyone with the TestFlight build can scan within
seconds.

## Where NVIDIA and Nebius are used

| Component                    | Model / service                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Code                                                                                                                                | Runs                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image embedding, every scan  | **NVIDIA C-RADIOv3-B**, DINOv2 adaptor summary, 512 px input, its 1,536-d output reduced in the model to 512 dims by a corpus-fitted PCA, exported to CoreML with int8 weights and fp16 compute (`modelVersion` `c-radiov3-b-int8-512-dinov2-pca512-v1`)                                                                                                                                                                                                         | `modules/coreml-embed/`, export recipe in `scripts/model/`                                                                          | On the phone's Neural Engine, about 67 ms per crop on an iPhone 16 Pro. Normal identification sends features without uploading the crop                                                                                                                                                                      |
| Image embedding, index build | The **same weights**: the int8 state recovered from the CoreML export, dequantized to fp16, gated by a drift check against 200 committed iPhone reference embeddings before every build                                                                                                                                                                                                                                                                          | `scripts/data/pipeline/model.py`, `embed.py`, `drift_check.py`                                                                      | On the operator's Mac (see below)                                                                                                                                                                                                                                                                            |
| Fact sheets                  | **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`, `FACT_SHEET_MODEL`) extracts visual, technical and historical research from full page content, each fact citing the owner's page or the Art Institute's API text, Wikidata, the work's linked Wikipedia articles a score-filtered Tavily result or a reviewed reference attached to the exact Wikidata/Commons record                                                                          | `convex/docent.ts`, sources in `convex/lib/docentSources.ts`                                                                        | Token Factory, live on the first identification of an artwork with no cached fact sheet; cached on the artwork afterwards                                                                                                                                                                                    |
| Docent prose                 | **NVIDIA Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`, `DOCENT_MODEL`) writes three or four English sentences citing only those facts; a validator drops any sentence without a valid citation                                                                                                                                                                                                                                                      | `convex/docent.ts`, `convex/lib/docentValidator.ts`                                                                                 | Token Factory, once per artwork, then cached and served with the card                                                                                                                                                                                                                                        |
| Audio-guide scripts          | **NVIDIA Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`) writes an independent 40- to 90-second audio-guide stop from the shared research: it names the stop's thread and best quote first, then a hook, what to look at, the strongest supported story and a takeaway in short spoken sentences after a label-style opening, every sentence cited with an evidence span that Convex checks verbatim against the research                               | `convex/narration.ts`, `shared/audio/guide.ts`                                                                                      | Token Factory on first listen, without reasoning; a rejected script is retried once with its problems named; scripts and their citations are cached per artwork and outlive a speech failure or a voice change; only new research or a new opening rewrites one                                              |
| Spoken narration             | **OpenAI GPT-4o mini TTS** (`gpt-4o-mini-tts-2025-12-15`), **Shimmer** voice, with museum-guide delivery instructions                                                                                                                                                                                                                                                                                                                                            | `convex/narration.ts`, `shared/audio/speech.ts`                                                                                     | Convex generates MP3 audio from the spoken guide and keeps one rendering per artwork, re-rendering when its research, title, model or voice changes (`npx convex run narration:clear` re-renders everything after a prompt change); the phone caches audio with its matching transcript for repeat listening |
| Text moderation              | **NVIDIA Nemotron 3.5 Lightning** (`MODERATION_MODEL`) screens label fields, museum-page fields and contributions before they reach a screen or the shared index                                                                                                                                                                                                                                                                                                 | `convex/lib/moderation.ts`                                                                                                          | Token Factory, live on every label read and contribution                                                                                                                                                                                                                                                     |
| Post moderation              | **OpenAI omni-moderation** (`omni-moderation-latest`) checks comments, published visit reflections, wall notes and profile bios before anyone else sees them; titles of the linked museum records are swapped for "the artwork" first, slurs and the strongest swearing are always blocked, and the word list in `shared/social/offensive-text.ts` answers when OpenAI fails or takes over 3 s                                                                   | `convex/lib/moderation.ts`                                                                                                          | OpenAI, live on every comment, publish, note share and bio save; names and usernames use the full word list, and hand-typed artwork titles on public walls and posts drop only slurs and the strongest swearing                                                                                              |
| Label reading                | Apple Vision text recognition on the phone reads the wall label; **NVIDIA Nemotron 3 Super** (`LABEL_MODEL`) sorts the printed lines into title, artist, dates, medium, accession and credit line. Title and artist both correct on 21 of 25 test labels from the recognizer's lines (Mac harness, same Vision recognizer as the phone), against 24 of 25 for the retired vision model reading the photo; two of the four misses are OCR errors (`II` read as `I | `, a dropped accent) and two are labels naming several makers ([model evaluation](docs/experiments/README.md#token-factory-models)) | `modules/vision-rect/ios/TextRecognizer.swift`, `convex/label.ts`, prompt in `convex/lib/labelPrompt.ts`                                                                                                                                                                                                     | OCR on the phone (median 121 ms on the Mac harness; not yet timed on an iPhone); the sort on Token Factory, live on every label capture. The label photo never leaves the phone |
| Token Factory client         | OpenAI-compatible chat completions at `api.tokenfactory.nebius.com/v1` with strict `json_schema` output; thinking is disabled on every request; per-device rate limits and a global daily call cap                                                                                                                                                                                                                                                               | `convex/lib/tokenFactory.ts`, `convex/lib/spend.ts`                                                                                 | From Convex actions only; the phone never calls a model provider                                                                                                                                                                                                                                             |
| Nebius Serverless AI Jobs    | Measured with three probe jobs: an L40S job, a lifecycle-managed scratch bucket and a service-account REST path ([findings](docs/experiments/README.md#batch-infrastructure))                                                                                                                                                                                                                                                                                    | [archived probes](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/nebius-jobs)           | **Not on any production path.** See the next paragraph                                                                                                                                                                                                                                                       |

**Where the index was actually built.** The corpus build ran on the operator's Mac (Apple M5 Pro, PyTorch on the
MPS backend, fp16), shard by shard with the same fake-quantized weights the phone runs, because
the Wikimedia Commons download sets the wall clock, not GPU time, and the Commons robot policy
applies wherever the job runs ([scripts/data/README.md](scripts/data/README.md), "Index build"). No Nebius job
has embedded, enriched or migrated the index; the only Nebius compute spent was three
probe jobs, about $0.20. Nothing idles on Nebius by design: the request path is the phone and
Convex, and what runs on Nebius is Token Factory, live, on every label read, every moderation
check and the first identification of every uncached artwork. These identification and enrichment paths use NVIDIA models; audio-guide
scripts also use Nemotron, with OpenAI TTS speaking the resulting cited script.

## Tavily

Tavily supports the runtime calls below and the batch enrichment worker. Runtime features
sit behind feature flags; runtime and batch calls share a daily credit cap
(`DAILY_TAVILY_CREDIT_CAP`, reserved atomically before each call). Visual index matching
does not depend on Tavily.

| Call                | Code                                                                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label verification  | `convex/label.ts`                                                        | When the accession and Wikidata checks fail, one museum-scoped search for the label's title and artist; a page image is confirmed on the phone the same way. `FLAG_LABEL_FLOW`, on by default                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fact-sheet research | `convex/docent.ts` through `convex/lib/docentSources.ts`                 | One basic search requests full page content from approved and verified owner domains; thin research allows one fallback using an accession, alternate title or broader query. Museum essays must link to the work or match its owner, accession, title and artist. Up to five HTTPS citations from the exact Wikidata item and its linked Commons file are read with Tavily Extract without a publisher allowlist; a Super review rejects unrelated/uncertain pages and holds artist/date conflicts for manual review. Extracted passages are checked against the source text. Docent and audio share cached research; listening adds no search |
| "Right now"         | `convex/rightNow.ts`, acceptance rules in `convex/lib/rightNowAccept.ts` | One search with `include_answer`, `topic: news`, a one-month window and the venue region's domain list; a sentence is shown only when the cited source contains it and names an explicit event date. `FLAG_RIGHT_NOW`, **off by default** following the [evaluation](docs/experiments/README.md#tavily-and-right-now)                                                                                                                                                                                                                                                                                                                           |

## Architecture

```text
                     ~20 KB per scan: vector + ORB descriptors, no pixels
 iPhone (Expo dev client) ────────────────────────────────▶ Convex (orchestrates the request path)
   camera → subject crop → CoreML C-RADIOv3-B → ORB           identify: Pinecone → ORB/RANSAC → calibrator
   wall label → Apple Vision OCR (text lines only leave)       label: Nemotron sorts lines → accession · Wikidata · Tavily
   venue table (SQLite, on device) · local collection         label · docent · rightNow actions
   App Attest key · offline scan queue  ◀── scans ────────    multi-view promotion · sync · rate limits · spend caps
                                          subscription             │                 │              │
                                                                   ▼                 ▼              ▼
                                                        Nebius Token Factory       Tavily      one page on the
                                                        (Nemotron)                             venue's own hosts

 Mac, batch, runs to completion (scripts/data/):
   seed venues → corpus metadata → download / drift check / embed → dedupe / hubs → push ──▶ Convex
```

File bytes (photos, ORB descriptors, narration, and museum packages) live in private
Cloudflare R2 storage. Convex tracks ownership and file metadata; Pinecone handles
vector retrieval. See [R2 setup and delivery](docs/storage.md).

## Run the app against the hosted backend

You need macOS with Xcode 26, Node 22.13 or newer, and a physical iPhone on iOS 17 or later
(scanning and the label flow need the camera).

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
checks are in the [release checklist](docs/todos/release/README.md). Scanning, saving and the
label flow work from any build.
Writes to the shared index (contributions, rejections, venue confirmations) are signed with App
Attest, which Apple binds to our Team ID, so a build signed by another team is refused for those;
use the TestFlight build, or run your own backend.

### Test a Conductor workspace

Select the workspace to test, then choose an action from Conductor's **Run** menu:

| Action            | What it does                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iOS** (default) | Starts this workspace's Expo server and opens the installed development build in the iOS Simulator.                                                 |
| **iPhone**        | Starts this workspace's Expo server and displays a QR code. Scan it with your iPhone's Camera while the phone and Mac are on the same Wi-Fi.        |
| **Rebuild iOS**   | Regenerates the iOS project, then builds and installs a development client. Choose a simulator or connected iPhone in the terminal's device picker. |

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

| Variable                                                               | What it does                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEBIUS_API_KEY`                                                       | Token Factory key for the label flow, moderation, fact sheets, docent prose and audio-guide scripts                                                                                                                                               |
| `OPENAI_API_KEY`                                                       | OpenAI key for Shimmer narration and post moderation; set on the Convex deployment with `npx convex env set OPENAI_API_KEY` (paste the key at the prompt). A local `.env.local` entry alone does not configure the deployed backend               |
| `LABEL_MODEL`, `FACT_SHEET_MODEL`, `DOCENT_MODEL`, `MODERATION_MODEL`  | Model IDs: `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3_5-Lightning`                                                                                             |
| `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`                              | Pinecone project API key and dedicated index host. Create a dense 512-dimensional cosine index in AWS `us-east-1` for Starter; use separate indexes for dev and production. Set both on Convex; local entries alone do not configure the backend. |
| `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Private Cloudflare R2 bucket and bucket-scoped Object Read & Write credentials. Set all four on Convex; see [storage setup](docs/storage.md).                                                                                                     |
| `TAVILY_API_KEY`                                                       | Tavily key for the three calls above                                                                                                                                                                                                              |
| `DAILY_TOKEN_FACTORY_CALL_CAP`, `DAILY_TAVILY_CREDIT_CAP`              | Global daily spend caps; defaults are 2,000 calls and 2,000 credits                                                                                                                                                                               |
| `FLAG_LABEL_FLOW`, `FLAG_RIGHT_NOW`                                    | `on` / `off` kill switches; "Right now" defaults off                                                                                                                                                                                              |
| `SUPPORTED_MODEL_VERSIONS`                                             | Embedding versions `identify` accepts; an older client is told to update                                                                                                                                                                          |
| `APP_ATTEST_REQUIRED`, `APP_ATTEST_APP_ID`, `APP_ATTEST_ALLOW_DEV`     | App Attest for shared writes: `true` in production, `TEAMID.app.artlog.ios`, and whether Apple's development environment is accepted. Leave `APP_ATTEST_REQUIRED` unset on a personal dev deployment                                              |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `APPLE_BUNDLE_ID`               | Convex Auth keys (generate headlessly with jose) and the audience for Sign in with Apple tokens                                                                                                                                                   |
| `CRAWLER_CONTACT`, `MODERATION_BLOCKLIST`                              | Contact address in the page fetcher's User-Agent; optional additions to the moderation blocklist                                                                                                                                                  |

Pinecone stores search vectors in one `recognition` namespace, filtered by model and venue.
R2 archives embedding payloads for offline packages, training exports, and rebuilding.
Convex keeps artwork metadata, vector identities, and archive references. A transactional queue synchronizes inserts,
updates, promotions, and deletes. Match hydration rejects stale versions and rechecks eligibility.
See [Pinecone operations](docs/pinecone.md) for rebuilding and checking sync.

An empty deployment has no venues and no indexed vectors. The Python jobs fill it
([scripts/data/README.md](scripts/data/README.md)):

Before running the jobs, add `CONVEX_URL` to `.env.local` with the same literal URL as
`EXPO_PUBLIC_CONVEX_URL` written by the CLI. The token command below writes only the deploy key.

```sh
npx convex deployment token create artlog-jobs-local --deployment dev --save-env   # CONVEX_DEPLOY_KEY into .env.local
cd scripts/data && uv sync
uv run python -m pipeline.smoke                                       # prints the torch device and live table counts
uv run python -m pipeline.seed_venues --countries US --out out/   # or --all for the full 42k-venue census
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
Deleting data, by a guest or an account, retires each affected device: its auth user goes, so the phone signs in again
as a new device, and the deleting phone erases its local data. Journals, sessions and contribution crops are purged in
the background; scans and contribution label details stay on the unlinked device row.

Implemented APIs (derive wire types from `convex/_generated/api` or the shared validators):

| API                               | Arguments                                                                                                                         | Return / behavior                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.me`                     | `{}`                                                                                                                              | `{ linked, deviceCount, accountId, email, scope }`                                                                                 |
| `journalClaims.resume`            | `{ scope }`                                                                                                                       | `{ claimId, complete, moved }`; server chooses the target account                                                                  |
| `sync.syncJournal`                | `{ scope, since, visits, saves }`                                                                                                 | `{ visits, saves, acceptedVisits, acceptedSaves, checkpoint, hasMore }`; at most 50 records / 512 KiB each direction               |
| `visits.upsertJournal`            | `{ scope, visit }`                                                                                                                | Canonical private visit document; UUID idempotent, no server time-window merging                                                   |
| `collections.saveToCollection`    | `{ scope, localId, savedAt, snapshot, visitLocalId?, venueId?, venueName?, gallery?, objectId?, artworkId?, scanId?, suggested }` | `{ collectionId, updatedAt, updatedBy, deletedAt? }`; preserves the immutable snapshot and records eligible scan confirmation once |
| `collections.listMine` / `remove` | `{ scope, cursor?, limit? }` / `{ scope, localId }`                                                                               | `{ page, cursor, isDone }` / `null`; terminal deletion invalidates publication references                                          |
| `profiles.create`                 | `{ username, name, bio? }`                                                                                                        | Public profile; repeated creation returns the original profile and username                                                        |
| `profilePhotos.save`              | `{ name, username?, bio?, photo? }`                                                                                               | Public profile; omitted username or photo is kept, a new username must be free; omitted bio clears it; `photo: null` removes it    |
| `profiles.getPublic`              | `{ profileId }`                                                                                                                   | Public profile or `null` for unavailable accounts                                                                                  |
| `profiles.search`                 | `{ query, cursor?, limit? }`                                                                                                      | `{ page, cursor, isDone }`, normalized case/accent/whitespace full-text search                                                     |
| `artworks.search`                 | `{ query, cursor?, limit? }`                                                                                                      | `{ page, cursor, isDone }` of shown catalog works matching title and artist words; public-domain pictures only                     |
| `artists.search` / `works`        | `{ query }` / `{ artistId, cursor?, limit? }`                                                                                     | Up to 3 artists (normalized name, work count, a public-domain work as avatar) / that artist's catalog works                        |

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
   `uv run python -m pipeline.seed_venues --all --out out/`, then
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
   on identification when a description is missing (`docent.ensure`). Empty cached research
   is rebuilt; valid research is reused when only the paragraph is missing. The batch worker
   includes missing descriptions on contributed and currently on-view artworks.

Measured per-call Token Factory costs at the 2026-09-08 list prices: Super label sort about
$0.0004, Super fact sheet about $0.0012, Lightning docent call about $0.00007, Lightning
moderation call about $0.00001. Tavily: one credit per search and up to two credits for a batch of five advanced reference extractions. Reference-bearing research adds one Super review call. Nebius compute for the build: $0.

## Data sources and terms

| Source                                                                | Use and terms                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Met Open Access                                                   | CC0. Paintings marked public domain with an API image URL; thumbnails hotlinked from the Met's CDN, never copied                                                                                                                                                                                                                                               |
| Art Institute of Chicago API                                          | Metadata (CC0 fields), including current on-view placements. When a Chicago work's fact sheet is built, its CC BY 4.0 `description` and `short_description` are read from the API; facts quote them verbatim and link to the artwork page. The IIIF image host answers identified requests with 403, so no AIC image is embedded or shown                      |
| Wikidata and Wikimedia Commons                                        | Wikidata is CC0; Commons files carry their own rights. Paintings with a `P18` image are embedded from standard thumbnail renditions fetched under the Wikimedia robot policy (two connections, at most 25 Mbps, never an original) and deleted after embedding. Commons thumbnails are hotlinked only for artworks the rights rule classifies as public domain |
| Wikipedia                                                             | Text is CC BY-SA 4.0. Research reads the linked English article and, when thin, at most one linked article in another supported language (MediaWiki plain text at scan time, lead paragraphs in the batch job). Facts quote the original language and link back; the docent is written in English                                                              |
| Artwork reference pages                                               | Up to five public HTTPS pages explicitly cited by the exact Wikidata item or its linked Commons file, retrieved through Tavily advanced Extract. Used for attributed, verbatim research passages with both source and referring URLs retained; each publisher’s copyright and terms apply. Identity and attribution are reviewed before use.                   |
| Museum websites                                                       | Never crawled. One page is fetched on a visitor's request (a QR code, an accession lookup, a search candidate), only on the venue's own hosts, with an identified User-Agent, per-device rate limits and the daily cap; the per-museum opt-out registry is checked before every fetch. Nothing fetched is stored                                               |
| Bundled app images                                                    | Public-domain or CC0 reproductions from The Met, the Art Institute of Chicago and Wikimedia Commons: onboarding examples, and 36 preset profile pictures redrawn in crayon with OpenAI `gpt-image-2` when the assets were made. Each folder's `credits.md` lists every work and source; these app assets are separate from the recognition corpus              |
| WikiArt (`huggan/wikiart`)                                            | Not used: unknown license limited to non-commercial research, and no stable artwork identities                                                                                                                                                                                                                                                                 |
| Tavily, Convex, Cloudflare R2, Pinecone, Nebius Token Factory, OpenAI | Under their API terms. Keys live only in Convex environment variables and the gitignored `.env.local`. OpenAI receives the artwork narration text and, for moderation, the comments, reflections, notes and bios people share; the player discloses that its voice is AI-generated                                                                             |

Museum images are retained only in temporary build scratch and deleted after embedding.
Rights classification is implemented in `scripts/data/pipeline/rights.py`;
[data-source findings](docs/experiments/README.md#data-sources) record the evidence and limits.

## Privacy

- **A scan sends no pixels.** The phone crops, embeds and extracts ORB descriptors itself and
  sends a 512-float vector, the descriptors and keypoints, the model version, the venue, the
  visit and the capture time (about 20 KB). None of it can be turned back into the photo.
- **Seeded venue lookup runs on the phone.** After a one-shot While Using location fix, the
  app finds nearby rows in its bundled venue table and sends the selected venue id to Convex.
  If there is no nearby match, it sends a search area centered on the device's coordinates to
  Apple's [MapKit search service](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/EnablingSearch/EnablingSearch.html).
  Confirming a returned place sends that place's name, coordinates and optional website to
  Convex to register the venue; the device's GPS fix is not sent to Convex.
- **One image can leave the phone, after a visitor action:** a contribution crop of at most
  256 px shared automatically when a confirmed work is saved and withdrawable in Settings, the
  only image the system keeps, as the card thumbnail for the next visitor. The label photo is
  read on the phone and only its text lines are sent; label verification downloads a museum
  page's images to the phone to compare them and uploads none.
- **Identity is the device:** an App Attest key Apple binds to one install on one iPhone.
  Contributions, rejections and venue confirmations carry an assertion, are rate-limited per
  device and stay private until promoted. Sign in with Apple is optional and only syncs the
  collection between devices; an account is never required to scan, save or contribute.
- **Crash and handled-error reports from production go to Sentry.** Only the EAS production
  environment (`EXPO_PUBLIC_SENTRY_DSN`) and the production Convex deployment (`SENTRY_DSN`) set a
  DSN; leave both unset everywhere else so other builds and deployments send nothing. Reports
  include stack traces, device model, OS and app version, operation names, route templates and
  diagnostic breadcrumbs. Console output and request payloads are excluded; URLs, credentials and
  SQL parameters are redacted.
  No photos, screenshots or location fixes are attached. An error also uploads a screen replay
  starting about a minute before it. Sentry masks text and images; camera previews,
  Skia canvases, maps and SwiftUI hosts showing personal data sit inside `Sentry.Mask`, so only
  fixed control labels stay readable. Traces time app start and screen loads; request spans keep
  only the host.
  Backend actions send allowlisted error codes and code locations directly to Sentry (no Pro
  integration needed).
  Backend reports omit raw error messages, function arguments and console output. Delivery
  is best-effort and bounded to 1.5 seconds; Convex logs remain the fallback. Direct query
  and mutation failures reach app Sentry with Convex's production redaction. Background mutation
  failures and hard timeouts remain in Convex logs; no follow-up monitoring jobs are scheduled.
  Run `observability:verify` on production to check delivery.
- **The collection is local-first**, in SQLite on the phone. Saved photos and crops back up privately to Cloudflare R2; collection rows reference Convex file metadata. Authenticated `/collection-photo` uploads and downloads check the caller's collection ownership. Cloud copies are JPEGs (up to 1,080 px wide for photos, 512 px for crops), without camera/location metadata. Linked devices download them for offline viewing; originals remain on the capturing phone. Retries are idempotent, and deletion removes stored files once no active collection copy references them.

## Development

Run these commands from the repository root:

```sh
npm run typecheck                                    # tsc --noEmit
npm run lint                                         # oxlint, plus an oxfmt format check
npm run format                                       # format code, JSON, Markdown and TOML with oxfmt
npm test                                             # Jest (src/, modules/, shared/), Vitest + convex-test (convex/), model validation tests
(cd scripts/data && uv run pytest -q && uv run ruff check .)   # Python jobs
npx convex dev --once                                # push backend functions to your deployment
npx convex codegen                                   # after a schema or function-signature change; commit convex/_generated/
npm run ios                                          # reopen the installed dev client on a Simulator or device
npm run licenses:generate                            # after dependency changes: rebuilds the open source notices the backend serves from a prebuilt ios/
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

Mozilla Public License 2.0 — see [LICENSE](LICENSE). Notices for the open source libraries in the app build are
generated into `convex/lib/thirdPartyNotices.json` and served by the backend at `/licenses`, linked from
Settings → About → Open source licenses.

The bundled C-RADIOv3-B model is licensed separately under the
[NVIDIA Open Model License Agreement (June 14, 2024)](modules/coreml-embed/ios/model-notices/c-radio-v3-b/nvidia-open-model-license.pdf).
The complete agreement and required [Notice](modules/coreml-embed/ios/model-notices/c-radio-v3-b/Notice.txt)
are included in the repository and packaged in the iOS app's `model-notices/c-radio-v3-b/` resources.
