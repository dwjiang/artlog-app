# Art Identifier iOS App — Project Proposal

**Hackathon:** Nebius x NVIDIA Global AI Hackathon (Devpost)
**Track:** Best Apps and Agents
**Deadline:** October 30, 2026, 10:00 AM PDT
**Prepared:** September 7, 2026
**Revised:** September 7, 2026 — docent prose cached (§4.8); label-in-frame detection, describe-and-search and deferred identification removed; on-view refresh monthly; sign-in removed in favor of App Attest device identity (§8); web build removed, judging runs through the TestFlight app; geofences replaced by location-on-open-or-scan against a Wikidata-seeded museum table, indexing never prompts (§4.2)
**Revised:** September 8, 2026 — production architecture pass. Embedding-model versioning with a dual-collection migration window and a transient-crop fallback (§5.4); ORB descriptors replace reference images for verification, so in-copyright works get Gate 2 (§4.1, §4.7); one vector store and a learned match calibrator replace the two-tier index and the threshold ladder (§4.1, §4.3, §5.2); artwork / object / placement data model with owner separated from location, and saved records as immutable snapshots (§4.2, §5.3); offline venue bundles and on-device venue resolution (§5.1); central polite crawler replaces presence-triggered indexing (§4.2, §7); `rightsStatus` governs what is stored and trained on (§5.5); optional account for sync on top of device identity (§5.6); paintings only (§3); docent cache per artwork and language, source scoring, museum corrections (§4.8). Hackathon logistics in §10 are not yet re-planned against this architecture.
**Revised:** September 8, 2026 — on-device model pinned. C-RADIOv3-B (90M parameters) is the embedding model; the unversioned `nvidia/C-RADIO` repository is the 0.7B H-class model and is not what ships. The phone runs an export of the backbone and one summary head only, with 8-bit weights and fp16 compute, at a fixed 448–512 px input that the index and server match; the model ships inside the app binary (~90 MB, whole app under 200 MB) rather than as a download, so the migration window in §5.4 is bounded by app adoption (§4.1, §5.1, §5.4, §5.7, §6, §9, §11, §12).
**Revised:** September 8, 2026 — server-side is the primary path. Every scan uploads a crop and C-RADIOv3-B embeds, verifies and calibrates it on the Nebius inference service; the phone holds no model, no vectors and no descriptors (§4.1, §5.1, §5.2). The on-device fast path, the venue bundle and the bundled CoreML export from the previous entry are demoted to stretch (§3, §5.1); model migration becomes server-only, with no adoption window and no crop fallback (§5.4); "works with no signal" becomes an honest offline queue — capture now, identify on reconnect (§1, §3, §5.1, §9). The former on-device decision gate is retired.
**Revised:** September 8, 2026 — no special venues, no schedule. The demo-museum layer is gone: every museum, including the ones we test at, enters the index through the same crawler and the same enrichment queue (§4.2, §4.8, §5.7, §7). The demo-video storyboard and all filming references are removed. The timeline, week numbers and build-time estimates are removed and the remaining sections renumbered (risks §11, open items §12, decision §13). The rights rule now governs every model that learns from works, so the attribution head trains on public-domain works with labels from Wikidata, the Met and the AIC rather than on WikiArt (§4.2, §4.4, §5.5). Docent text is English only (§4.8, §5.3).
**Revised:** September 8, 2026 — design answers folded in. Every request goes phone → Convex → inference service, with the vector DB and descriptor storage co-located in the inference service's Nebius region (§5.2, §5.7, §9). Rectangle detection runs live in the viewfinder and gates the shutter; the user never adjusts the crop; one shared function warps, resizes and letterboxes it for the phone and the index build (§4.1, §5.1, §6). Reference descriptors are extracted at the scan's input resolution and low-texture objects get their own *confident* rule (§4.1, §4.3, §5.7). Signature reading removed everywhere. The calibrator's gallery feature is the visit's last confident match (§4.1, §5.3). The offline queue carries the label photo and runs the label flow on reconnect (§3, §4.4, §5.1). All judging-specific paths and references removed.
**Revised:** September 8, 2026 — attribution removed and images gone. The attribution head and its style/period line are removed; the soft card shows runner-ups and an honest "Unidentified" state (§4.4, §5.5, §8). No museum image is ever stored: the build streams images through a scratch bucket and deletes them, public-domain thumbnails are hotlinked from the source, in-copyright works show the visitor's own photo, and the consented contributor crop is the only image the system keeps (§4.2, §4.7, §5.4, §5.5, §5.7, §10).
**Revised:** September 8, 2026 — Convex-only backend, model on the phone, zero idle infrastructure. C-RADIOv3-B ships in the app as a CoreML model (int8 weights, fp16 compute) and the phone also extracts ORB descriptors; a scan sends ~20 KB — a vector and descriptors, no pixels. Convex is the entire request path: its built-in vector search, ORB matching and RANSAC in JavaScript, and the calibrator all run inside the `identify` action. Nebius runs the index build, crawler, enrichment and migrations on Serverless Jobs and serves Nemotron on Token Factory; the inference endpoint, vector database and object store are gone (§4.1, §5, §6, §9, §10). The phone's vector and descriptors are trusted for now; server-side re-embedding before promotion is recorded as deferred, not implemented (§3, §8). Model migrations are adoption-bound again, with a minimum supported version and local re-embedding after an update (§5.4).
**Working title:** TBD

---

## 1. Summary

A personal art companion for museum-goers: point your phone at a painting and the app identifies it in about a second, pre-fills title, artist, date, medium and institution, and saves it to a private collection tied to the visit where you found it. A scan taken with no signal isn't lost: it waits on the phone and is identified the moment the connection returns. When the work isn't in the index, the app asks for a photo of the wall label, reads it, verifies it, and — with the user's consent — adds the work to a shared index so the next visitor gets an instant match. Walk into a museum the app has never seen and its collection site moves to the front of the indexing queue, usually finished within the visit. Built on an open stack: NVIDIA's C-RADIO on the phone, NVIDIA's Nemotron on Nebius Token Factory, and an index built on Nebius.

The core technical bet is that identification should be done by **visual retrieval, not by a language model**. Artwork photos are embedded on the phone with NVIDIA's C-RADIO vision model and matched against a single, versioned index, with a small learned match model deciding when a match is real and when to say so. Nothing in the system idles: the phone and Convex serve every scan, and Nebius runs batch jobs and Nemotron. Nemotron models handle what language models are good at — reading wall labels, verifying ambiguous matches, and writing the "about this work" text once from a sourced fact sheet, cached for every later visitor. Tavily answers the one question no museum database can: what's happening with this artist right now.

### 1.1 Competitive landscape

| Approach | Example | Strength | Weakness |
|---|---|---|---|
| Partner-curated index | Smartify | High precision, official content, 2M+ works | Only works at partner museums; no answer for anything else |
| Crowdsourced index | Magnus | Scales to galleries and fairs where no institution will share data | Moderation burden; galleries filed copyright claims in 2016 and the app was pulled from the App Store until settled |
| Web-scale reverse image search | Google Lens | Anything with an online footprint | Fails silently on anything without one; not on our stack |
| Zero-shot vision LLM | ArtScan and similar | Works anywhere with no database | No way to verify; confident on famous works, confidently wrong on obscure ones |

Nobody combines visual retrieval with wall-label reading as the primary out-of-corpus path. That is our differentiator, and it works at an unpartnered museum on day one. We do use a vision-language model, but only to read wall labels — never to name a work from its pixels; what it reads is verified against the museum's own records or Wikidata before it is shown (§4.4). Two lessons we adopt from Magnus: crowdsourcing works if every entry is reviewed before it goes public, and we store embeddings, local feature descriptors and links, never the museum's images (§5.5).

---

## 2. Hackathon requirements

| Requirement | How we meet it |
|---|---|
| Runs on Nebius Token Factory or AI Cloud, uses ≥1 NVIDIA open model | C-RADIOv3-B (NVIDIA's embedding model, on the phone for every scan and on Nebius Serverless Jobs for the index, versioned per §5.4), Nemotron Nano 2 VL or Nano Omni (vision), Nemotron 3 Super / Nano (text) on Token Factory; index build, crawling, enrichment and migrations on Serverless Jobs. Live Token Factory calls on every label read and first identification of an uncached work; Serverless Jobs run to completion and nothing idles (§5.2) |
| Working demo URL, available free of charge | TestFlight public link (Apple Developer enrollment is the first action on approval). The app opens to the camera with no account, so anyone can scan within seconds |
| Public repo with OSS license at top, README with setup + explicit Nemotron/Token Factory callouts; all source, assets and instructions needed to run | MIT license; README section "Where NVIDIA and Nebius are used"; ingest, crawl, re-embed and enrichment scripts included so the index can be rebuilt from scratch, plus a "run against the hosted backend" path so anyone can build the app without rebuilding the index |
| Third-party SDKs, APIs and data used under their terms | Met (CC0), AIC API, Wikidata, Convex, Tavily are clear. WikiArt dataset license and museum collection-site crawl terms verified at kickoff (§12); any source whose terms don't allow it is dropped; per-museum opt-outs honored (§4.2) |
| Written feedback on Token Factory / NVIDIA tools | Running notes file during the build; eligible for the $100 feedback prize |
| Optional: Tavily usage | Three runtime uses plus Map from the crawler (§7); eligible for the $3,000 Best Use of Tavily prize, which requires a functional runtime call |
| Optional: Builders & Brews city | SF event on October 9 — attend for mentoring; City Winner Award eligibility does not require attendance |

**Credits:** $25 Token Factory credits via promo form (code: see the hackathon page; not recorded in this repo) + $25 via the Nebius Builders Program, which also includes Tavily credits.

---

## 3. Product scope

**Works in scope: paintings only.** The verifier assumes a flat, rigid, textured surface and the corpus queries select paintings. Sculpture, works under glass, textiles, works on paper in cases, installations and time-based media are out of scope for now; a scan of one lands on the soft card and the label flow like any other miss.

### In scope (MVP)

- **Scan** with the live camera or import from the photo library
- **Identify** with a confidence indicator, runner-up "similar works," and an explicit "unidentified" state
- **Honest offline** — a scan taken with no signal is embedded on the spot and kept with its venue and time — and the wall label, if the user captures it — queued, and identified the moment the phone reconnects, with the label flow run automatically on a miss; the collection is local-first and browsable anywhere (§5.1)
- **Label capture** — guided second shot of the wall label when identification fails or the user rejects a match; QR code and accession-number lookup; can be captured offline and processed on reconnect
- **Soft identification** — when the match model isn't confident, the app keeps working on its own before asking for anything: capture check and ranked candidates from the global search. Every step is free (§4.4)
- **"Not right?"** on every result card: runner-ups first, then label capture
- **Edit** every suggested field before saving
- **Collection** — grid and canvas views; search across title, artist, institution
- **Visits** — group works by museum and date; the museum is resolved on the phone from a bundled venue table (§4.2). A saved work is a snapshot of what the user saw, where and when; nothing that happens to the index afterward changes it (§4.2, *Moves*)
- **Shared index** — opt-in, no account needed; confirmed label captures are promoted to the shared index once verified (§4.7, §8)
- **Indexed venues** — a central, scheduled crawler indexes museum collection sites by priority; opening the app inside an un-indexed museum moves that museum to the front of the queue. No user action ever starts a crawl (§4.2)
- **Exhibition checklists** — temporary exhibitions and loans ingested as time-bounded placements, so a painting on loan is identifiable where it hangs (§4.2)
- **Docent text** — a short "about this work" section with a source link on every sentence, written once by Nemotron from a sourced fact sheet, validated, and cached per artwork (§4.8)
- **Right now** — a one-line, web-sourced note on current exhibitions or news about the artist, answered by Tavily (§4.8)
- **Optional account** — sign in to sync the collection across devices; never required to scan, save or contribute (§5.6)
- Private, local-first storage; export collection metadata as JSON

### Stretch (only once everything in scope is done)

- Venue bundles: per-venue vectors and descriptors downloaded on arrival so identification works with no connection (§5.1). The model is already on the phone, so this is a download and a local match, not a new pipeline
- Confusion pairs ("which of these two?")

### Deferred (decided, recorded, not scheduled)

- Evaluation harness: golden set of real museum photos per venue, offline replay of stored scans against every new index or model version, precision/recall and latency dashboards, shadow-testing of calibrator changes (§4.3)
- Data retention and deletion policy for scans, feedback and venue-derived data (§5.5)
- Backward-compatible training of each new embedding model against the previous one (§5.4); delivering the model as a downloadable asset rather than part of the app binary
- Trust scores beyond the basic new-device weighting (§8)
- **Promotion never trusts a phone-computed vector.** Before a contribution promotes, a Serverless Job re-embeds and re-describes it from the consented crop and replaces the phone's vector and descriptors (§4.7, §8). The crop is stored today so this needs no data change; decided and recorded, not implemented for this project

### Out of scope

- Subscriptions / paywall
- Android
- Social features
- Required accounts — sessions are anonymous by default; the account is opt-in and only for sync
- Non-painting works

---

## 4. Identification design

### 4.1 Retrieval-first pipeline

1. **Crop** the painting on the phone. Rectangle detection runs live on the preview frames; the shutter is enabled only once a stable quadrilateral has been found, and until then the viewfinder says what to change — move closer, get the whole painting in frame, straighten up. The user never adjusts the crop by hand. On capture the phone prefers the inner rectangle (the canvas) when one covers at least 40% of the outer one (the frame), perspective-warps the quad flat, resizes its long side to the fixed input size and letterboxes to square with the image-mean color — the same function, down to the resize filter, that the index build uses (§5.7) — and hands the crop to step 2. The crop never leaves the phone; the homography from step 4 returns the artwork's corners for the card.
2. **Embed on the phone** with **C-RADIOv3-B** (90M parameters), shipped inside the app as a CoreML model with 8-bit weights and fp16 compute on the Neural Engine, ~90 MB (§5.1). The same weights — the int8 checkpoint the export was made from, dequantized to fp16 — build the index on a Nebius Serverless Job, and a drift check on a calibration set guards the two against each other (§5.7). B is the right size: the L (320M) and H (653M) models are 3.5–7× the weights and several times the latency for no gain on "is this literally the same painting" retrieval, where ORB verification catches the residual confusions. Two traps in the repositories: the unversioned `nvidia/C-RADIO` is the 0.7B H-class model, and the half-precision checkpoint in `nvidia/C-RADIOv3-B` is ~550 MB because it carries the adaptor heads for every teacher. The export is the backbone plus one summary head. Input resolution is fixed at 448 or 512 px (784 or 1,024 tokens; decided at kickoff by measuring on the Neural Engine, §12) and is identical for the index and every scan — a resolution mismatch quietly costs recall. Different C-RADIO backbones produce different embedding spaces, so the model is **versioned**: every vector in the index and every request carries `modelVersion` (§5.4). Use the DINOv2-adaptor summary output, the head best suited to instance-level ("same object, different photo") matching; the adaptor may output the teacher's 1,536 width rather than the backbone's 768, which doubles the storage math in §5.7, so the dimension is verified at kickoff and the backbone summary is the fallback if it matters. Open weights, NVIDIA Open Model License, commercial use permitted. In the same pass the phone extracts ORB keypoints and descriptors from the letterboxed crop (OpenCV, ~300–500 keypoints, ~11–18 KB) and sends the vector, the descriptors, the `venueId`, the visit's current gallery and `modelVersion` to `identify` — about 20 KB, and no pixels.
3. **Search** one index with **one** Convex vector search over the `vectors` table (§5.2), filtered only by `modelVersion`, returning the top candidates; their venue, gallery, on-view status, source, rights status and `keypointCount` are loaded as attributes. Those attributes are inputs to the next step, not filters — a painting on loan, a rehung work, or a wrong venue guess lowers a candidate's score rather than hiding it.
4. **Verify** the top candidates inside the `identify` action with ORB matching + RANSAC homography, in JavaScript: the phone's descriptors against each candidate's **stored descriptors**, read from the `descriptors` table. No reference image is needed, which is what lets in-copyright works be verified at all (§4.7). ORB is algorithmic rather than learned, so descriptors are extracted once and reused across every embedding-model version. Stored descriptors are extracted from the same letterboxed input the scan uses, never from the full-size source image, so scan and reference sit at the same scale (§5.7); every object carries a `keypointCount` from build time, and objects below a low-texture threshold get a different *confident* rule (§4.3). Paintings are flat, rigid and textured — geometric verification is fast (tens of milliseconds per pair even in JavaScript), precise for "is this literally the same object," and yields the artwork's corners for free.
5. **Decide** with the match calibrator (§4.3): one small model that takes the similarity score, the margin to the runner-up, the candidate-set size, whether the candidate is placed at the user's venue and in the user's current gallery — defined as the gallery of the visit's last *confident* match within the past fifteen minutes, `unknown` otherwise (§5.3) — whether it is on view, the candidate's `keypointCount`, and the ORB inlier count, and returns a match probability. Three outcomes: *confident*, *soft*, *miss*.
6. **Return** the match with precomputed metadata and cached docent sentences; "Right now" streams in behind it (§4.8).

### 4.2 Corpus

**What a row is.** Three entities (schema in §5.3):

- An **artwork** is the work as a concept, anchored on Wikidata where possible: title, artist, date, `rightsStatus` (§5.5), `multiplicity` (a known-unique painting vs. a work that exists in several versions), `seriesId`, the fact sheet and the cached docent sentences.
- An **object** is one physical painting: `ownerId` — the institution whose accession number it carries, Wikidata `P195` — plus accession, medium, dimensions, `imageRef` (§5.4), and its embeddings and ORB descriptors. Stable id `source:sourceId`, so index rebuilds never dangle a reference.
- A **placement** is where an object is and when: `(objectId, venueId, gallery, onView, from, to, source, confidence)`. The current placement feeds the calibrator's venue and gallery features; the history makes any change revertible. Seeded from Wikidata `P276`, museum on-view feeds and exhibition checklists.

Owner and location are separate fields because paintings move: loans, traveling exhibitions, rehangs, storage. A move is a write to `placements`, never a re-embed, and never a change to anything a user has saved (*Moves*, below). Fact sheets and docent text live on the artwork, so a painting that has hung in three museums has one fact sheet, not three.

Four source layers, distinguished by `source`, in one index. No venue is special: the museums we test at enter the index through the same crawler, the same queue and the same enrichment job as every other museum.

**Open-access corpus:**

- **The Met Open Access** — CC0, ~470k objects; restrict to paintings and on-view works
- **Art Institute of Chicago API** — IIIF images, `is_on_view`, `is_public_domain`
- **WikiArt** (`huggan/wikiart` on Hugging Face) — ~81k works. Indexed only if the dataset license permits (§12)
- **Wikidata** — paintings with `P18` images

**Wikidata global layer (built on Nebius):** every painting on Wikidata with a `P18` image — hundreds of thousands of works across every museum that has ever been photographed — embedded by the same Serverless Job and held in the same Convex vector index as everything else. Stored per object: the vector with `modelVersion`, the ORB descriptors, the Wikidata ID, `ownerId`, and the Commons file URL as `imageRef` — which is also the hotlinked thumbnail where `rightsStatus` allows. No image is stored. This is the honest fix for "not in the corpus": more corpus, for a few dollars of GPU time.

**Crawled venues (the central crawler):** every museum with a collection site, indexed by one scheduled pipeline rather than by whoever walks in.

*The venue table.* `museums` is seeded from Wikidata with every museum and gallery that has coordinates (`P625`) and a website (`P856`) — tens of thousands of rows — so an unknown venue is the exception. The table ships inside the app (a few MB, refreshed in the background), and venue resolution runs **on the phone**: on app open and with every scan, the phone finds the nearest row within about 150 m and starts or resumes the visit. The server only ever sees a `venueId`; coordinates never leave the phone. For a venue not in the seed — a commercial gallery, a university hallway — the phone runs a local POI search on device (MapKit local search, no API key), filtered to museum and gallery categories, and shows one sheet: "Looks like you're at X," with a tap to confirm or pick another. The same sheet appears when two seeded venues are within range of each other. On confirm the phone sends the POI's name and website, the server probes the site for a collection section and inserts the row with `seedSource: poi`. No geofences, no background location, no Always permission.

*The crawler.* A crawl queue holds venues in priority order. Workers — Nebius Serverless Jobs, entirely separate from the request path, which is Convex alone — take one venue at a time:

1. **Discover.** Prefer, in order: an official API or IIIF manifests; `sitemap.xml`; Tavily Map with `select_paths` for the site's platform (eMuseum `/objects/`, TMS, CollectionSpace, or a per-museum pattern). On-view listing pages first when the site has them. Capped at ~2,000 pages per run; a nightly pass finishes any run that hit the cap.
2. **Fetch politely.** Per-host rate limit of 1–2 requests per second, `Crawl-delay` honored, an identified User-Agent with a contact address, robots.txt and the site's terms checked at enqueue time and recorded on the row. Conditional requests (`ETag`, `Last-Modified`) so re-crawls only touch changed pages. Tavily Crawl sits behind a per-site flag for sites where our page parser fails; discovery plus our own fetcher is the default.
3. **Extract and embed.** Title, artist, date, accession, rights line and the image URL (`og:image` as the fallback) from the platform's markup; embed with the current model (the same weights the phone runs, §5.7); extract ORB descriptors; discard the image (§5.5). Nothing crawled is ever stored — only the embedding, the descriptors, the page link and, for public-domain works, the image URL to hotlink as a thumbnail. For in-copyright works, which is most of a contemporary collection, the card thumbnail is the user's own photo.
4. **Write.** Artworks (matched to Wikidata where possible, else created), objects with `source: crawl` and the page link as `imageRef`, placements with `venueId` = the site's museum and `onView` from the listing, vectors tagged with `modelVersion`, descriptors. Batched, so the index is searchable while the run is still going. `museums.indexStatus` carries progress — `{status, pagesMapped, worksIndexed}` — and the app subscribes to it.

*Priority.* The queue is ordered by expected visits: museums near active users first, then by size and traffic. Opening the app inside an un-indexed venue moves it to the front (rate-limited per device per day, §8). A scan that misses while its venue is being crawled shows "Indexing this museum — 640 of 2,100 works" and re-runs itself when the status flips to `complete`; the scan embedding is already on the `scans` document, so nothing is re-captured. The label button stays available throughout. Being somewhere changes a queue position; it never starts a fetch loop on its own. At polite rates a 2,000-page site takes 20–35 minutes, which is why pre-indexing by priority is the plan and in-visit indexing the fallback.

*Freshness.* Per-venue change detection replaces the monthly full refresh: sitemap `lastmod`, conditional requests, and the museum's on-view feed where one exists; only changed pages are re-fetched. Exhibition checklists for temporary shows are ingested as placements with `from`/`to` dates and `source: checklist`.

*Opt-out, takedown and partnership.* A per-museum opt-out registry is checked at enqueue time and honored retroactively — objects from an opted-out venue are removed from the index, not just from future crawls. A takedown process exists for rights holders (§5.5). For large institutions, official data under agreement (the Smartify route) is better than crawling; crawling is for the long tail.

Rule as everywhere: vectors, descriptors and links; no museum image is ever stored, in copyright or not; a public-domain thumbnail is hotlinked from its source, and an in-copyright work's card shows the user's own photo (§5.5). Nothing a user does can point the crawler at an arbitrary site: the only sites it will ever fetch are the website of a seeded museum row or of a POI the phone's map search returned, and only if that site has something that looks like a collection section (§8).

**User-contributed layer (grows during use):** works promoted from label captures (§4.7). Tagged `source: user`, always separable, always revertible.

**Moves.**

How a move is detected, in order of trust:

- **Structured sources.** On-view feeds and exhibition checklists write placements directly, with `source: feed` or `checklist`.
- **The scan.** Because venue is a calibrator feature rather than a filter, a painting on loan still matches at its new venue, with a slightly lower prior, and ORB verification confirms it. A verified match at a venue that disagrees with the object's current placement becomes a **placement proposal**. Proposals move through the same private → pending → promoted pipeline as contributions (§4.7): agreement from independent devices at the new venue on different days, and **human review before promotion**, since placement changes are rarer and higher-impact than contributions. A strong match elsewhere can also be a second version or a reproduction — a gift-shop poster is flat and passes homography — so `multiplicity` decides what is proposed: a known-unique painting seen elsewhere proposes a placement change; a multiples artwork proposes a new object under the same artwork. Museum-confirmed data promotes alone. Scan-derived evidence never writes `placements` directly.
- **Not the label.** The label reader does not try to parse lender credit lines or resolve accessions against a lending museum's site; `verifyLabel` checks the current venue only (§4.4).

What a move never touches: a user's saved record. A saved work is an immutable snapshot of what the user saw — venue, date, gallery, and the title, artist, date, medium and institution fields as displayed and edited at save time. It carries an `objectId` that is used only to fetch artwork-level enrichment (docent text, "Right now"); no placement change, reversion, dedup or merge rewrites the snapshot. If someone saw a painting at one museum, they will always have seen it at that museum.

Coverage is strong for major-museum highlights and for any museum the crawler has reached, weak for galleries and local art.

### 4.3 The match calibrator

Nearest-neighbor always returns *something*, so deciding is its own step. Instead of a hand-tuned threshold per museum, per work and per rescan tier, one small model — logistic regression or a small gradient-boosted model, a few KB of JavaScript inside the `identify` action — takes the features from §4.1 step 5 and returns a match probability. Two thresholds on that probability give *confident*, *soft* and *miss*. Venue and gallery are inputs, so a wrong venue guess or a painting on loan lowers the probability rather than causing a miss; the global candidate set sees a stricter effective bar than a venue-local one for the same reason, without a separate threshold. The ORB inlier count is an input and, for textured works, a hard requirement: no consistent homography, no *confident* match. Objects whose `keypointCount` is below the low-texture threshold — monochromes, color fields, near-uniform abstracts — can't produce a homography, so for them *confident* instead requires a stricter similarity bar, a margin over the runner-up, and a venue that agrees with the current placement. Low-texture works land on the soft card more often; that is honest, and the label button is there.

Trained initially on augmented corpus samples (crop, glare, perspective, frame, low light) with positives and hard negatives drawn from the index; retrained from real confirm/reject feedback (§4.6) offline, as a versioned artifact, with trimmed statistics, a minimum number of distinct devices per venue, and bounded movement between versions. Per-object overrides remain for hubs (§5.7, step 6) and for works with high rejection ratios. The evaluation harness that should gate every retrain is deferred (§3); until it exists, retrains are manual and reviewed.

### 4.4 When identification fails

A miss is not a dead end, and it is not an immediate demand for a second photo. When the calibrator returns *soft* or *miss*, the app keeps working on its own for a couple of seconds, shows what it has, and offers the label as the fastest route to an exact answer. Every automatic step below is free. Nothing asks a model to know the answer.

**Soft identification (automatic; card shown immediately)**

1. **Capture triage** (on device, instant). Most museum misses are capture problems, not corpus gaps. Framing and angle are handled before the shutter is ever enabled — the live rectangle detector won't let a third-of-the-frame or steeply angled shot through (§4.1) — so triage checks blur and highlights on the captured crop before uploading anything. If the shot is the problem, say so in one line — "Dodge the glare" — with a one-tap retake.
2. **The global candidate set** (already in hand). The single query from §4.1 has run and the calibrator has ranked what came back; there is no local step to fall through from and no ladder of rescans: works in the user's gallery, off-view works at the venue, and paintings held anywhere else are all in the one candidate set, scored rather than filtered. A miss at a venue whose crawl is still running waits for it (§4.2).
3. **The soft card.** Shown the moment the calibrator declines to say *confident*: the runner-ups ("Maybe one of these?") and an honest "Unidentified" state with title and artist blank for the user to type — no guessed style or period. Save works from here. The label button reads "Get the exact answer — point at the label" and is present from the first frame.

Library imports skip the label but not the rest: EXIF location and timestamp resolve a venue for a photo taken months ago (no gallery — there is no visit context), and steps 2–3 run unchanged.

**The label flow (the fastest route to an exact answer)**

In a museum, the answer is printed three feet from the artwork:

1. **Prompt:** "Not in our index yet — point at the label." A framing overlay helps the user capture the label flat and in focus. The artwork embedding and descriptors from the first shot are kept and carried through. With no signal, the card says so and offers the label capture right away: the label photo is queued beside the artwork crop, and on reconnect the label flow runs on its own if identification comes back *soft* or *miss*; a QR code is decoded on the phone and fetched later (§5.1).
2. **QR code check.** Many labels now carry a QR code linking to the museum's collection page. If present, fetch the page and parse it — an exact answer with no OCR.
3. **Read the label** with Nemotron Nano 2 VL (or Nano Omni; pick the newest VL model live on Token Factory at kickoff). One call returns structured JSON: title, artist, dates, medium, credit line, accession number, and a per-field confidence. Keep the raw OCR alongside any user edits. The label photo is sent for reading and not retained server-side. No lender parsing: the credit line is stored as text and not interpreted.
4. **Verify.** In order of strength: (a) the accession number resolves on the current venue's own collection site — the museum is the authority; (b) the title + artist pair exists on Wikidata; (c) Tavily search scoped to the museum returns a page naming the pair, and if it returns an image, its embedding is close to the photo ("text proposes, pixels decide").
5. **Present** the card with verified fields filled and locked, and unverified ones editable. The user can unlock a verified field to edit it; doing so downgrades that field's evidence to "user-edited," which changes what the contribution needs for promotion (§4.7). This makes the §8 rule — fields read from a label carry more trust than fields the user typed — visible in the UI.
6. **Contribute** (opt-in, no account): the embedding and descriptors as the phone computed them (§8), the verified metadata and a small crop of the user's own photo are written as a private contribution attributed to the device's App Attest identity (§8) and enter the promotion pipeline (§4.7).

### 4.5 Making "unidentified" a good outcome

- Never fake confidence. A wrong confident answer is worse than an honest miss.
- Show runner-up candidates as "similar works" so a miss still teaches something.
- Leave title and artist blank rather than guess; the label is three feet away.
- Every confirmed label capture can grow the shared index, so the miss is a gift to the next visitor. Sharing is opt-in and needs no account. What leaves the phone for a contribution: the embedding, the ORB descriptors, the label-derived fields, and a small crop of the user's own artwork photo, which becomes the card thumbnail for the next visitor and the re-embedding source across model versions (§4.7, §5.4). Full-frame photos never leave the phone. The consent sheet says exactly this.
- A scan sends no pixels at all: the phone embeds its own photo and sends a vector and descriptors (§5.5). The only image that ever leaves a phone is a contribution crop the user chose to share.

### 4.6 "Not right?" — the feedback loop

Every result card has a "Not right?" action. A rejection is a labeled hard negative: this embedding does *not* belong to work X.

**On the phone:** show the runner-ups first ("Maybe one of these?"). Most wrong matches have the right answer at position 2 or 3, and a tap is cheaper than a second photo. If none fit, go to label capture (§4.4).

**What the backend records** — one `feedback` document per rejection, never modified by other users: the scan embedding and its `modelVersion`, venue, timestamp, the rejected object, its similarity score and margin, the ORB inlier count, the calibrator's probability, whether the scan's venue matched the object's placement, and the resolution (`runner_up:<objectId>`, `label:<contributionId>`, or `unresolved`). If the label names the same title and artist as the rejected work, the user misread; mark `false_rejection` and don't count it. If the label verifies to a different work, it's a confirmed hard-negative pair.

**What counts as a confirm.** A save where the suggested title and artist were left untouched increments `confirmCount`. A save where either was edited is neither a confirm nor a reject — an edit is weak evidence about the match, and counting it either way would pollute retraining.

**What the backend does with it:**

- **Retrain the calibrator** (§4.3) from real confirm-vs-reject distributions, offline, as a new versioned artifact. Trimmed statistics, minimum N distinct devices, bounded movement between versions.
- **Per-object confidence.** `confirmCount` and `rejectCount` on each object; a high reject ratio adds a per-object penalty the calibrator reads. This catches bad corpus data (mislabeled Met images, wrong WikiArt attributions) and "hub" works — monochromes, near-uniform abstracts — that match everything. Objects above a rejection count are flagged for review, never auto-deleted.
- **Multi-view index entries.** When a rejection resolves to a confirmed work, the scan embedding is added as a second vector for that object, tagged `source: user_scan` and with its `modelVersion`, after the same promotion rule as contributions. Corpus images are clean and flat; museum photos have glare, perspective and frames. Every resolved rejection makes the index look more like what phones actually capture. These vectors belong to the model version that produced them and regrow after a migration (§5.4).
- **Placement signal.** A confirmed match, or a resolved rejection, at a venue that disagrees with the object's current placement feeds a placement proposal (§4.2). It never writes `placements` directly.
- **Confusion pairs (stretch).** When the wrong and right works embed within a tight distance of each other — Monet's water lilies, print editions, multiple versions of one composition — store the pair and next time ask "which of these two?" with both thumbnails.
- **Keep the pairs.** Hard-negative triples (embedding, wrong work, right work) are exactly the dataset for a small reranker later, and for the deferred evaluation harness. Not built now; stored now.

**Guardrails:** a single rejection changes nothing anyone else sees; rejections per device per work are capped; unresolved rejections carry near-zero weight; a venue mismatch between the scan and the matched object is a calibrator feature and a placement signal, not a bug.

### 4.7 The shared index and promotion

A contribution moves through `private → pending → promoted` (or `rejected`). Private contributions are visible only to the device that made them. Promotion requires one of:

- **Strong evidence:** the accession number resolves on the current venue's own site, or a QR code linked directly to the collection page.
- **Agreement:** a second, independent scan whose embedding matches (same venue, calibrator *confident*) and whose label capture or runner-up selection names the same work. "Independent" means distinct App Attest keys on distinct physical devices, both resolved to the venue, ideally on different days; exact-duplicate embeddings are rejected as replays.

Weak evidence (a Wikidata pair match alone, or user-edited title/artist fields) always needs agreement. Once promoted, the enrichment job writes the fact sheet and the docent sentences (§4.8) and the entry is indistinguishable from a corpus work except for its `source` and provenance fields. Every promoted entry records which contributions and which devices produced it, so anything can be reverted (§8).

Placement proposals (§4.2) use the same states and the same agreement rule, plus human review before promotion.

**Verification and thumbnails for user-contributed works.** Verification uses the ORB descriptors the contributor's phone extracted from the scan, so Gate 2 needs no reference image; for now they are stored as sent, and replacing them with descriptors re-extracted from the consented crop on a Serverless Job is deferred (§3, §8). The crop itself (≤ 256 px on the long side) is kept, with consent, in Convex file storage — the only image the system stores: it is the card thumbnail for `source: user` works and the object's `imageRef` for re-embedding across model versions (§5.4). It is the user's photograph, not the museum's reproduction; the user agrees to this in the contribution consent sheet (§4.5). Corpus and crawled works follow the rights rule (§5.5): a hotlinked source thumbnail only where the artwork is public domain; embeddings, descriptors and links for everything else.

### 4.8 Docent text and "Right now"

Two sections on the result card, two different kinds of claim, two different sources of truth. Both live on the **artwork**, not the object: a painting that has hung in three museums has one fact sheet and one set of sentences.

**The fact sheet (background).** For each artwork, the enrichment job asks Nemotron 3 Super to write a list of discrete facts — provenance, dates, attribution history, exhibition history — each with the URL it came from. Sources are the owner's collection page, Wikidata, and Tavily search results (§7). Search results are admitted only from domains above a per-domain quality score — museum and university sites, catalogues raisonnés, reference works and major press score high; forums, aggregators and image-sharing sites are excluded — and the score is stored with each fact. The result is stored on `artworks.factSheet` as `[{id, text, sourceUrl, sourceLabel, sourceScore}]`. Precomputed by the enrichment job for on-view works at indexed venues, in crawl-queue order and to a daily budget, and for every promoted contribution; for any other artwork, generated on the first identification and cached. Museums and artists' estates can flag or correct a fact through a form linked from the card; a corrected fact invalidates the cached sentences.

**The docent prose (generated once per artwork, cached).** The `docent` step sends the fact sheet to Nemotron 3 Nano on Token Factory with one instruction: write three or four sentences in English using only these facts, and return JSON `[{sentence, fact_ids}]`. Temperature 0. A validator drops any sentence whose `fact_ids` is empty or contains an id not on the sheet. Surviving sentences are stored on `artworks.docent.en` as `[{sentence, fact_ids}]` — the field is keyed by language so other languages can be added later without a schema change, but only English is generated — alongside the fact sheet, and rendered on the card with a tappable source chip per fact each sentence used.

When it runs: the enrichment job writes the sentences right after the fact sheet, so they exist before anyone scans — for every artwork whose fact sheet is precomputed (on-view works at indexed venues, in crawl-queue order, and every promoted contribution). Any other artwork generates on its first identification and caches; the card shows the identification immediately and the sentences arrive 2–3 s later, that one time. The cache is invalidated whenever the fact sheet changes, so a revised fact never leaves a stale sentence behind.

Why cache rather than generate on every scan: at temperature 0 with a fixed fact sheet the output is the same every time, so a live call changes nothing the visitor can see. Caching makes the card complete the moment the match is decided, lets sentences be reviewed before a visitor sees them, takes the validator and Token Factory availability off the request path, and costs one Nano call per artwork instead of one per scan. Nothing about grounding changes: the model still cannot invent a provenance and have it reach the screen, and every sentence is still cited. The README says what is true: the sentences are generated once by Nemotron on Token Factory and cached; the live Nemotron calls are the label reads, moderation, and the first identification of any uncached artwork (§5). Context-dependent prose — the visit so far, what the user photographed, the runner-ups — is a later feature that would generate live on top of the cached default, without touching the facts.

**"Right now" (live, cache-miss per artist).** The one thing a museum database never knows: is this artist in a show nearby, in the news, about to be. The `rightNow` action makes a single Tavily search with `include_answer` — Tavily's own synthesized answer, no Nemotron step — using `topic: news`, a one-month `time_range`, and `include_domains` drawn from a per-region list of museums and local press keyed to the **venue's region**, not a fixed list. Two guards: show nothing unless the top result's relevance score clears a threshold and falls inside the window, and truncate the answer to its first sentence. Cached per `(artistId, region)` for seven days. The section is labeled "From the web" and links to the top result, so the user can see it is a different kind of claim than the cited docent text.

Cached sentences render with the card; on a first identification they and "Right now" render behind it. Nothing on the card waits for a model call (§9).

---

## 5. System architecture

Nothing idles. The request path is the phone and Convex; Nebius runs batch work on Serverless Jobs and serves Nemotron on Token Factory; no VM, endpoint or vector database is ever left running.

### 5.1 On-device (Expo, iOS)

- **The embedding model ships in the app.** C-RADIOv3-B — backbone plus one summary head — as a CoreML model with 8-bit weights and fp16 compute on the Neural Engine, ~90 MB in the binary (whole app under 200 MB, inside Apple's cellular-download limit). Input is the fixed 448–512 px letterboxed square from §4.1. The phone's `modelVersion` travels with every request (§5.4).
- **ORB on the phone.** An OpenCV native module extracts ORB keypoints and descriptors from the same letterboxed input, capped at ~300–500 keypoints (~11–18 KB).
- **Venue table** shipped inside the app (the Wikidata seed, a few MB, refreshed in the background). Venue resolution runs on the phone from a one-shot location fix on open and on scan (While Using permission only); the server receives a `venueId`, never coordinates. MapKit local search on device for the POI fallback and the "Looks like you're at X" sheet (§4.2).
- **Scan.** Live rectangle detection on the preview frames gates the shutter and guides framing; on capture the phone warps, resizes and letterboxes the crop (§4.1), runs capture triage, embeds it with CoreML (~0.1–0.3 s), extracts ORB, and sends the vector (768 float16, ~1.5 KB), the descriptors and keypoints (~11–18 KB), the `venueId`, the visit's current gallery and `modelVersion` to `identify` — about 20 KB, no pixels. The crop stays on the phone: it is the card image, the offline retry source and, after a model update, the re-embedding source (§5.4).
- **Offline.** With no signal the phone still embeds and extracts at capture time; the pending queue holds the vector, descriptors, venue, timestamp, and the label photo or decoded QR URL if the user captures one — ~20 KB plus the label photo — and processes them in order on reconnect: identify first, then the label flow automatically if the result is *soft* or *miss*. The card shows a clear "waiting for signal" state and says "capture the label now so we can finish this when you're back online." The collection is local-first and browsable anywhere.
- **Stretch: venue bundles.** With the model already on the phone, no-signal identification is a download and a local match: per-venue vectors and descriptors (a few MB for a large museum) fetched on arrival, brute-force cosine and ORB matching on the phone, the same calibrator (§3).
- **Capture triage** before anything is sent: blur and glare (§4.4); framing and angle are handled live by the rectangle detector. EXIF location and timestamp for library imports.
- **Label capture** screen with framing overlay and QR detection.
- **App Attest** key generated on first launch; attestation attached to contributions, rejections, venue confirmations and queue bumps (§8). **Optional account** (§5.6).
- **Result card** populated from precomputed metadata and the cached docent sentences the instant the calibrator says *confident*; "Right now" — and, for an uncached artwork, the first-time docent sentences — stream in via the `scans` subscription; "Not right?" action.
- **Saved records** are written locally as snapshots (§4.2, *Moves*) and mirrored to the server for the device's own session; the user's photo stays local.
- **Connectivity:** every identification needs a connection; the payload is ~20 KB up and a few KB down, retried with backoff. Optimistic updates keep saves instant; the pending-scan queue flushes on reconnect.

### 5.2 Backend services

Three, and only one of them is on the request path.

1. **Convex — the whole request path:** database, anonymous sessions and optional accounts, file storage for consented crops, crons, real-time sync of `scans` and `indexStatus`, and the `identify` action itself: Convex's built-in vector search over the `vectors` table (filter field `modelVersion`), candidate descriptors read from the `descriptors` table, ORB matching and RANSAC homography in plain JavaScript, the calibrator, and the `scans` write — all in the default runtime, which has no cold start. Every request from the phone goes through a Convex action: one auth model, one rate limiter, one writer of `scans`. Convex Pro is required from the index build onward (§10).
2. **Nebius Serverless Jobs — everything batch:** the corpus build (§5.7) on an L40S; the queue-driven crawler from §4.2 on CPU-only jobs with the polite fetcher and per-host limits; the enrichment job (§4.8); the `reembed` migration job (§5.4); and, when the deferred item in §3 ships, contribution re-embedding. Jobs embed with the same weights the phone runs (§5.7). A job runs, writes to Convex through the Python client, and exits; nothing stays up.
3. **Nebius Token Factory — the language and vision models:** Nemotron Nano 2 VL / Nano Omni for label reading, Nemotron 3 Nano for docent prose and moderation, Nemotron 3 Super for fact sheets, called from Convex actions and from the enrichment job over the OpenAI-compatible API.

The vector database, the inference endpoint and the object store from the previous design are gone. What they did now happens on the phone (embedding, descriptor extraction) or inside a Convex action (search, verification, calibration).

### 5.3 Data model

Convex throughout.

| Table | Purpose | Key fields |
|---|---|---|
| `artworks` | The work as a concept | wikidataId, title, artist, artistId, date, `rightsStatus`, `multiplicity`, `seriesId`, `factSheet`, `docent` (keyed by language; only `en` is generated) |
| `objects` | One physical painting | `id = source:sourceId`, artworkId, `ownerId`, accession, medium, dimensions, `source` (corpus / crawl / user), `imageRef`, `thumbnailUrl` (public-domain only; hotlinked, never stored), `confirmCount`, `rejectCount`, calibrator penalty, provenance, `mergedInto` |
| `placements` | Where an object is, and was | objectId, venueId, gallery, onView, from, to, `source` (feed / checklist / crawl / proposal / manual), confidence |
| `placementProposals` | Scan-derived move evidence | objectId, proposedVenueId, scanIds, deviceIds, `status` (pending / promoted / rejected), reviewer, reviewedAt |
| `vectors` | Vector index | objectId, `modelVersion` (vector-index filter field), `source` (corpus / crawl / user / user_scan), `vector` (768 floats under a Convex `vectorIndex`) |
| `descriptors` | ORB keypoints and descriptors per object | objectId, `descriptors` (bytes), `keypoints` (bytes), `keypointCount`, `extractedFrom` (imageRef / contributionId) |
| `museums` | Venues, crawl state, opt-out | name, coordinates, `website`, `collectionSiteUrl` and platform, accession URL pattern, `seedSource` (wikidata / poi / manual), `region`, `optOut`, `crawlPolicy` (robots and terms, checked at), `queuePriority`, `indexStatus`, `lastCrawledAt`, `changeDetection` (sitemap lastmod / etag) |
| `artistContext` | "Right now" cache | artistId, region, text, sourceUrl, sourceLabel, fetchedAt (7-day TTL) |
| `contributions` | Label captures | deviceId, venueId, embedding, `modelVersion`, descriptors (bytes), crop file id (consented), raw OCR JSON, edited fields with edited flags, evidence (accession / qr / wikidata / agreement), `status` |
| `feedback` | Rejections | scanId, deviceId, embedding, `modelVersion`, venueId, rejectedObjectId, score, margin, orbInliers, probability, venueMismatch, resolution |
| `scans` | Live progress | per-scan status document the app subscribes to; carries "Right now" and, for uncached artworks, the first-time docent sentences as they arrive; `waiting` scans keep their embedding until the venue's crawl completes |
| `devices` | Identity | App Attest key id, first seen, trust weight, banned flag, `accountId` (optional) |
| `accounts` | Optional sign-in | Apple user id, linked deviceIds, createdAt |
| `collections`, `visits` | Immutable snapshots; visit context | savedAt, venueId, gallery, snapshot fields (title, artist, date, medium, institution as displayed and edited), objectId (enrichment pointer only), deviceId, accountId (optional); on `visits`, `lastConfidentGallery` and `lastConfidentAt` — the calibrator's gallery feature (§4.1), set by every *confident* result and stale after fifteen minutes |
| `optOuts`, `takedowns` | Rights | venueId / artworkId / objectId, requester, receivedAt, appliedAt |

**Actions and crons:**

- `startVisit(venueId)` — records the visit for the device; if the venue is un-indexed or stale and off cooldown, moves it up the crawl queue (capped per device per day, §8). For a POI the phone proposed and the user confirmed, probes the website for a collection section and inserts the row with `seedSource: poi`.
- `identify` — every scan: takes the phone's vector, descriptors and keypoints, `venueId`, the visit's current gallery and `modelVersion`; one Convex vector search on `vectors` filtered by `modelVersion` (top ~20); loads the candidates' objects and current placements; ORB matching and RANSAC homography against each candidate's stored descriptors, in JavaScript; the calibrator; returns candidates with probabilities, attributes and the artwork's corners. The embedding stays on the `scans` document. If the venue's `indexStatus` is `building`, marks the scan `waiting` and re-queues it on completion. A *confident* result updates `visits.lastConfidentGallery`. A `modelVersion` below the minimum supported one gets an "update the app to identify" status instead (§5.4).
- `enqueueVenue`, `crawlScheduler` (cron) — the queue and its priority order (§4.2); replaces the former `indexVenue`, `prewarmVenues` and `refreshOnView`. Change detection runs from the same scheduler.
- `ingestChecklist` — exhibition checklists to time-bounded placements.
- `docent` — returns `artworks.docent.en` when present. On a miss: loads or generates the fact sheet, calls Nemotron 3 Nano on Token Factory, validates `fact_ids`, writes the sentences to the artwork and to the `scans` document (§4.8). Also invoked by the enrichment job so the cache is warm before the first scan.
- `rightNow` — checks `artistContext` for the artist and region; on miss, one Tavily search with `include_answer`; applies the score and window guards; caches; writes to the `scans` document (§4.8).
- `readLabel` — sends the label photo to Nano 2 VL on Token Factory; returns structured JSON.
- `verifyLabel` — accession lookup on the current venue's site, Wikidata pair check, Tavily fallback; writes evidence.
- `contribute`, `rejectMatch`, `resolveRejection` — validate the App Attest assertion, then write `contributions` / `feedback` keyed to `deviceId`; all rate-limited (§8). `contribute` attaches the vector and descriptors as the phone computed them, plus the consented crop; re-embedding from the crop at promotion is deferred (§3, §8).
- `saveToCollection` — writes the snapshot to `collections` and `visits`; increments `confirmCount` only when title and artist were left as suggested (§4.6).
- `promote` (cron) — applies the promotion rule (§4.7) to contributions, inserting into `artworks` / `objects` / `placements` / `vectors` / `descriptors` and storing the thumbnail; routes placement proposals that meet the agreement rule to the review queue.
- `reviewPlacement` — human approval or rejection of a proposal; approval writes a new placement with `source: proposal` and closes the old one.
- `retrainCalibrator` (scheduled, manual until the evaluation harness exists) — new versioned calibrator from `feedback` (§4.3).
- `reembed(modelVersion)` — the migration job (§5.4), run on Nebius.
- `linkAccount`, `syncCollection` (§5.6).
- `correctFact` — museum or estate correction from the card's form; invalidates cached sentences.
- `revertDevice`, `applyOptOut`, `applyTakedown` — cascade removal from the index and, for a device, un-promotion of everything it touched.
- Soft-identification, label-flow and enrichment steps write progress to the `scans` document; the app renders it reactively with `useQuery`.

**Model calls:** Nemotron Nano 2 VL / Nano Omni (label reading, structured extraction, multi-image verify), Nemotron 3 Nano (docent prose, once per artwork; moderation) and Nemotron 3 Super (fact sheets) via Token Factory's OpenAI-compatible API from Convex actions and the enrichment job.

### 5.4 Model versioning and migration

The embedding model will change — a newer C-RADIO, a fine-tune on the hard negatives the feedback loop collects. The model ships inside the app, so a model change is an app release, and the index must serve both versions until users have updated.

- **Every vector carries `modelVersion`, and so does every request.** Convex's vector index filters on it, so one table holds every version and a query only ever sees its own.
- **Source of truth for re-embedding is `imageRef`, never a user's scan.** For open-access and Wikidata works it is the source image URL (Met CDN, AIC IIIF, Commons), re-downloaded at migration time — days at polite rates, the accepted price of storing no images; for crawled works it is the page or image URL, and re-embedding means re-running the polite crawler with the new model; for user-contributed works it is the consented crop (§4.7), the only image the system keeps. `user_scan` multi-view vectors belong to the version that produced them and regrow from feedback after a migration. Objects whose ref is dead are flagged and keep only their old-version vector until a consented contribution provides a new one.
- **The migration is adoption-bound.** A new app version ships the new model; `reembed(newVersion)` backfills the new version's vectors on a Serverless Job, and new clients match against them as rows land while old clients keep matching against the old version. When the backfill is complete and adoption crosses a threshold, the old version's vectors are deleted and the minimum supported `modelVersion` is raised. An older client can still browse and save; its scans queue with "update the app to identify," and because the phone kept every crop, the updated app re-embeds them locally and runs them through the queue with no server help.
- **Phone and index share numerics.** The index is built with the same int8 weights the phone runs, dequantized to fp16 (§5.7); a drift check on a calibration set is part of every export and every build (§12).
- **Descriptors are not versioned.** ORB is a fixed algorithm; descriptors are extracted once from the ref and reused by every embedding version.
- **Deferred (§3):** training each new model with a compatibility loss against the previous one so old vectors stay directly queryable during the backfill; delivering the model as a downloadable asset rather than part of the app binary, which would decouple a model update from an app update.

### 5.5 Rights and what is stored

`rightsStatus` on every artwork: `public_domain`, `in_copyright` or `unknown`, derived conservatively from Wikidata (`P570` date of death, `P6216` copyright status), the Met's `isPublicDomain`, the AIC's `is_public_domain`, and rights lines on crawled pages. `unknown` is treated as `in_copyright`. This one field decides what is stored and what can be trained on:

The metadata job's policy (02.03) accepts an explicit institutional public-domain
flag or Wikidata `P6216 = Q19652`; without one, all identified creators must have
known death years at least 100 years before the run's UTC year. A creator who
died less than 70 years ago, an explicit copyright notice, or `P6216 = Q50423863`
produces `in_copyright`. The intervening years, missing evidence, false
institutional flags, and unrecognized copyright-status claims remain `unknown`.
An explicit copyright claim wins over a public-domain claim. Merging sources
uses the most restrictive result (`in_copyright`, then `unknown`, then
`public_domain`) and removes every linked object's thumbnail URL on a downgrade.
These artwork classifications do not override image-access blocks or the
file-specific source admission rules in [decision 005](../decisions/005-data-sources.md).

| | `public_domain` | `in_copyright` / `unknown` |
|---|---|---|
| Embedding, ORB descriptors, link to the museum page | stored | stored |
| Thumbnail from the source image | hotlinked from the source at ~256 px; never stored | never |
| Card thumbnail shown to a visitor | the source's image, hotlinked; the visitor's own photo if the link fails | the visitor's own photo, on their phone |
| Contributor's crop (≤ 256 px, consented) | stored | stored — the user's photograph, with consent, as card thumbnail and `imageRef` |
| What a scan sends | a vector and descriptors; the crop never leaves the phone | a vector and descriptors; the crop never leaves the phone |
| Source image during the index build | streamed through a scratch bucket and deleted with the run; never stored | streamed through a scratch bucket and deleted with the run; never stored |
| Training eligibility — any model that learns from works or their embeddings (retrieval fine-tunes) | yes | consented contributions only |

A scan sends no pixels: the phone embeds its own photograph and sends a vector and descriptors, which cannot be turned back into the image, so identification itself never copies anyone's work. The only image that ever leaves a phone is a contribution crop the user chose to share, and no museum image is ever kept. The training rule is the same for every model that learns from works: retrieval fine-tunes train on this set, and the calibrator's initial augmented samples are drawn from it too (its later retraining uses scores and feedback, not works). EU text-and-data-mining opt-outs are honored at crawl time; the training set is versioned so a takedown means retraining from a purged set rather than promising unlearning. Retention and deletion policy for scans, feedback and venue-derived data is deferred (§3). None of this is legal advice; review with counsel before launch.

### 5.6 Identity

**Device identity, always.** Convex Auth anonymous sessions carry the app's reads and writes; a visitor opens the app and scans immediately. Anything that touches shared state — contributions, rejections, venue confirmations, queue bumps — is attributed to the device's App Attest key, which Apple binds to one app install on one physical device. That key is the identity for rate limits, promotion agreement, trust weighting and revert (§8), signed in or not. A reinstall mints a new key: an attacker pays one reinstall on one real iPhone per identity.

**Optional account, for sync only.** Sign in with Apple. The account is a sync target and nothing more: it links one or more device identities, pulls the collection down to a new phone, and aggregates contributions and trust across linked devices. Local-first stays as it is: the phone is the primary store; signing in on a device that has been used anonymously merges the local collection up with no loss; signing out leaves local data in place; export works with or without an account. Linking devices to an account does not pool their rate limits, and agreement still requires distinct App Attest keys (§8). Never required.

### 5.7 Index build

Nebius Serverless Job, L40S, in order:

1. **Seed the venues.** One SPARQL query for every museum and gallery with coordinates and a website → `museums` rows with `seedSource: wikidata`, `region`, and `indexStatus: none`; the same rows are packaged into the venue table the app ships. Collection-site URL, platform and accession URL pattern are filled by the crawler's discovery step (§4.2), or by hand for any venue where discovery fails.
2. **Metadata first.** Pull the Met and AIC dumps and the Wikidata SPARQL results into normalized `Artwork`, `Object` and `Placement` records — with `rightsStatus`, `ownerId` (collection / department mapped to a `museums` row), current location, accession, `onView`, imageUrl, pageUrl — before downloading any image. Set `multiplicity` from Wikidata (multiple items sharing a title and artist, series properties) and record `seriesId` where the data makes a series obvious. Unmapped works are indexed with no current placement.
3. **Download to scratch.** Images are pulled at ~1024 px on the long side into a scratch bucket that exists only for the run and is deleted when it ends. Downloading is the slow, flaky part — Commons rate limits, dead links, IIIF hiccups — so the job checkpoints per source and resumes, but no image outlives the build. `imageRef` is always the source URL.
4. **Embed and extract from scratch** with C-RADIOv3-B using **the phone's weights**: the int8 weight-only checkpoint the CoreML export was made from, dequantized to fp16 — the same numerics as the phone's fp16 compute — at the fixed input resolution and letterbox from §4.1, in batches of 64–128, tagging every vector with `modelVersion`; extract ORB descriptors in the same pass, from the same letterboxed input the scan uses, and record `keypointCount`; write a manifest. Before any full run, the drift check: embed a few hundred calibration images on an iPhone and on the job and require cosine above 0.99 between the two (§12). GPU time is not the bottleneck; downloads are.
5. **Deduplicate by owner.** Merge on (`ownerId`, accession) when both records have one; otherwise merge when two embeddings from different sources land above ~0.95 cosine with a matching artist. Keep both vectors under one object — an owner's studio photo and a visitor's Commons photo of the same canvas are the multi-view pair the index wants from day one. Record every merge in `objects.mergedInto` so a rebuild reproduces it. Never merge across owners: a print edition at the Met and the AIC is legitimately the same image and legitimately two objects, and the calibrator's venue feature resolves it at query time.
6. **Flag hubs.** Any object whose embedding has an abnormally high mean similarity to the rest of the index — monochromes, near-uniform abstracts — gets a calibrator penalty before launch.
7. **Push.** Artworks, objects and placements to Convex via the Python client, in batches sized under the mutation write limit so a failed batch is resumable; vectors as `vectors` rows, which Convex indexes; descriptors and keypoints as bytes on `descriptors`; a `thumbnailUrl` for public-domain works pointing at the source's own thumbnail endpoint (Met CDN, AIC IIIF size parameters, Commons thumb URLs), never a copy. Crawled museums push embeddings, descriptors and links only.

The job's scripts live in the repo so the index can be rebuilt from scratch; `reembed` (§5.4) is the same job run against refs instead of dumps.

**Enrichment** (Nebius Serverless Job, or a Convex cron calling Token Factory in chunks): Nemotron 3 Super writes the fact sheet (§4.8) from the owner's page, Wikidata and score-filtered Tavily context, then Nemotron 3 Nano writes and the validator checks the docent sentences, both cached on the artwork. Precomputed for on-view works at indexed venues in crawl-queue order, to a daily budget, and on every promotion; generated-and-cached on first identification for everything else.

**Storage sizing on Convex.** A `vectors` row is ~6 KB as a float array, and its index entry a few KB more: 300k objects ≈ 2–3 GB, 1M ≈ 6–10 GB, with vector-index storage billed beyond the 1 GB Pro includes at $0.50 per GB. Descriptors at 300 keypoints are ~11 KB per object, ~3.3 GB at 300k. Metadata is ~1.5 KB per object across the three tables. All of it sits inside Pro's 50 GB database allowance at 300k, and a few dollars a month above it at 1M. If the DINOv2-adaptor summary is the teacher's 1,536 width rather than the backbone's 768 (verify at kickoff, §4.1), the vector figures double; the backbone summary at 768 is the fallback if that matters. Convex holds no images beyond consented crops.

### Where each NVIDIA / Nebius component is used (for the README)

| Component | Model / service | Where |
|---|---|---|
| Image embedding | NVIDIA C-RADIOv3-B — CoreML (int8 weights, fp16 compute) on the phone for every scan; the same weights on Serverless Jobs for the index and every migration | On device; Nebius AI Cloud for the build |
| Label reading, multi-image verify | NVIDIA Nemotron Nano 2 VL / Nano Omni | Token Factory, live on every label capture |
| Docent prose (once per artwork, cached), moderation | NVIDIA Nemotron 3 Nano | Token Factory, from the enrichment job and on first identification of an uncached artwork |
| Fact sheets | NVIDIA Nemotron 3 Super | Token Factory, from the enrichment job |
| Corpus build, crawling, re-embedding, enrichment | Nebius Serverless Jobs | Nebius AI Cloud, run to completion; nothing idle |
| Vector search, ORB verification and calibration of every scan | Convex vector index + JavaScript in the `identify` action | Convex Cloud |
| App backend (DB, files, sessions, accounts, sync) | Convex | Convex Cloud — calls Token Factory |

---

## 6. Tech stack

**App**

- Expo SDK, Expo Router, TypeScript
- `react-native-vision-camera` (dev client; TestFlight needs one anyway) with its code scanner for QR codes; `expo-image-picker` for library import; `expo-image-manipulator` for resize
- Rectangle detection through Apple's Vision framework (`VNDetectRectanglesRequest`) in a Vision Camera frame processor, so it runs live on the preview and gates the shutter; the same native module does the inner-rectangle preference and the perspective warp (`CIPerspectiveCorrection`) on capture; `expo-image-manipulator` for the resize and letterbox
- **CoreML runner:** a small Expo native module that loads the bundled C-RADIOv3-B `.mlpackage` (int8 weights, fp16 compute) and returns the summary vector. **ORB:** OpenCV via `react-native-fast-opencv` or a small native module (verify at kickoff, §12). With the rectangle module, three native modules, all in the dev client
- `expo-location` for a one-shot fix on open and on scan; MapKit local search via a small native module for the POI fallback
- `expo-sqlite` + Drizzle for the shipped venue table, the pending-scan queue (vectors, descriptors, label photos), the collection, visits and notes; `expo-file-system` for photos
- Zustand or TanStack Query; NativeWind or StyleSheet
- EAS Build for iOS; TestFlight public link for testing and distribution
- App Attest via a native module (no first-party Expo module; verify options at kickoff); Sign in with Apple via `expo-apple-authentication`

**Backend**

- Convex: queries/mutations/actions, vector search (`vectorIndex` on `vectors`, filter field `modelVersion`), file storage, crons, Convex Auth (anonymous sessions plus optional Apple sign-in); `@convex-dev/rate-limiter` component; `convex/react` client in the Expo app
- Inside the `identify` action, default runtime: brute-force Hamming matching with a ratio test, RANSAC homography (a small pure-TypeScript implementation), and the calibrator (logistic-regression weights as a versioned constant)
- Nebius Serverless Jobs: Python, PyTorch or ONNX Runtime for the build embed with the phone's weights, OpenCV for ORB, the per-host polite fetcher (rate limit, `Crawl-delay`, conditional requests, identified User-Agent), platform parsers, Tavily SDK for Map, Convex Python client for writes
- OpenAI SDK in Convex actions pointed at `https://api.tokenfactory.nebius.com/v1/`
- Tavily SDK in Convex actions (verification, "Right now", cache-miss enrichment)
- No VM, no endpoint, no vector database, no object store outside a running job

---
## 7. Tavily

The Best Use of Tavily prize goes to submissions that make a functional, runtime call to the Tavily API as part of the solution. A batch job that ran ahead of time is a weak reading of "runtime," so the design keeps three live paths and two background ones, all behind feature flags so the core identification loop never depends on Tavily.

**Runtime (live during use)**

1. **"Right now"** (§4.8) — one search with `include_answer`, `topic: news`, a one-month window, and domains drawn from the venue's region; Tavily's answer is shown directly, guarded and truncated, cached per artist and region for a week. This is the call that fires on the primary loop.
2. **Label verification** (§4.4) — museum-scoped search with images finds a page and a picture for a label's title + artist pair when the accession and Wikidata checks fail; the embedding model decides.
3. **Cache-miss enrichment** — an artwork with no fact sheet yet (a work at a venue the enrichment queue hasn't reached, a work just promoted) gets its Tavily research at scan time, score-filtered, feeding Super's fact sheet, then Nano's prose, both cached. Progress is shown on the card ("searching the web…").
4. **Venue discovery from the crawler** (§4.2) — when a museum has no API, IIIF manifests or sitemap, Tavily Map is how the crawler finds its artwork pages; walking into an un-indexed museum moves it to the front of the queue, so the Map call is still on the critical path of a whole visit. Tavily Crawl sits behind a per-site flag for sites the parser can't handle.

**Background**

5. **Fact-sheet context** — exhibition history, restoration, auction, attribution debates; things museum APIs never provide. Precomputed for on-view works at indexed venues in crawl-queue order, to a daily credit budget, and on every promotion.
6. **Pre-indexing** (§4.2) — the crawl scheduler works through the queue nightly, nearest un-indexed museums to active users first, to the day's Map budget.

**Credits.** Basic search is 1 credit, advanced 2; `include_answer` doesn't add to that. Map is 1 credit per 10 pages discovered (2 with natural-language `instructions`), so a 2,000-page run is ~200 credits; sitemaps and APIs are free and preferred, Map is the fallback, and we do our own fetching rather than paying Extract per page. The per-artist weekly cache is what keeps "Right now" bounded: a few hundred credits a month at 1k MAU, not one per scan. The 1,000 free credits go fast if "Right now" is on during museum testing — keep the flag off during testing and on for release.

**The prize story in one line:** Tavily proposes candidates and pixels decide (verification), Tavily finds the sources every docent sentence links to (fact sheets), and Tavily answers the "now" question end to end ("Right now").

---

## 8. Trust and safety

The shared index is the feature most worth attacking: flood it with junk, attach offensive labels to real works, or drive up our model bill. Controls, in priority order.

**Nothing a single device does is visible to anyone else.** Contributions and placement proposals are private until promoted; rejections only move aggregates. This is the foundation; everything else makes promotion hard to game and damage reversible.

**Shared contributions cost something.**

- Every write to shared state is attributed to a **device identity**: the App Attest key, which Apple binds to one install of our app on one physical iPhone (§5.6). The identity costs a real device, and minting another costs a reinstall on a real device. An optional account links devices for sync but never substitutes for the key: linked devices don't pool rate limits, and agreement still requires distinct keys.
- **App Attest** verifies that contribution, rejection, venue-confirmation and queue-bump requests come from our genuine app on that device. This alone defeats scripted flooding, the cheapest and most likely attack.
- **Rate limits** via the Convex rate-limiter component, keyed to the device: contributions per device per hour, rejections per device per work per day, venue confirmations and queue bumps per device per day, VL, Nano and Tavily calls per device, and a global daily spend cap with a kill switch on the label flow and on "Right now."
- Contributions must originate from a device resolved to the venue.

**Promotion is Sybil-resistant.** "Two scans agree" requires distinct App Attest keys on distinct physical devices, both resolved to the venue, ideally on different days; identical vectors are rejected as replays. A simple trust weight applies to agreement: new devices count fractionally, devices with previously confirmed contributions count fully, so a freshly minted key is worth little until it has been right before. Strong evidence (accession resolves on the museum's site, QR code) promotes alone because the museum, not the user, is the authority. Placement proposals additionally require human review (§4.2).

**Labels are checked against reality before being believed.**

- The artist must resolve to a Wikidata entity with an artist occupation; the date must fall within the artist's lifespan; the venue must plausibly hold that artist.
- Extracted fields pass a text moderation check (Nemotron 3 Nano or blocklist) for slurs and personal information; the consented crop passes an image moderation check before it can become a thumbnail.
- Fields the model read from a physical label carry more trust than fields the user typed over; verified fields are locked in the UI, and unlocking one to edit it downgrades its evidence (§4.4). User-edited title or artist always needs agreement.

**The phone's vector and descriptors are trusted — for now.** The phone computes the embedding and the descriptors and the server uses them as sent, so a modified client could submit a forged vector. What that buys an attacker: private results that only they see, and contributions that still have to pass App Attest, rate limits, the plausibility checks above, near-duplicate and hub rejection, and either museum-verified evidence or agreement from an independent device before anyone else sees them. The consented crop is stored with every contribution, so the fix — re-embedding and re-describing from the crop on a Serverless Job before promotion, so promotion never trusts a phone-computed vector — is a job to add, not a data migration; it is recorded in §3 as deferred and not implemented for this project. Contribution vectors that near-duplicate existing objects or show abnormally high mean similarity across the index are rejected today.

**Generated text is grounded.** Docent sentences must cite facts from the sheet or they are dropped before they are cached (§4.8); fact-sheet sources are score-filtered; "Right now" shows nothing rather than something when the search comes back thin. Neither section can carry a claim with no source behind it.

**Crawls are central, polite and bounded.** No user action starts a fetch loop; the most a device can do is move a real museum up the queue, capped per device per day, so a spoofed location can at most reprioritize a bounded crawl of a real museum's public site. The crawler only ever fetches the website of a seeded museum row or of a POI the phone's map search returned, and only if that site has something that looks like a collection section — no user-typed URLs, ever. Per-host rate limits, `Crawl-delay`, an identified User-Agent, robots.txt and terms checked at enqueue time, a per-run page cap, a global daily Map budget with a kill switch, and a per-museum opt-out registry honored retroactively (§4.2).

**Rejections are bounded.** Calibrator retrains use trimmed statistics and a minimum number of distinct devices, and movement between versions is capped; unresolved rejections carry near-zero weight. A coordinated campaign costs many real devices to move the calibrator slightly, for one retrain.

**Everything is reversible.** Promoted entries and placements carry provenance; user-contributed objects are tagged by `source`; banning a device cascades to un-promote everything it touched, including its thumbnails and any placement it helped propose. Opt-outs and takedowns cascade the same way. Worst case is wiping the user layer and rebuilding from the corpus, which the Serverless Job does in about an hour. Flagged items and placement proposals land in a review queue in the Convex dashboard; manual review is sufficient at this scale.

**Hackathon build:** App Attest for sharing, rate limits, provenance with cascade revert, the Wikidata / lifespan checks, the docent validator, the polite fetcher and opt-out check. Trust weights and the placement review queue are second priority.

---

## 9. Latency targets

| Path | Target | What happens |
|---|---|---|
| Identify (every scan) | ~0.6–1.2 s from tap to card | Live rectangle detection before the shutter; warp, resize and triage on the phone (<100 ms); CoreML embed on the Neural Engine (~0.1–0.3 s); ORB extraction (~50 ms); ~20 KB upload; in the Convex action, vector search (~50–100 ms), descriptor reads (~50 ms), Hamming matching and RANSAC for the top candidates in JavaScript (~100–300 ms), calibrator; card from precomputed metadata. Nothing cold-starts |
| Scan with no signal | Card appears when the connection returns | Vector, descriptors, venue, timestamp and any label photo queued locally with a "waiting for signal" state; identified in order on reconnect, label flow run automatically on a miss |
| Docent prose | with the card (cached); 2–3 s after the card on the first identification of an uncached artwork | Read from `artworks.docent`; on a miss, Nano on Token Factory from the fact sheet, validated, cached, streamed via the `scans` subscription |
| "Right now" | 1–2 s after the card on a cache miss; instant on a hit | One Tavily search; per-artist, per-region cache |
| Label flow | 3–6 s after the second shot, with progress UI | QR check → OCR → accession / Wikidata verify → card |
| Soft identification | Soft card at once | Triage → calibrator ranking of the global candidate set → runner-ups → card |
| Venue resolution | <50 ms, on device | Nearest row in the shipped venue table; POI search only when nothing seeded is nearby |
| Indexing a new venue | Minutes to ~35 min for a 2,000-page site, in the background, at polite fetch rates | Queue bump → discover → polite fetch-and-embed on a Serverless Job → rows searchable as they land; waiting scans re-run on completion |

Rules: nothing idles and nothing cold-starts — the model is already in memory on the phone and Convex's default runtime has no cold start; nothing on the card waits for a model call — title, artist, date and institution appear the moment the calibrator decides and the generated sections fill in behind them; stream everything that streams.

---

## 10. Cost estimate

Token Factory prices verified September 7, 2026: Nemotron 3 Super $0.30 / $0.90 per 1M input / output tokens; Nemotron 3 Nano and Nano Omni $0.06 / $0.24. Convex Pro: $25 per developer per month, 50 GB database, 100 GB file storage, 1 GB vector storage then $0.50 per GB, 25M function calls; the free Starter tier is 0.5 GB database and 1 GB file storage, which the index outgrows on day one. Nebius: L40S $1.35 per GPU-hour; CPU jobs $0.012 per vCPU-hour plus $0.0032 per GiB-hour, billed per second only while a job runs. Tavily: 1 credit per basic search, 2 per advanced.

| Component | Idle | Hackathon month | ~1k MAU (~10k scans) |
|---|---|---|---|
| Convex Pro (backend, DB, vector search, files — the whole request path) | $25 + ~$1–2 vector storage | $25 + ~$1–2 | $25 + ~$2–5 (vector storage; small bandwidth overages) |
| Nebius Serverless Jobs (build, crawl, enrichment, migrations) | $0 | ~$5–10 (build on an L40S ~$3–5; crawls on CPU jobs, cents per venue) | ~$5–15 (nightly crawl and enrichment jobs) |
| Nano 2 VL / Nano Omni (label reading, verify) | $0 | <$1 | $3–8 |
| Nano text (docent prose once per artwork, ~800 in / 150 out tokens; moderation) | $0 | <$1 | <$1 |
| Super (fact sheets, once per artwork) | $0 | ~$15 on-view works at indexed venues | <$3 |
| Tavily ("Right now" per-artist weekly cache, verify fallback, cache-miss enrichment, crawler Map at ~200 credits per venue without a sitemap) | $0 | $0–5 (1,000 free credits, spent to a daily budget) | $10–60 |
| Apple Developer Program | $8 (amortized) | $99 (one-time enrollment) | $8 |
| EAS Build | $0 | $0 | $0–19 |
| **Total** | **~$35/mo** | **~$150–165 incl. Apple; ~$50–65 otherwise** | **~$55–145/mo** |

**One-time index build:** ~$3–5 of L40S time to embed the corpus and the full Wikidata painting set with C-RADIOv3-B and extract descriptors; ~$15 of Super tokens for fact sheets on all on-view works at indexed venues. Covered by the $50 promo credits.

**Two traps to avoid:** an always-on server of any kind — the only recurring bill is the Convex seat, and every Nebius resource runs to completion and exits. And Tavily per scan rather than per artist (10k scans ≈ 10k credits, $80), which is why "Right now" is cached per artist for a week and fact-sheet precompute runs in queue order to a daily budget. Venue indexing has its own version of this trap — paying Tavily Extract per page instead of a sitemap or Map per ten — and its own guard: sitemaps and APIs first, one run per venue per cooldown, page-capped, and a daily Map budget.

**Scaling driver:** Tavily, not tokens and not compute. Cache by artist and by artwork ID and it stays small.

---
## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Retrieval accuracy on real museum photos is worse than on clean images | Train the calibrator on augmented samples before launch; retrain from feedback; multi-view entries from resolved rejections; venue and gallery features keep the calibrator strict; test at real museums before submission |
| A museum is poorly covered by open corpora | The crawler covers any museum with a collection site; the label flow covers the rest |
| A collection site has no crawlable artwork pages, blocks crawling, or hides images behind a viewer | Platform detection in the crawler's discovery step; `og:image` fallback; a site that can't be mapped is marked `no_index` and served by the label flow; robots.txt and terms are honored, never worked around; opt-outs cascade |
| Polite crawl rates make in-visit indexing too slow to help the visit that triggered it | Pre-index by priority so in-visit indexing rarely runs; sitemaps and APIs are faster than Map; on-view listing pages first; rows searchable as they land; waiting scans re-run automatically; the label button never waits |
| Venue resolution picks the wrong museum, or none | Nearest seeded row within ~150 m, on device; when two are close, the "Looks like you're at X" sheet with a one-tap switch; venue is a calibrator feature, so a wrong pick lowers scores rather than causing misses, and the online global search still works with no venue at all |
| A painting on loan or rehung isn't where the index says | Venue is a feature, not a filter, so it still matches; exhibition checklists and on-view feeds write placements; scan-derived placement proposals with agreement and human review; saved records are unaffected either way |
| A reproduction or second version is mistaken for a moved painting | `multiplicity` decides the proposal type; human review before any placement promotion; museum data promotes alone, crowd evidence never writes placements directly |
| Embedding-model change breaks the index | `modelVersion` on every vector and every request; the new version backfills on a Serverless Job from `imageRef` (a re-download at polite rates, days not hours — accepted) while old clients keep matching against the old version; a minimum supported version retires it, and an old client re-embeds its queued crops locally after updating (§5.4) |
| Convex vector search is unproven at this scale | Measure at 300k and 1M vectors at kickoff (§12); filter on `modelVersion`; if the numbers fall short, the response is decided on the evidence (a smaller first-release corpus, a lower `limit`, or a different store) — no standby VM is planned |
| Phone-computed vectors and descriptors can be forged | Accepted for now (§3, §8): a forged vector only misleads the forger's own private results; shared contributions still need App Attest, rate limits, the Wikidata and lifespan checks, near-duplicate rejection, and agreement or museum evidence to promote; the consented crop is stored, so re-embedding at promotion can be added without a data change |
| Phone and index embeddings drift apart | Same int8 weights, dequantized to fp16 on the job; a drift check on a calibration set before every export and every build (§5.7, §12) |
| Native plumbing eats the schedule | Three native modules — rectangle detection with the perspective warp, the CoreML runner, and OpenCV for ORB — plus the dev client; community modules exist for the last two (§12); the crop never leaves the phone, so nothing else is native and nothing is on a server we run |
| Rectangle detection can't find the painting (low contrast against the wall, an unframed canvas, a crowded wall) | The viewfinder tells the user what to change and the shutter waits for a stable quad; the user never draws the crop by hand (§4.1); if a work can't be framed, the label flow still works from any photo of the label |
| Color-field and monochrome works can't be geometrically verified | `keypointCount` recorded at build time; low-texture objects use a stricter similarity-and-margin rule with venue agreement instead of a homography (§4.3); more of them land on the soft card, where the label is one tap away |
| Solo/small team, scope too large | Stretch and deferred lists are explicit (§3) |
| TestFlight review or Apple enrollment delay | Enroll on approval; submit the first external build early so Beta App Review clears before museum testing; later builds rarely need re-review |
| Museum cellular is poor | The upload is ~20 KB — a vector and descriptors — retried with backoff; a scan with no signal is embedded on the spot and queued, then identified on reconnect with a clear state; museum Wi-Fi where it exists; venue bundles are the stretch answer (§5.1) |
| Newer Nemotron VL model changes the API | Model ID is a config value; verify at project start |
| `rightsStatus` is wrong or missing | Default to `in_copyright`; multiple sources combined conservatively; takedown process; storage rules keyed to the field so a correction cascades |
| Docent prose says something wrong | Grounded on a reviewed, score-filtered fact sheet, temperature 0, validator drops any sentence without a source before caching; museums and estates can correct a fact from the card, which invalidates the cached sentences (§4.8) |
| Tavily's "Right now" answer is off-topic or wordy | Score and time-window guards show nothing rather than something; first sentence only; labeled "From the web" with the source; feature flag |
| Copyright on crawled contemporary works | Store embeddings, descriptors and links only — no museum image is ever kept for any work; card thumbnail is the user's own photo (lesson from Magnus, §1.1); user-contributed thumbnails are the contributor's own photograph with consent; `rightsStatus` governs everything else (§5.5) |
| Third-party data terms (WikiArt dataset, museum-site crawls) | Verify licenses and robots/terms at kickoff and at enqueue; drop any source that doesn't allow it; the label flow covers the gap |
| Backend goes down while the app is in use | The request path is Convex, a managed service with no server of ours to restart; Token Factory outages only delay label reads and first-time docent text, never identification; TestFlight builds expire after 90 days, so a fresh build ships before expiry |
| Bad actors flood or poison the shared index | Private-until-promoted, App Attest device identity, rate limits, Sybil-resistant promotion, plausibility checks, provenance with cascade revert (§8) |
| Reinstalls mint fresh device identities | Accepted; a fresh key has a fractional trust weight, is rate-limited like any other, must be resolved to the venue, and can only promote alone on museum-verified evidence; an account restores the user's own continuity without changing any of this |
| Spoofed locations | Venue resolution is on-device and the server only sees a `venueId`, so the most a spoof can do is claim presence at a real museum: a bounded queue bump, capped per device per day, and contributions that still need agreement |
| Wrong user rejections degrade the calibrator | Rejections move aggregates only, trimmed statistics, minimum distinct devices, capped movement per retrain; `false_rejection` detection via the label; edited saves count as neither |
| First scan after idle is slow | Nothing cold-starts: the model is in the app, and Convex's default runtime has no cold start |
| Convex is not offline-first | Identification needs a connection by design; the collection is local-first and browsable offline; the pending-scan queue flushes on reconnect; the photo is kept locally so the user can retry |
| Convex hosts the app backend rather than Nebius | The requirement is Token Factory *or* AI Cloud with at least one NVIDIA open model, and this design uses both: every label read and first identification makes a live Token Factory call and the docent cache is Nemotron output (§4.8); the index is built, crawled, enriched and migrated on Serverless Jobs; C-RADIO is NVIDIA's model on every scan. State all of it in the README, including that nothing idles on Nebius by design |

---

## 12. Open items to verify at kickoff

- Which Nemotron VL model is live on Token Factory (Nano 2 VL vs. Nano Omni) and how reliably it reads wall labels into structured JSON
- Convex vector search at 300k and at 1M vectors: query latency, how vector-index storage is accounted and billed, filter behavior on `modelVersion`, the 256-result cap, and behavior while a migration doubles the table
- C-RADIOv3-B on the phone: the CoreML export of backbone + summary head with int8 weight-only quantization and fp16 compute; Neural Engine latency at 448 vs. 512 px across iPhone 12–16; memory while the model is loaded; whether 4-bit palettization holds recall; whether a v4 B-class model exists by kickoff (the v4 releases seen so far are H-class and SO400M); the DINOv2-adaptor summary dimension (768 backbone vs. 1,536 teacher width)
- The drift check between the CoreML model and the Serverless Job build (same int8 weights dequantized to fp16): cosine on a few-hundred-image calibration set, and what to do if it is below 0.99
- OpenCV on Expo: `react-native-fast-opencv` vs. a small native module; ORB latency on the phone at 300 vs. 500 keypoints; descriptor size per painting and the verification-accuracy cost of each cap; the `keypointCount` threshold that marks an object low-texture (§4.3)
- ORB matching and RANSAC in the Convex default runtime: per-candidate time in JavaScript, the runtime's memory ceiling against ~20 candidates' descriptors, and whether a WASM build is usable there if JavaScript is too slow
- Calibrator: feature set, model choice (logistic vs. small GBM), how it runs in the `identify` action (and identically on the phone if venue bundles ship), and the augmented training set
- Hotlinking policies and stable thumbnail-URL patterns for the Met CDN, AIC IIIF and Wikimedia Commons, and the fallback to the visitor's own photo when a link fails
- Wikidata painting count with `P18` images, Commons thumbnail rate limits; how many paintings carry `P276` (location) distinct from `P195` (collection); availability of `P570` and `P6216` for `rightsStatus`; how to set `multiplicity` from Wikidata
- Wikidata museum seed: how many museum and gallery items carry both coordinates and a website; the size of the shipped venue table; how to get from a website to its collection-site URL (a `/collection` path probe, platform detection) for rows that aren't set by hand
- Exhibition checklist sources and a general format for `ingestChecklist`
- Nemotron 3 Nano structured-output reliability for the `[{sentence, fact_ids}]` format at temperature 0; how often the validator drops sentences
- Per-domain source scores for fact sheets: an initial list and how corrections update it
- Tavily `include_answer` behavior on an empty time window, typical answer length, and whether `include_domains` plus `topic: news` returns local-press results for lesser-known artists; the per-region domain lists
- Live rectangle detection in a Vision Camera frame processor (`VNDetectRectanglesRequest`): frame rate and battery cost, the stability criterion for enabling the shutter, inner-vs-outer rectangle behavior on framed paintings
- For the first venues in the crawl queue: structure and platform of their collection sites for crawling and accession lookup; their robots.txt and terms of use; whether they publish a usable `sitemap.xml`, an API or IIIF manifests
- Tavily Map behavior on a large collection site: pages per call, `select_paths` reliability for eMuseum-style URLs, and real credit cost for a 2,000-page run; whether an on-view listing exists to map first
- Polite-fetcher defaults: requests per second per host, `Crawl-delay` handling, User-Agent string and contact address; the EU text-and-data-mining opt-out signals to honor
- MapKit local search categories for museums and galleries from Expo, and whether results carry a website
- `huggan/wikiart` dataset license and whether it permits this use; fallback if not
- TestFlight build expiry (90 days) and Beta App Review turnaround for the first external build
- Nebius Serverless Jobs: CPU-only presets for the crawler, L40S availability and quota for the build, scratch-bucket lifecycle, and Convex Python client throughput from a job (batch size vs. mutation write limit)
- App Attest options for Expo (native module choice), how to validate attestations and assertions from a Convex action, and key behavior across reinstalls and device restores; Sign in with Apple through Convex Auth and the merge-on-sign-in flow
- `@convex-dev/rate-limiter` component fit with a device-keyed identity
- Current EAS free-tier build quota
- Met, AIC and Wikimedia Commons rate limits for the corpus download job

---

## 13. Decision requested

Approve the retrieval-first architecture with the label-capture flow, soft identification, a single versioned vector index with the learned match calibrator (§4.1, §4.3, §5.2), ORB descriptors in place of reference images for verification, with a low-texture rule (§4.1, §4.3, §4.7), the artwork / object / placement model with owner separated from location and saved records as immutable snapshots (§4.2, §5.3), on-device embedding and descriptor extraction by C-RADIOv3-B shipped in the app, with Convex as the entire request path — vector search, verification and calibration inside one action — and no idle infrastructure anywhere (§4.1, §5.1, §5.2, §10), the phone's vector and descriptors trusted for now with server-side re-embedding at promotion recorded as deferred (§3, §8), live rectangle detection that gates the shutter, on-device venue resolution and an honest offline queue that carries the label too (§4.1, §5.1), venue bundles demoted to stretch (§3), the central polite crawler with opt-outs and a partnership path, with no venue treated specially (§4.2), `rightsStatus` as the single rule for what is stored and what any model is trained on, with no museum image ever kept — thumbnails hotlinked, the contributor's consented crop the only stored image (§5.5), adoption-bound model versioning with a minimum supported version and local re-embedding after an update (§5.4), the shared index with device identity and an optional sync-only account (§5.6, §8), the cached docent design with cited English prose and the Tavily-answered "Right now" section (§4.8), paintings-only scope (§3), the trust-and-safety controls in §8, and an accuracy gate on the calibration set before the app is built around the embedding model. On approval, next steps are: enroll in the Apple Developer Program, claim credits, verify the third-party data terms, export the CoreML model and run the drift check, measure Convex vector search at scale, seed the venue table, start the open-access corpus download, and scaffold the Expo dev client.
