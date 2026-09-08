# Spike 00.05: Verify the corpus sources, their terms, and the first venues to crawl

> **Executor instructions**: Time-boxed investigation (1.5 days). Deliverable is
> a decision record. Nothing here writes to Convex. Update the status row in
> `docs/plans/README.md` when done.
>
> **Drift check**: `ls docs/decisions/005-data-sources.md` must not exist.

## Status

- **Priority**: P1 (gates 02.02, 02.03, 02.06, 02.07 configuration)
- **Effort**: M (1.5 days)
- **Risk**: LOW
- **Depends on**: none
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.2 builds the index from the Met, the AIC, Wikidata and (conditionally) WikiArt, seeds the venue table from Wikidata, and crawls museum collection sites politely. §2 and §12 require verifying every source's terms and the first venues' robots/terms/sitemaps before anything is fetched at scale. §5.5 hotlinks public-domain thumbnails. Getting a count, a rate limit, or a license wrong here wastes a GPU run or creates a takedown.

## Facts established during planning (2026-09-08)

- **Met**: `https://collectionapi.metmuseum.org/public/collection/v1` (`/objects?departmentIds=11` → 2,644 European Paintings; total 502,689 objects), fields `isPublicDomain, primaryImage, primaryImageSmall, classification, accessionNumber, GalleryNumber, artistDisplayName, objectDate, objectWikidata_URL`, rate limit 80 req/s, CC0; bulk `MetObjects.csv` via Git LFS at `github.com/metmuseum/openaccess`; CDN `images.metmuseum.org/CRDImages/{dept}/web-large/{file}.jpg` (CORS `*`, 5-day cache); no explicit hotlinking clause found.
- **AIC**: `https://api.artic.edu/api/v1/artworks?fields=…&limit≤100&page=N` (132,740 works), fields `is_public_domain, is_on_view, gallery_title, image_id, artwork_type_title, main_reference_number, artist_title, date_display, copyright_notice`; **60 requests/minute** anonymous, header `AIC-User-Agent: artlog (<email>)`, single thread; IIIF `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`; monthly data dump at `github.com/art-institute-of-chicago/api-data`; search caps at 10,000 results (use the listing endpoint or the dump).
- **Wikidata**: `https://query.wikidata.org/sparql`, 60 s deadline, 5 parallel/IP, User-Agent required; painting query `?item wdt:P31 wd:Q3305213; wdt:P18 ?image` with `P170` creator (+`P570` death), `P571`, `P276`, `P6216`, `p:P195/ps:P195` + `pq:P217` accession; museum query `?m wdt:P31/wdt:P279* wd:Q207694 (art museum) | wd:Q33506 (museum); wdt:P625 ?coord; OPTIONAL wdt:P856`. Deep OFFSET paging times out — slice by creator/collection or use the JSON dumps.
- **Commons thumbnails**: only standard widths are served to hotlinks (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840); `Special:FilePath/{File}?width=330` redirects to the `thumb.wikimedia.org` URL; non-standard widths return HTTP 400. Wikimedia UA policy: `artlog-bot/0.1 (https://…; mailto:…)`; ≤ 2 concurrent media requests, ≥ 1 s between other requests, 200 req/min with a UA.
- **`huggan/wikiart`**: license "unknown", card says non-commercial research only, no titles/IDs — **drop it** (design allowed this: "indexed only if the dataset license permits").
- **Crawling**: eMuseum sites often have the API disabled, block non-browser User-Agents behind Cloudflare, and set `Crawl-delay: 30`; Cloudflare's `Content-Signal: ai-train=no` and TDMRep (`/.well-known/tdmrep.json`, `tdm-reservation` header/meta) are the opt-out signals to honor; RFC 9309: 5xx on robots.txt ⇒ treat as full disallow.

## Questions to answer

1. Counts (run the SPARQL, record the query and result): paintings with `P18`; of those with `P276` differing from `P195`; with `P217` accession; with `P6216` or creator `P570`; museums/galleries with `P625` and `P856` (this is the shipped venue table size → estimate the app asset in MB at ~120 B/row).
2. Met: number of `classification = "Paintings"` objects with `isPublicDomain` and `primaryImageSmall`; how many are on view (`GalleryNumber` non-empty); confirm the CSV download path and that `objectWikidata_URL` links to Wikidata for dedup.
3. AIC: number of `artwork_type_title = "Painting"` rows with `image_id`; `is_public_domain` and `is_on_view` counts; dump size; whether `copyright_notice` is usable for `rightsStatus`.
4. Thumbnail policy: write to the Met (`openaccess@metmuseum.org` or the contact on the image-resources page) asking whether hotlinking `web-large` images in a mobile app is acceptable; record the answer or "no reply by <date>". Confirm AIC IIIF and Commons 330-px hotlinking work from a device (CORS is irrelevant for native, but referrer/UA blocking is not).
5. First five venues to crawl (default Bay Area majors — SFMOMA, de Young/Legion of Honor (FAMSF), Asian Art Museum, Cantor Arts Center, Oakland Museum of California — replace with the museums the team will actually test at): collection-site URL, platform, `robots.txt` (fetched with the polite UA **and** a browser UA to detect UA blocking), `Crawl-delay`, terms-of-use crawling clause, `sitemap.xml` presence and whether it enumerates object pages, an on-view listing page, `Content-Signal`/TDMRep signals, an accession-number URL pattern.
6. Exhibition checklist sources for those venues (press-room PDFs, exhibition pages with object lists) and a proposed generic `ingestChecklist` JSON shape (plan 04.10 consumes it).
7. Initial per-domain source-score list for fact sheets (§4.8): 15 high (museum/university/catalogue raisonné/major press), 10 excluded (forums, aggregators, image-sharing) — propose with one-line reasons.

## Method

`spikes/data-sources/` with `uv`; scripts `wikidata_counts.py`, `met_counts.py` (CSV via LFS or API sampling), `aic_counts.py`, `venues_probe.py` (robots/sitemap/TDM probe with both UAs, 1 req/s), and a `results/` folder with JSON outputs. Respect every rate limit above; never fetch object pages beyond 10 per venue in this spike.

## Deliverable

`docs/decisions/005-data-sources.md`: the counts table; which sources are in (Met CC0, AIC, Wikidata) and out (WikiArt); thumbnail rules per source (Met web-large hotlink status, AIC IIIF `843,`, Commons `330`); the venue table size estimate; the five venues' crawl profiles as a table (platform, URL pattern, robots, delay, terms verdict, sitemap, on-view listing, accession pattern, TDM signal) — this table is what plan 02.06's `venues.seed.json` starts from; the checklist JSON shape; the source-score seed list.

## Done criteria

- [x] Decision record exists with all seven answers or explicit "unknown (reason)" — [005-data-sources.md](../../decisions/005-data-sources.md)
- [x] `spikes/data-sources/` committed with scripts and `results/`
- [x] Any museum contacted is logged with date and outcome — none contacted; Met inquiry drafted but unsent (no email connector/sender), recorded in `spikes/data-sources/results/contacts.json`
- [x] `docs/plans/README.md` status row updated

## STOP conditions

- Wikidata SPARQL keeps timing out for the painting count even with creator slicing — report and fall back to the dump-based estimate.
- A first-choice venue's terms forbid automated access — mark it `no_index` in the table and pick a replacement; do not crawl it.

## Maintenance notes

- Counts drive Convex storage cost (plan 00.02) and GPU time (02.04); re-run `wikidata_counts.py` before the full build.
- The venue profiles are configuration for the crawler, not code; keep them in the record and in `jobs/config/venues.seed.json` (plan 02.06).
