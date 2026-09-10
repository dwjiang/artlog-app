# 005 — Corpus sources, thumbnail access, and initial crawl policy

Date: **2026-09-08 (UTC)**. Status: **accepted for the next implementation
plans, with the explicit unknowns below**. Scope: spike 00.05; no Convex writes,
corpus image download, training run, or production crawler was performed.

## Decision

Use **Met Open Access, AIC metadata, and Wikidata**. Keep AIC image ingestion
disabled until its IIIF access problem is resolved. Exclude `huggan/wikiart`.
None of the five default Bay Area collection sites is cleared for automatic
indexing in this investigation. Use **Cleveland's official Open Access API** as
the replacement integration fixture; this is an out-of-region pipeline test,
not a change to the team's physical museum visit plans.

| Source | Admission and terms |
|---|---|
| Met | Open Access dataset and designated OA images are CC0. Restrict image use to records explicitly marked public domain with an API image URL; do not apply the OA grant to arbitrary website content. [Terms §§3, 7](https://www.metmuseum.org/policies/terms-and-conditions) |
| AIC | API metadata is admitted. Preserve per-response licenses: `description` is CC BY 4.0; other artwork fields in the observed responses are CC0. Image rights are separate, and image access failed here. [API documentation](https://api.artic.edu/docs/), [observed notices](../../spikes/data-sources/results/aic.json) |
| Wikidata / Commons | Wikidata structured data is CC0; Commons files have individual rights and attribution requirements. A `P18` URL is not itself a public-domain determination. [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), [Commons reuse policy](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) |
| `huggan/wikiart` | Excluded. The card gives an unknown license and limits use to noncommercial research; its fields are image and artist/genre/style classes, not stable artwork identities. No dataset downloaded. [Dataset card](https://huggingface.co/datasets/huggan/wikiart) |

These are operational admission decisions for this project, not a conclusion
that retaining only embeddings makes restricted source access permissible.

## 1. Wikidata counts and venue asset size

The full painting queries succeeded against
`https://query.wikidata.org/sparql`. Each counts distinct items with **direct
`P31 = Q3305213` and at least one `P18`**; painting subclasses are not included.
Queries, counts, timestamps, HTTP status, and response hashes are retained in
[wikidata.json](../../spikes/data-sources/results/wikidata.json).

| Metric | Observed distinct items |
|---|---:|
| Paintings with `P18` | **396,453** |
| Of those, some `P276` differs from some `P195` | 75,100 |
| Direct `P217` accession | 303,009 |
| `P217` qualifier on a `P195` collection statement | 14,396 |
| Either accession representation | 303,411 |
| `P6216` copyright-status statement | 326,439 |
| A creator with `P570` death date | 334,893 |
| Either copyright status or creator death date | 369,682 |

The location comparison is an inequality between entity IDs, **not a count of
loans**: collection and building entities, multiple owners, and historical
statements can differ without a moved painting. Likewise, a copyright-status
statement may indicate copyright; a death date alone is not sufficient for
`public_domain`. Preserve evidence and its scope; otherwise use `unknown`.

For venues, require **both `P625` coordinates and `P856` website**. Include
instances of museum (`Q33506`) or art gallery (`Q1007870`) subclasses; art
museums are included through the museum hierarchy. The combined property-path
count hit the 65-second client timeout. Splitting by class and enumerating
distinct IDs succeeded:

| Venue set | Items |
|---|---:|
| Museum class slice | 41,185 |
| Art gallery class slice | 1,515 |
| Intersection | 256 |
| Deduplicated union | **42,444** |

At the plan's **120 bytes per venue**, that is **5,093,280 bytes = 5.09 MB
(4.86 MiB)** uncompressed. This is an estimate, not a measured bundled asset;
names, multiple coordinates, URLs, and serialization overhead need measurement
in 02.02. A website is not proof of a working public collection site. The
queries observe live data, not a transactionally consistent snapshot.

The working class-slice form is:

```sparql
SELECT DISTINCT ?item WHERE {
  ?type wdt:P279* wd:Q33506 .
  ?item wdt:P31 ?type; wdt:P625 ?coord; wdt:P856 ?website .
}
```

Repeat with `Q1007870`, then union IDs. No deep OFFSET query or dump-based
estimate was needed. Re-run before the full build. Keep SPARQL requests
sequential; use the service's documented deadline/concurrency constraints and
an identified UA, rather than treating general MediaWiki rate limits as WDQS
capacity. [WDQS service documentation](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service)

## 2. Met counts and metadata contract

The complete CSV was downloaded from the
[Git LFS media URL pinned to commit `6fa206f`](https://media.githubusercontent.com/media/metmuseum/openaccess/6fa206f0df6cf349d4fe558028d4c08e95f44eb6/MetObjects.csv).
It is **317,650,992 bytes**; SHA-256
`de617b9c947458e426111207f81a65bd1379a151c0077d3ce29cfc22fc0b9183`.
The normal source path is
`https://media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv`;
pin its revision for a corpus build. Ordinary raw GitHub access can return an
LFS pointer instead of the CSV.

| CSV metric | Count |
|---|---:|
| All CSV records | 484,956 |
| Exact `Classification = "Paintings"` | 9,005 |
| Those marked `Is Public Domain = True` | **5,286** |
| Public-domain paintings with nonblank `Gallery Number` | 700 |
| Public-domain paintings with `Object Wikidata URL` | 4,931 |
| Public-domain paintings also having `primaryImageSmall` | **Unknown: CSV has no image URL columns** |
| That image-eligible set also on view | **Unknown: requires the image-availability census** |

[met.json](../../spikes/data-sources/results/met.json) records the CSV fields
and a deterministic sample of 30 eligible IDs (seed 5). All 30 API responses
had `primaryImageSmall`; 10 had a nonempty `GalleryNumber`. These are sample
counts, not a census or an extrapolated corpus total. The sample size is the
bounded investigation allowed by the plan; 02.03 must hydrate all eligible
IDs to determine exact image availability. The CSV count also must not be
substituted for the different live API population recorded during planning.

CSV `Object Wikidata URL` maps to API `objectWikidata_URL`; sample responses
confirm it is a Wikidata entity link suitable for candidate deduplication.
Keep owner plus accession checks: a Wikidata match alone need not identify one
physical object. CSV `Object Number` corresponds to API `accessionNumber`.

The API documents an 80 requests/second ceiling; this spike used one request
per 1.1 seconds. On September 4, the Met announced `/v1.1/search` pagination
and retirement of `/v1/search` on October 1. Use the CSV/`/v1/objects` and
per-object endpoints here; new search callers must use v1.1 (limit at most
500). [Met API documentation and update](https://metmuseum.github.io/)

## 3. AIC counts, dump freshness, and rights fields

The API's artwork-type listing identifies **Painting as type ID 1**. Counts
use `artwork_type_id = 1`, an Elasticsearch `exists(image_id)` filter where
specified, and `limit=0`; they do not iterate the search endpoint's 10,000-hit
retrieval window. Requests and parameters are in
[aic.json](../../spikes/data-sources/results/aic.json).

| Live API metric | Count |
|---|---:|
| All artwork records | 132,740 |
| Paintings | 3,912 |
| Paintings with `image_id` | **3,663** |
| Image-bearing paintings marked public domain | **1,875** |
| Image-bearing paintings on view | 768 |
| Image-bearing paintings public domain and on view | 513 |

The [official dump repository](https://github.com/art-institute-of-chicago/api-data)
contains samples and links to the actual
[S3 archive](https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2).
HEAD reports **119,891,546 bytes (119.89 MB / 114.34 MiB)** compressed and
**Last-Modified: 2025-02-16**, despite the repository describing monthly
refreshes. Its quoted ~2.5 GB expanded size is documentation, not a measurement
from this spike. Do not equate this archive with today's counts or use its
on-view values as current placements. Prefer the live listing endpoint for
02.03 unless a refreshed dump is verified. `/releases/latest` returns 404;
the dump is not a GitHub release asset.

`copyright_notice` describes the artwork, not its photograph. The stored
sample includes public-domain Seurat with a null notice and three
`is_public_domain=false` paintings with explicit copyright notices. Use
`is_public_domain=true` as affirmative institutional evidence; retain the
notice as provenance. False or a blank notice is not proof of public domain,
and free text needs interpretation before distinguishing `in_copyright`
from `unknown`. [Field definitions and limits](https://api.artic.edu/docs/)

Use `AIC-User-Agent` plus an identified User-Agent and a single request stream,
at most 60 requests/minute. This spike used 1.1 seconds between API requests.

## 4. Thumbnail policy and native transport

The disposable Swift probe ran on **iPhone 17 Pro Simulator, iOS 26.5, light
mode**, using sequential URLSession GETs with an identified artlog UA, no
Referer, and no persistent image cache. Results and decoded dimensions are
in [ios-thumbnails.json](../../spikes/data-sources/results/ios-thumbnails.json).
The simulator screenshot was visually checked. Physical iPhone and
cellular-network behavior are **unknown; this run used only the simulator**.

| Source | URL policy | Native result and decision |
|---|---|---|
| Met | Use the returned `primaryImageSmall` (`/CRDImages/.../web-large/...jpg`) for eligible OA works; do not synthesize filenames or assume this is a 256-pixel endpoint. | **200, decoded 502 × 625**. CC0 reuse is documented; CDN hotlink-specific guidance is still unknown. Keep the visitor-photo fallback. |
| AIC | Documented pattern: `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`, public-domain works only. | **403 HTML, no image decoded**; the desktop HEAD probe also got 403. Record image access as blocked from this environment. Do not bypass Cloudflare or count these as downloaded/usable references. |
| Commons | Resolve `imageinfo` with `iiurlwidth=330` and use its returned `thumburl`; retain the file-description URL and applicable rights evidence. | **200, decoded 330 × 492**. The tested URL is on `thumb.wikimedia.org`; do not hardcode a host or arbitrary widths. |

[thumbnails.json](../../spikes/data-sources/results/thumbnails.json) retains the
actual URLs and Commons imageinfo response. The selected Commons file is a
public-domain reproduction; this test does not clear every `P18` image.
Commons permits reuse/hotlinking subject to file rights; standard thumbnail
widths are required for direct thumbnail requests. Use 330 rather than 256.
[Commons reuse](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia),
[Wikimedia standard-size rollout](https://phabricator.wikimedia.org/T414805)

For future jobs, use one media request at a time (never more than the plan's
two), at least a second between other Wikimedia requests, and respect 429 /
Retry-After. The published 200 requests/minute tier for identified bots is a
ceiling, not a recommended media-download speed.
[Wikimedia rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)

**Correction 2026-09-10 (plan 02.04):** the "one media request at a time, one
second apart" guidance above came from the robot policy's rules for *other*
Wikimedia services (Gerrit, GitLab, Phabricator). The policy's media rules for
`upload.wikimedia.org` are: total concurrency at most 2, total download speed
at most 25 Mbps over 10-second intervals, originals or standard thumbnail sizes
only, thumbnails preferred; the action API allows concurrency 1 below 5
requests/second. The index build now runs two throttled streams at those
limits; the one-request-per-second reading measured 1.1 images/s and projected
4.3 days for the corpus.
[Robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy)

**Met contact outcome:** no museum was contacted. The inquiry to
`openaccess@metmuseum.org` is [prepared but unsent](../../spikes/data-sources/met-inquiry.md):
this session has no email connector or supplied sender identity. The
[contact log](../../spikes/data-sources/results/contacts.json) records that
state on 2026-09-08. Do not describe it as “no reply” or as hotlink approval.

## 5. Five initial collection-site profiles and replacement

These are the plan's default five institutions; FAMSF has two physical venues
and must become separate venue rows sharing a collection profile in 02.02.
The [raw policy observations](../../spikes/data-sources/results/venues.json)
compare a polite artlog UA with Safari's UA **only for robots.txt**. Browser
success never overrides a bot block. No object pages at these five sites were
downloaded by the probe; URLs from indexed search results are discovery
evidence only. `no_index` below is the current crawler disposition, not proof
that the museum has opted out by direct correspondence.

| Institution / collection URL | Platform and object/accession pattern | Robots / delay | Terms verdict | Sitemap / on-view discovery | Content-Signal / TDM |
|---|---|---|---|---|---|
| **SFMOMA** — `https://www.sfmoma.org/artists-artworks/` | Generic WordPress site. `/artwork/{accession}/`; indexed example `59.2668` establishes accession in the path. | 200 with both UAs; artwork paths allowed; search paths disallowed; no applicable delay. | **no_index**: §10.9 restricts scraping substantial portions; no assumption that artlog qualifies for the search-engine exception. | Sitemap unknown (discovery skipped after terms exclusion). Collection entry and per-object status exist; dedicated on-view listing URL unknown. | No Content-Signal or TDM header observed on policy responses; well-known file 404. Object-page meta unknown. |
| **de Young / Legion of Honor (FAMSF)** — `https://www.famsf.org/collections`; legacy `https://art.famsf.org` | Current platform/object and accession URL templates **unknown** (site access blocked); do not reuse historical Drupal slug templates as verified facts. | Current robots 200 with both UAs; **`/art/*` and query URLs disallowed** even though `/collections` is allowed. Legacy robots 404. No artlog delay; trailing 10-second delay belongs to the msnbot group. | **no_index**: artwork-path exclusion and access block; applicable collection terms could not be retrieved. Store terms are not a substitute. | Current sitemap 403; legacy sitemap 404. On-view listing/accession lookup unknown. | Current robots: `search=yes,ai-train=no,use=reference`. Well-known file 404 on both hosts. Object-page meta unknown. |
| **Asian Art Museum** — `https://searchcollection.asianart.org/collections` | eMuseum pattern inferred from collection routes and robots directives. Candidate object regex `^/objects/[0-9]+(?:/.*)?$`; accession-search template **unverified**, keep unset. | 200 both UAs; collection paths allowed; **30 seconds**, honored between probes. | **no_index**: published content reuse is limited to personal/noncommercial/educational use or permission; no clearance for this public app's automated image ingestion. | Robots advertises `/sitemap.xml`; fetching skipped after exclusion, enumeration unknown. Official “In the Galleries” links to gallery collections. | No Content-Signal/TDM header observed; well-known file 404; object-page meta unknown. |
| **Cantor Arts Center** — `https://cantorcollection.stanford.edu/index-tree/tree/-1?records=12` | **WebKiosk v12.2**, from response server header, not eMuseum. Object/accession URL templates unknown. | 200 both UAs; `/index-tree/`, `/objects-1/`, `/objects_1/`, `/API/` and other content routes disallowed. No delay. | **no_index**: robots exclusion, human-verification gate, and personal/noncommercial image-use notice. | No usable sitemap advertised; discovery skipped. On-view listing unknown. | Well-known URL returns **200 HTML**, not TDM JSON. No observed TDM header; object-page meta unknown. |
| **Oakland Museum of California** — `https://portal.museumca.org/` | CollectionSpace institutional adoption is documented; current portal gateway and object/accession route **unknown** because access is blocked. | **403 bot / 202 browser**; neither is usable robots permission; no delay determined. | **no_index** until access/policy can be checked. Terms allow specifically marked public-domain high-resolution images; protected content is restricted, so even later admission is per item. | Sitemap, on-view listing, and TDM file not fetched after bot robots block; unknown. | No TDM/Content-Signal header in robots response; file and object meta unknown. |

Profile evidence and terms:

- SFMOMA: [terms](https://www.sfmoma.org/terms-of-use/) and the
  [indexed artwork with accession URL](https://www.sfmoma.org/artwork/59.2668/).
- FAMSF: [current robots](https://www.famsf.org/robots.txt); direct response
  snapshots and 403s are in `venues.json`. No applicable terms URL verified.
- Asian Art Museum: [terms](https://asianart.org/terms-and-conditions/),
  [official collection entry](https://collections.asianart.org/),
  [gallery listing](https://collections.asianart.org/in-the-galleries/), and
  [indexed Gallery 28 collection](https://searchcollection.asianart.org/collections/19411/japanese-paintings-prints-screens-and-porcelain-gallery-2).
- Cantor: [official collection redirect and gate](https://museum.stanford.edu/collections)
  and [robots](https://cantorcollection.stanford.edu/robots.txt). No gate submitted.
- OMCA: [terms](https://museumca.org/terms-of-use/), whose navigation links the
  current portal, and [CollectionSpace's institutional announcement](https://collectionspace.org/new-implementer-welcome-oakland-museum-of-california/).

### Replacement: Cleveland Museum of Art

Use `https://openaccess-api.clevelandart.org/api/artworks/`, **not the website's
disallowed `/api` route**. API robots allows artlog. The museum explicitly
releases metadata as CC0 and provides CC0 images for eligible records.
`share_license_status = "CC0"` remains the image admission gate.
[Open Access policy](https://www.clevelandart.org/open-access),
[official API contract](https://openaccess-api.clevelandart.org/)

[replacement.json](../../spikes/data-sources/results/replacement.json) confirms:

- Website robots 200 with a 10-second delay; API robots 200 with no applicable
  delay. Use one request/second for the API until a different limit is agreed;
  no numerical API ceiling was found in its documentation.
- Sitemap index 200; both children fetched at 10-second spacing. They contain
  3,837 navigation/content URLs and **zero accession object URLs**. Two
  `/art/collection/...` links are navigation, not artwork pages. Prefer the API.
- One object page, `/art/1927.393`, returned 200. No TDM header/meta found
  there; the well-known file returned 404. This is a one-page observation.
- `?type=Painting&cc0&currently_on_view&limit=1` returned one CC0 painting and
  a total of **437** matching records. Its `current_location` is populated.
- Generic HTML object path is `/art/{accession}`; prefer each API record's
  returned `url`. Exact accession search is the documented
  `?accession_number={encodedAccession}` API parameter. Use `currently_on_view`
  for the listing. API collection/exhibition data can also aid checklist work.

Plan 02.06 should create `jobs/config/venues.seed.json` from these findings,
with disabled venues excluded from automatic discovery. Its API-first
discovery step will need the Cleveland contract, not a guessed eMuseum route.
Recheck each origin's robots, terms, and resource-level signals at enqueue.
Honor `tdm-reservation: 1` in well-known rules, headers, or HTML meta as
`no_index`; record `ai-train=no` as a training prohibition. The observed
`use=reference` is an additional review input, not blanket permission for
enrichment. Missing signals do not override terms or robots.
[TDMRep specification](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/),
[Cloudflare content signals](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)

Robots network errors/5xx are disallow for this run. We also stop on 401/403/429
rather than trying a different UA. That latter choice is stricter than the
RFC's treatment of ordinary 4xx responses. A 404 alone is only “robots absent.”
[RFC 9309 §2.3.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1)

## 6. Exhibition checklist sources and ingest shape

Public availability does not override a venue's crawl disposition. The sources
below are candidates for a permissioned/manual checklist workflow, **not
current placements or an automatic PDF crawl**.

| Venue | Verified lead and completeness |
|---|---|
| SFMOMA | [New Work: Richard Prince](https://www.sfmoma.org/exhibition/richard-prince/) explicitly links an exhibition-checklist PDF and gives 1993 exhibition dates. Historical format example, not a current show. |
| FAMSF | **Unknown:** no publicly accessible full object checklist verified. Website/press discovery was blocked or produced unrelated material. Obtain a museum-supplied checklist; do not treat docent-login resources or a press image selection as a complete list. |
| Asian Art Museum | [Gorgeous press page](https://about.asianart.org/press/gorgeous/) gives a 2014 exhibition window and selected works. Partial evidence only; a complete public checklist PDF was not verified. |
| Cantor | [The Early Twentieth Century — Final Checklist](https://web.stanford.edu/dept/suma/news_room/documents/photos/The%20Early%2020th%20Century_Sept_2021/2Final%20PR%20Checklist-%20The%20Early%20Twentieth%20Century.pdf) is an official Stanford press-checklist lead. Historical; match the exhibition's venue-specific dates before ingestion. |
| OMCA | [Hella Feminist press release](https://museumca.org/press/oakland-museum-california-announces-hella-feminist-exhibition-exploring-multifaceted-history-0/) links press images and describes selected works. Full checklist unknown; press selections do not establish complete membership. |

Keep the proposed 04.10 wire shape. This is a **synthetic format example**,
not an asserted exhibition or an ingest command:

```json
{
  "venueKey": "example:venue",
  "exhibition": {
    "title": "Example exhibition",
    "from": "2026-10-01",
    "to": "2026-10-30",
    "sourceUrl": "https://example.org/exhibitions/example/checklist.pdf"
  },
  "gallery": "Gallery 2",
  "works": [
    { "objectKey": "example:object" },
    { "wikidataId": "Q123", "ownerKey": "example:lender" },
    {
      "title": "Example painting",
      "artist": "Example artist",
      "ownerKey": "example:lender",
      "accession": "2026.1"
    }
  ]
}
```

Use one identity mode per entry: object key, Wikidata ID (optional owner
disambiguator), or title/artist with available owner/accession evidence.
Accession without its owner is not globally unique. Dates are ISO local
calendar dates for the host venue, inclusive; reject reversed/unknown windows
until clarified. Only listed and resolved works gain time-bounded placements;
a partial checklist does not mark unlisted works off view. Preserve the
source URL and distinguish host venue from lender/owner.

**04.10 resolution correction:** its proposed “first non-reverted object” for
a Wikidata artwork is unsafe when multiple physical objects exist. Report an
ambiguous match as unresolved unless owner/accession evidence identifies one
object. This is a resolution requirement, not a wire-shape change. Never
rewrite saved visits or infer today's placement from these historical examples.

## 7. Fact-sheet source-score seed

[jobs/config/source-scores.json](../../jobs/config/source-scores.json) is the
machine-readable proposal for 02.07: default 0.3, acceptance threshold 0.5.
Scores are **editorial priors, not measured probabilities, truth guarantees,
image licenses, or permission to crawl**. Prefer the owning museum for
object-specific claims; confirm each selected page actually supports its fact.

| High-priority domain | Score | Reason |
|---|---:|---|
| `metmuseum.org` | 1.00 | Owning collection records and institutional scholarship. |
| `artic.edu` | 1.00 | Owning collection catalog and technical entries. |
| `clevelandart.org` | 1.00 | Owning collection, provenance, and conservation records. |
| `nga.gov` | 1.00 | National Gallery collection research and catalogs. |
| `getty.edu` | 1.00 | Museum and research-institute scholarship. |
| `tate.org.uk` | 0.95 | Curated collection and artist research. |
| `moma.org` | 0.95 | Collection records and exhibition archives. |
| `louvre.fr` | 0.95 | Institutional collection scholarship. |
| `rijksmuseum.nl` | 0.95 | Collection records and research. |
| `britishmuseum.org` | 0.95 | Curated object records and provenance. |
| `harvardartmuseums.org` | 0.95 | University museum collection scholarship. |
| `collections.britishart.yale.edu` | 0.95 | Specific university collection domain, not all Yale-hosted content. |
| `vangoghworldwide.org` | 0.95 | Collaborative technical and art-historical work data; [institutional contributors](https://vangoghworldwide.org/faq). |
| `theartnewspaper.com` | 0.85 | Edited specialist reporting for dated art-world events. |
| `nytimes.com` | 0.85 | Edited arts reporting; distinguish criticism from catalog facts. |

Supplementary priors: `wikidata.org` 0.8 for structured cross-links;
`wikipedia.org` 0.7 for cited secondary context. Follow underlying primary
references when possible.

| Excluded domain | Reason for this initial fact-sheet filter |
|---|---|
| `pinterest.com` | Reposted images with weak source provenance. |
| `instagram.com` | Social posts and captions are not vetted object records. |
| `facebook.com` | Social posts and reshares require independent verification. |
| `reddit.com` | Discussion and identification guesses. |
| `quora.com` | User-authored answers without consistent review. |
| `tumblr.com` | Reblogs often detach content from its original source. |
| `wikiart.org` | Aggregated images/metadata; original institutional provenance preferred. |
| `fineartamerica.com` | Print/product listings can describe reproductions. |
| `ebay.com` | Seller claims and attribution are not independently vetted. |
| `etsy.com` | Seller/product copy can conflate originals and reproductions. |

Match lowercased hostnames exactly or at a dot-delimited subdomain boundary;
prefer the longest matching entry. Exclusions take precedence. A suffix such
as `metmuseum.org.example.com` must not match `metmuseum.org`. Do not bypass
paywalls or interpret a high score as an access grant.

## Verification and remaining work

- Reproducible probes, `uv.lock`, and **32 passing offline tests** are under
  [spikes/data-sources](../../spikes/data-sources/README.md). Raw bulk metadata,
  native build products, and screenshots stay in ignored `.context/`.
- `npx tsc --noEmit` was run. It fails in unchanged app files on missing CSS
  declarations: `animated-icon.module.css` and the `@/global.css` side-effect
  import. ESLint remains unconfigured, so `npm run lint` was not run. No
  product behavior changed; `npm run ios` is not relevant to this research
  spike. The separate native thumbnail probe was built, run, and inspected.
- Explicit unknowns: Met full image-availability census and CDN-specific
  hotlink guidance; physical-device/other-network thumbnail behavior; AIC
  image access outside this environment and a fresh bulk dump; blocked venues'
  unobserved terms/routes/signals; complete current exhibition checklists.
  These are recorded outcomes permitted by 00.05, not claims of clearance.
- 02.02 can use the measured venue-size estimate; 02.03 can implement Met/AIC
  metadata and Wikidata normalization with the image gates above; 02.06 starts
  with the replacement and rechecks policy; 02.07 has its score seed; 04.10
  has the unchanged checklist shape plus the ambiguity requirement.
