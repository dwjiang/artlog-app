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

iOS only. [Documentation](docs/README.md) covers operations and technical findings.

Scanning requires no account.

## Where NVIDIA and Nebius are used

| Component                    | Model / service                                                                                                                                                                                                                                                                                                                                                                                                                    | Code                                                                                                     | Runs                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image embedding, every scan  | **NVIDIA C-RADIOv3-B**, DINOv2 adaptor summary, 512 px input, its 1,536-d output reduced in the model to 512 dims by a corpus-fitted PCA, exported to CoreML with int8 weights and fp16 compute (`modelVersion` `c-radiov3-b-int8-512-dinov2-pca512-v1`)                                                                                                                                                                           | `modules/coreml-embed/`, export recipe in `scripts/model/`                                               | On the phone's Neural Engine, about 67 ms per crop on an iPhone 16 Pro. Normal identification sends features without uploading the crop                                                                                                                                                                      |
| Image embedding, index build | The **same weights**: the int8 state recovered from the CoreML export, dequantized to fp16, gated by a drift check against 200 committed iPhone reference embeddings before every build                                                                                                                                                                                                                                            | `scripts/data/pipeline/model.py`, `embed.py`, `drift_check.py`                                           | On the operator's Mac (see below)                                                                                                                                                                                                                                                                            |
| Fact sheets                  | **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`, `FACT_SHEET_MODEL`) extracts visual, technical and historical research from full page content, each fact citing the owner's page or the Art Institute's API text, Wikidata, the work's linked Wikipedia articles a score-filtered Tavily result or a reviewed reference attached to the exact Wikidata/Commons record                                            | `convex/docent.ts`, sources in `convex/lib/docentSources.ts`                                             | Token Factory, live on the first identification of an artwork with no cached fact sheet; cached on the artwork afterwards                                                                                                                                                                                    |
| Docent prose                 | **NVIDIA Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`, `DOCENT_MODEL`) writes three or four English sentences citing only those facts; a validator drops any sentence without a valid citation                                                                                                                                                                                                                        | `convex/docent.ts`, `convex/lib/docentValidator.ts`                                                      | Token Factory, once per artwork, then cached and served with the card                                                                                                                                                                                                                                        |
| Audio-guide scripts          | **NVIDIA Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`) writes an independent 40- to 90-second audio-guide stop from the shared research: it names the stop's thread and best quote first, then a hook, what to look at, the strongest supported story and a takeaway in short spoken sentences after a label-style opening, every sentence cited with an evidence span that Convex checks verbatim against the research | `convex/narration.ts`, `shared/audio/guide.ts`                                                           | Token Factory on first listen, without reasoning; a rejected script is retried once with its problems named; scripts and their citations are cached per artwork and outlive a speech failure or a voice change; only new research or a new opening rewrites one                                              |
| Spoken narration             | **OpenAI GPT-4o mini TTS** (`gpt-4o-mini-tts-2025-12-15`), **Shimmer** voice, with museum-guide delivery instructions                                                                                                                                                                                                                                                                                                              | `convex/narration.ts`, `shared/audio/speech.ts`                                                          | Convex generates MP3 audio from the spoken guide and keeps one rendering per artwork, re-rendering when its research, title, model or voice changes (`npx convex run narration:clear` re-renders everything after a prompt change); the phone caches audio with its matching transcript for repeat listening |
| Text moderation              | **NVIDIA Nemotron 3.5 Lightning** (`MODERATION_MODEL`) screens label fields, museum-page fields and contributions before they reach a screen or the shared index                                                                                                                                                                                                                                                                   | `convex/lib/moderation.ts`                                                                               | Token Factory, live on every label read and contribution                                                                                                                                                                                                                                                     |
| Post moderation              | **OpenAI omni-moderation** (`omni-moderation-latest`) checks comments, published visit reflections and profile bios before anyone else sees them; titles of the linked museum records are swapped for "the artwork" first, slurs and the strongest swearing are always blocked, and the word list in `shared/social/offensive-text.ts` answers when OpenAI fails or takes over 3 s                                                 | `convex/lib/moderation.ts`                                                                               | OpenAI, live on every comment, publish and bio save; names and usernames use the full word list, and hand-typed artwork titles on public walls and posts drop only slurs and the strongest swearing                                                                                                          |
| Label reading                | Apple Vision text recognition on the phone reads the wall label; **NVIDIA Nemotron 3 Super** (`LABEL_MODEL`) sorts the printed lines into title, artist, dates, medium, accession and credit line. OCR accuracy bounds the label sorter's input; labels with several makers can be ambiguous                                                                                                                                       | `modules/vision-rect/ios/TextRecognizer.swift`, `convex/label.ts`, prompt in `convex/lib/labelPrompt.ts` | OCR on the phone; the sort on Token Factory, live on every label capture. The label photo never leaves the phone                                                                                                                                                                                             |
| Exhibition listings          | **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) lists a museum's current and upcoming shows from its own listing pages, quoting each title, venue and date range; Convex keeps only shows whose quotes and dates it finds in the page                                                                                                                                                                            | `convex/exhibitionRefresh.ts`, acceptance rules in `shared/exhibitions/acceptance.ts`                    | Token Factory in the background, only when a listing's text has changed, within half of the daily call cap; `FLAG_EXHIBITION_REFRESH`, off by default                                                                                                                                                        |
| Token Factory client         | OpenAI-compatible chat completions at `api.tokenfactory.nebius.com/v1` with strict `json_schema` output; thinking is disabled on every request; per-device rate limits and a global daily call cap                                                                                                                                                                                                                                 | `convex/lib/tokenFactory.ts`, `convex/lib/spend.ts`                                                      | From Convex actions only; the phone never calls a model provider                                                                                                                                                                                                                                             |

The corpus build runs on the operator's Mac with PyTorch on the MPS backend,
shard by shard with the same fake-quantized weights the phone runs. Downloads
follow the Wikimedia Commons robot policy ([index build](scripts/data/README.md)).
Token Factory serves the runtime label, moderation, research, docent and audio-guide
requests and the background exhibition reads; OpenAI TTS speaks the cited guide scripts.

## Tavily

Tavily supports the runtime calls below and the batch enrichment worker. Runtime features
sit behind feature flags; runtime and batch calls share a daily credit cap
(`DAILY_TAVILY_CREDIT_CAP`, reserved atomically before each call). Visual index matching
does not depend on Tavily.

| Call                | Code                                                                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label verification  | `convex/label.ts`                                                        | When the accession and Wikidata checks fail, one museum-scoped search for the label's title and artist; a page image is confirmed on the phone the same way. `FLAG_LABEL_FLOW`, on by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Fact-sheet research | `convex/docent.ts` through `convex/lib/docentSources.ts`                 | One basic search requests full page content from approved and verified owner domains; thin research allows one fallback using an accession, alternate title or broader query. Museum essays, and other pages titled with the work's own title, must link to the work or match its owner, accession, title and artist; each source's facts are extracted separately, at most eight per source when several share the sheet. Up to five HTTPS citations from the exact Wikidata item and its linked Commons file are read with Tavily Extract without a publisher allowlist; a Super review rejects unrelated/uncertain pages and holds artist/date conflicts for manual review. Extracted passages are checked against the source text. Docent and audio share cached research; listening adds no search |
| "Right now"         | `convex/rightNow.ts`, acceptance rules in `convex/lib/rightNowAccept.ts` | One search with `include_answer`, `topic: news`, a one-month window and the venue region's domain list; a sentence is shown only when the cited source contains it and names an explicit event date. `FLAG_RIGHT_NOW`, **off by default**; the [acceptance findings](docs/experiments/README.md#tavily-and-right-now) explain its evidence requirements                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Exhibition listings | `convex/exhibitionRefresh.ts`                                            | Basic Tavily Extract, up to 20 pages per call, reads listing pages the backend reaches but cannot read as text (drawn by JavaScript, server errors); never pages that robots.txt or the site refuses. `FLAG_EXHIBITION_REFRESH`, **off by default**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
are described in the [deployment reference](docs/operations/production.md). Scanning, saving
and the label flow use that backend.
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
| `TAVILY_API_KEY`                                                       | Tavily key for the four calls above                                                                                                                                                                                                               |
| `DAILY_TOKEN_FACTORY_CALL_CAP`, `DAILY_TAVILY_CREDIT_CAP`              | Global daily spend caps; defaults are 2,000 calls and 2,000 credits                                                                                                                                                                               |
| `FLAG_LABEL_FLOW`, `FLAG_RIGHT_NOW`, `FLAG_EXHIBITION_REFRESH`         | `on` / `off` kill switches; "Right now" and background exhibition reads default off                                                                                                                                                               |
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

Wire types and limits come from [the shared journal contracts](shared/journal/) and
[the shared social contracts](shared/social/contracts.ts), with generated APIs in
`convex/_generated/api`. Visits retain a calendar day in an IANA time zone alongside
actual capture/start/end timestamps. Parents arrive before saves.
Checkpoints are owner-scoped monotonic change versions, independent of wall clocks. Private
edits use server last-write stamps (`updatedAt`, `updatedBy`); photo arrivals advance the change
version without changing those edit stamps. Clients discard responses from previous scopes.
Private JPEG transfer uses authenticated `/collection-photo?scope=…&localId=…&kind=photo|crop`
GET/POST, with a 10 MiB limit; the client cannot attach arbitrary storage IDs.

Public profiles expose selected identity, biography and display media while keeping
account and device identifiers private. Artwork projections expose catalog metadata
and eligible media. Public media is
an eligible catalog URL or a contextual derivative reference (`wallItem` or `sharedVisit`)
with dimensions, source and rights metadata. Private storage IDs and owner-photo URLs are
excluded. Missing, revoked or ineligible imagery renders a square placeholder.

The venue pipeline and bundled SQLite schema preserve absent geography as absent values.
Publication requires a linked account and explicit profile. Friends-only visits require
accepted friendship with neither direction blocked; public visits use their public
audience. Reporting checks target accessibility. See the [journal and social
contracts](docs/social-and-journal.md).

The [shared limits](shared/journal/limits.ts) bound pages, search, profiles, private
writing, selections, friendships and reports. Validators check UUIDs, dates, zones,
timestamps, revisions, dimensions and layout numbers. Mutations enforce capacity
and revision checks transactionally through the shared access helpers.

The initialization SQL is regenerated directly. Refresh the migration entry module
when regenerating SQL so Metro invalidates the inline SQL transform cache.

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

   Sample exports and imports require no penalty artifacts; the importer assigns zero
   hub penalties. A development/preview sample can contain 1,000 surviving paintings
   across sources, retaining alternate views and related metadata.
   See [the import workflow](scripts/data/README.md#small-corpus-for-development-and-previews).

6. **Enrichment:** run the [batch fact-sheet and docent worker](scripts/data/README.md#enrichment)
   to populate the cache. The app also generates and caches missing fact sheets and prose
   on identification when a description is missing (`docent.ensure`). Empty cached research
   is rebuilt; valid research is reused when only the paragraph is missing. The batch worker
   includes missing descriptions on contributed and currently on-view artworks.

Provider calls share deployment-level daily caps. Tavily searches reserve one credit;
advanced reference extraction reserves up to two credits for five URLs.
Reference-bearing research also requires a Token Factory identity review.

## Data sources and terms

| Source                                                                | Use and terms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Met Open Access                                                   | CC0. Paintings, and prints, drawings, photographs, manuscript leaves and other flat works marked public domain, with an API image URL; thumbnails hotlinked from the Met's CDN, never copied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Art Institute of Chicago API                                          | Metadata (CC0 fields), including current on-view placements. When a Chicago work's fact sheet is built, its CC BY 4.0 `description` and `short_description` are read from the API; facts quote them verbatim and link to the artwork page. The IIIF image host answers identified requests with 403, so no AIC image is embedded or shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cleveland Museum of Art Open Access                                   | CC0 metadata and images. Paintings, prints, drawings, photographs, manuscripts and other flat works with a CC0 image, with their current gallery; web renditions are embedded and deleted after embedding, and thumbnails are hotlinked from the museum's CDN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Finnish National Gallery open data                                    | CC0. The collection dump's flat works at the Ateneum and Sinebrychoff with a CC0 image, placed on view while a current exhibition shows them; images are embedded and deleted after embedding, and thumbnails are hotlinked from the gallery's collection site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Wikidata and Wikimedia Commons                                        | Wikidata is CC0; Commons files carry their own rights. Paintings with a `P18` image, and drawings, prints, watercolors, frescoes, tapestries, icons and other flat works the rights rule classifies as public domain, are embedded from standard thumbnail renditions fetched under the Wikimedia robot policy (two connections, at most 25 Mbps, never an original) and deleted after embedding. Commons thumbnails are hotlinked only for artworks the rights rule classifies as public domain                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Wikipedia                                                             | Text is CC BY-SA 4.0. Research reads the linked English article and, when thin, at most one linked article in another supported language (MediaWiki plain text at scan time, lead paragraphs in the batch job). Facts quote the original language and link back; the docent is written in English                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Artwork reference pages                                               | Up to five public HTTPS pages explicitly cited by the exact Wikidata item or its linked Commons file, retrieved through Tavily advanced Extract. Used for attributed, verbatim research passages with both source and referring URLs retained; each publisher’s copyright and terms apply. Identity and attribution are reviewed before use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Museum websites                                                       | On a visitor's request, one page is fetched (a QR code, an accession lookup, a search candidate), only on the venue's own hosts, with an identified User-Agent, per-device rate limits and the daily cap; the per-museum opt-out registry is checked before every fetch, and nothing fetched is stored. For Explore's exhibition listings, batch and background jobs read the exhibition pages of museums that have not opted out, following robots.txt (RFC 9309) with the identified User-Agent and at most one request per second per host. Background reads come once a month, a few days after a listed show closes, or when someone opens a region whose reads are due, and only listings that changed reach the model. They keep each show's title, dates, page URL, the page's link-preview image URL and a hash of the listing text; the app hotlinks that image from the museum's site, never copies it, and links each show to its page |
| Bundled app images                                                    | Public-domain or CC0 reproductions from The Met, the Art Institute of Chicago and Wikimedia Commons: onboarding examples, and 36 preset profile pictures redrawn in crayon with OpenAI `gpt-image-2` for the bundled assets. Each folder's `credits.md` lists every work and source; these app assets are separate from the recognition corpus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| WikiArt (`huggan/wikiart`)                                            | Not used: unknown license limited to non-commercial research, and no stable artwork identities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tavily, Convex, Cloudflare R2, Pinecone, Nebius Token Factory, OpenAI | Under their API terms. Keys live only in Convex environment variables and the gitignored `.env.local`. OpenAI receives the artwork narration text and, for moderation, the comments, reflections, notes and bios people share; the player discloses that its voice is AI-generated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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
- **Visitor contributions share a crop of at most 256 px:** the crop is shared when
  a confirmed work is saved and can be withdrawn in Settings. It supplies a card thumbnail
  for other visitors. The label photo is
  read on the phone and only its text lines are sent; label verification downloads a museum
  page's images to the phone to compare them and uploads none.
- **Identity is the device:** an App Attest key Apple binds to one install on one iPhone.
  Contributions, rejections and venue confirmations carry an assertion, are rate-limited per
  device. Optional Apple or Google sign-in syncs the private journal between devices
  and enables profiles, publishing and friendship. An account is never required to scan,
  save or contribute.
- **Crash and handled-error reports from production go to Sentry.** Only the EAS production
  environment (`EXPO_PUBLIC_SENTRY_DSN`) and the production Convex deployment (`SENTRY_DSN`) set a
  DSN; leave both unset everywhere else so other builds and deployments send nothing. Reports
  include stack traces, device model, OS and app version, operation names, route templates and
  diagnostic breadcrumbs. Console output and request payloads are excluded; URLs, credentials and
  SQL parameters are redacted.
  No photos, screenshots, screen replays or location fixes are attached. Traces time
  app start and screen loads; request spans keep
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
[`docs/`](docs/README.md) (technical findings, operations, and product contracts).
Agent guide: [AGENTS.md](AGENTS.md).

## License

Mozilla Public License 2.0 — see [LICENSE](LICENSE). Notices for the open source libraries in the app build are
generated into `convex/lib/thirdPartyNotices.json` and served by the backend at `/licenses`, linked from
Settings → About → Open source licenses.

The bundled C-RADIOv3-B model is licensed separately under the
[NVIDIA Open Model License Agreement](modules/coreml-embed/ios/model-notices/c-radio-v3-b/nvidia-open-model-license.pdf).
The complete agreement and required [Notice](modules/coreml-embed/ios/model-notices/c-radio-v3-b/Notice.txt)
are included in the repository and packaged in the iOS app's `model-notices/c-radio-v3-b/` resources.
