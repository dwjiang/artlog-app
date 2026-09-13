# 007 — Tavily search, verification, mapping, and credit budget

Date: **2026-09-08 (UTC)**. Spike 00.07 is complete with the measured limitations
below. **71 requests: 64 Search, 5 Map, 2 Crawl; 65 response-reported credits out
of the 300-credit budget.** No production feature or deployment was changed.

Use Tavily Search to find **candidate museum evidence** for label verification.
Keep **`FLAG_RIGHT_NOW=off`**, including the demo default: generated answers are
not adequately grounded by the planned score/date checks. Use **0.60 as a
provisional retrieval cutoff**, not as authorization to display an answer.
Use API/IIIF and sitemap discovery before Map; the probes returned no object
URLs beyond the supplied starting URL. Enforce an exact approved host and
object-path check on every discovered URL. Recommend
**`DAILY_TAVILY_CREDIT_CAP=20`** on the free plan.

## Evidence and method

The reproducible harness, locked Python dependencies, request parameters,
timestamps, durations, request IDs, metrics, and unmodified API response objects
are in [spikes/tavily](../../spikes/tavily/README.md). This run used Python
3.13.15 and `tavily-python` 0.8.1. The scripts read `TAVILY_API_KEY` from the
environment. At the user's explicit request, the key was placed in the two
gitignored `.env.local` files; it is absent from committed artifacts.

The corpus is purposive and small, not a statistical sample of artists or
regions. “Famous”, “mid”, and “local” identify the four-person sampling cohorts,
not objective career rankings. All 12 artists were tested in SF Bay Area,
New York, and London with strict domain filtering. The four famous artists
were repeated with boost in all three regions. Without domains, the request
contains no region input, so four global calls serve as the comparison for
all three regions; twelve identical calls would not add a distinct condition.

The coding agent manually inspected all 54 news/control answers and relevant
snippets. [reviews.json](../../spikes/tavily/results/reviews.json) preserves each
yes/no topicality rating and concern. **“On-topic” means a substantive
artist-specific exhibition/news answer**, including answers that turn out to
be incorrect or stale. It excludes no-information messages, unrelated answers,
and generic biography. It does **not** certify factual accuracy, source support,
recency, or local relevance. There was no independent human reviewer.

## 1. “Right now”: coverage, answers, and guards

Every one of the 52 artist calls returned a nonempty answer. Every top result
had a parseable `published_date` within the preceding 31 days, with no future
timestamp. Consequently, neither check rejected any answer in this sample.
The full dates are retained in each result file; they are service metadata,
not independently verified publication dates.

| Search mode | Calls | On-topic answers | Answer chars min / median / max | Sentences min–max | Outside listed domains |
|---|---:|---:|---|---|---|
| Filter: all cohorts | 36 | 18 | 101 / 416 / 607 | 1–5 | 0 / 128 results |
| Boost: famous only | 12 | 12 | 342 / 601 / 768 | 3–6 | 38 / 55 results |
| No domains: famous only | 4 | 4 | 342 / 448 / 608 | 2–4 | N/A |

The mode comparison is paired only for the famous cohort. Filtering returned
11 topical answers in its 12 famous calls, versus 12/12 boosted and 4/4 global
calls; these counts do not measure correctness. Boost repeatedly led to the
same Australian Hockney exhibition or Atlanta Banksy exhibition in all three
regions. A regional publisher allowlist also does not establish the location
of the reported event: London and Bay Area sources discussed Los Angeles.
[Tavily documents boost as allowing the rest of the web](https://docs.tavily.com/documentation/api-reference/endpoint/search).

For lesser-known artists, domain-filtered news search mostly returned
abstentions or weak matches. Local press did surface Julie Mehretu in KQED and
Woody De Othello in 48 Hills, but the latter answer blended other artists'
descriptions into its claim. The Met supplied useful exhibition evidence for
Njideka Akunyili Crosby and Woody De Othello. Its
[official overview](https://www.metmuseum.org/exhibitions/the-face-of-life-modern-portraits-at-the-met)
separately confirms that the installation is ongoing. Firelei Báez's London
result is also supported by a
[gallery page with explicit 2026 exhibition dates](https://www.southlondongallery.org/exhibitions/slg-forever-at-christies-online-selling-exhibition/).
Those two direct page checks do not validate all returned dates.

### All 36 filtered cases

For **every row**, answer present = yes, top publication date present = yes,
and top date within 31 days = yes. “C/S” is answer characters / sentences.
Sentence counts use the documented English heuristic in the harness, including
initial/title abbreviation protection; they are not linguistic annotations.
SF = SF Bay Area, NY = New York, LDN = London. Each case links to raw evidence.

| Cohort | Artist / region (evidence) | C/S | Top score | On-topic |
|---|---|---|---|---|
| famous | [Yayoi Kusama / LDN](../../spikes/tavily/results/right-now-famous-1-london-filter.json) | 365 / 2 | 0.528 | yes |
| famous | [Yayoi Kusama / NY](../../spikes/tavily/results/right-now-famous-1-new-york-filter.json) | 607 / 4 | 0.713 | yes |
| famous | [Yayoi Kusama / SF](../../spikes/tavily/results/right-now-famous-1-sf-bay-area-filter.json) | 431 / 3 | 0.696 | yes |
| famous | [David Hockney / LDN](../../spikes/tavily/results/right-now-famous-2-london-filter.json) | 481 / 3 | 0.523 | yes |
| famous | [David Hockney / NY](../../spikes/tavily/results/right-now-famous-2-new-york-filter.json) | 429 / 3 | 0.022 | no |
| famous | [David Hockney / SF](../../spikes/tavily/results/right-now-famous-2-sf-bay-area-filter.json) | 223 / 2 | 0.384 | yes |
| famous | [Banksy / LDN](../../spikes/tavily/results/right-now-famous-3-london-filter.json) | 258 / 2 | 0.360 | yes |
| famous | [Banksy / NY](../../spikes/tavily/results/right-now-famous-3-new-york-filter.json) | 494 / 3 | 0.204 | yes |
| famous | [Banksy / SF](../../spikes/tavily/results/right-now-famous-3-sf-bay-area-filter.json) | 248 / 2 | 0.324 | yes |
| famous | [Claude Monet / LDN](../../spikes/tavily/results/right-now-famous-4-london-filter.json) | 446 / 3 | 0.612 | yes |
| famous | [Claude Monet / NY](../../spikes/tavily/results/right-now-famous-4-new-york-filter.json) | 254 / 2 | 0.225 | yes |
| famous | [Claude Monet / SF](../../spikes/tavily/results/right-now-famous-4-sf-bay-area-filter.json) | 302 / 2 | 0.153 | yes |
| local | [Rupy C. Tut / LDN](../../spikes/tavily/results/right-now-local-1-london-filter.json) | 461 / 3 | 0.048 | no |
| local | [Rupy C. Tut / NY](../../spikes/tavily/results/right-now-local-1-new-york-filter.json) | 371 / 3 | 0.032 | no |
| local | [Rupy C. Tut / SF](../../spikes/tavily/results/right-now-local-1-sf-bay-area-filter.json) | 317 / 4 | 0.026 | no |
| local | [Woody De Othello / LDN](../../spikes/tavily/results/right-now-local-2-london-filter.json) | 543 / 2 | 0.035 | no |
| local | [Woody De Othello / NY](../../spikes/tavily/results/right-now-local-2-new-york-filter.json) | 439 / 3 | 0.622 | yes |
| local | [Woody De Othello / SF](../../spikes/tavily/results/right-now-local-2-sf-bay-area-filter.json) | 323 / 3 | 0.474 | yes |
| local | [Melissa Joseph / LDN](../../spikes/tavily/results/right-now-local-3-london-filter.json) | 469 / 3 | 0.020 | no |
| local | [Melissa Joseph / NY](../../spikes/tavily/results/right-now-local-3-new-york-filter.json) | 427 / 3 | 0.038 | no |
| local | [Melissa Joseph / SF](../../spikes/tavily/results/right-now-local-3-sf-bay-area-filter.json) | 302 / 2 | 0.029 | no |
| local | [Hetain Patel / LDN](../../spikes/tavily/results/right-now-local-4-london-filter.json) | 563 / 3 | 0.038 | no |
| local | [Hetain Patel / NY](../../spikes/tavily/results/right-now-local-4-new-york-filter.json) | 271 / 2 | 0.072 | no |
| local | [Hetain Patel / SF](../../spikes/tavily/results/right-now-local-4-sf-bay-area-filter.json) | 101 / 1 | 0.055 | no |
| mid | [Julie Mehretu / LDN](../../spikes/tavily/results/right-now-mid-1-london-filter.json) | 453 / 3 | 0.049 | no |
| mid | [Julie Mehretu / NY](../../spikes/tavily/results/right-now-mid-1-new-york-filter.json) | 461 / 3 | 0.031 | no |
| mid | [Julie Mehretu / SF](../../spikes/tavily/results/right-now-mid-1-sf-bay-area-filter.json) | 326 / 3 | 0.509 | yes |
| mid | [Njideka Akunyili Crosby / LDN](../../spikes/tavily/results/right-now-mid-2-london-filter.json) | 493 / 3 | 0.470 | no |
| mid | [Njideka Akunyili Crosby / NY](../../spikes/tavily/results/right-now-mid-2-new-york-filter.json) | 547 / 5 | 0.661 | yes |
| mid | [Njideka Akunyili Crosby / SF](../../spikes/tavily/results/right-now-mid-2-sf-bay-area-filter.json) | 212 / 1 | 0.045 | yes |
| mid | [Salman Toor / LDN](../../spikes/tavily/results/right-now-mid-3-london-filter.json) | 443 / 4 | 0.513 | yes |
| mid | [Salman Toor / NY](../../spikes/tavily/results/right-now-mid-3-new-york-filter.json) | 572 / 4 | 0.058 | no |
| mid | [Salman Toor / SF](../../spikes/tavily/results/right-now-mid-3-sf-bay-area-filter.json) | 212 / 2 | 0.077 | no |
| mid | [Firelei Báez / LDN](../../spikes/tavily/results/right-now-mid-4-london-filter.json) | 206 / 1 | 0.571 | yes |
| mid | [Firelei Báez / NY](../../spikes/tavily/results/right-now-mid-4-new-york-filter.json) | 405 / 3 | 0.022 | no |
| mid | [Firelei Báez / SF](../../spikes/tavily/results/right-now-mid-4-sf-bay-area-filter.json) | 169 / 2 | 0.032 | no |

### Famous-artist mode controls

For every row below, answer present and top publication date within 31 days
are yes; topicality is yes. “Outside” counts results outside that region's
domain list. Global has no domain restriction.

| Artist / region (evidence) | C/S | Top score | Mode | Outside |
|---|---|---|---|---|
| [Yayoi Kusama / Global](../../spikes/tavily/results/right-now-famous-1-global-none.json) | 608 / 4 | 0.769 | none | — |
| [Yayoi Kusama / LDN](../../spikes/tavily/results/right-now-famous-1-london-boost.json) | 647 / 5 | 0.729 | boost | 5 |
| [Yayoi Kusama / NY](../../spikes/tavily/results/right-now-famous-1-new-york-boost.json) | 592 / 4 | 0.729 | boost | 3 |
| [Yayoi Kusama / SF](../../spikes/tavily/results/right-now-famous-1-sf-bay-area-boost.json) | 524 / 4 | 0.759 | boost | 2 |
| [David Hockney / Global](../../spikes/tavily/results/right-now-famous-2-global-none.json) | 342 / 3 | 0.820 | none | — |
| [David Hockney / LDN](../../spikes/tavily/results/right-now-famous-2-london-boost.json) | 610 / 4 | 0.820 | boost | 3 |
| [David Hockney / NY](../../spikes/tavily/results/right-now-famous-2-new-york-boost.json) | 342 / 3 | 0.820 | boost | 4 |
| [David Hockney / SF](../../spikes/tavily/results/right-now-famous-2-sf-bay-area-boost.json) | 630 / 4 | 0.852 | boost | 3 |
| [Banksy / Global](../../spikes/tavily/results/right-now-famous-3-global-none.json) | 366 / 2 | 0.772 | none | — |
| [Banksy / LDN](../../spikes/tavily/results/right-now-famous-3-london-boost.json) | 574 / 3 | 0.772 | boost | 3 |
| [Banksy / NY](../../spikes/tavily/results/right-now-famous-3-new-york-boost.json) | 691 / 3 | 0.772 | boost | 4 |
| [Banksy / SF](../../spikes/tavily/results/right-now-famous-3-sf-bay-area-boost.json) | 768 / 4 | 0.772 | boost | 3 |
| [Claude Monet / Global](../../spikes/tavily/results/right-now-famous-4-global-none.json) | 530 / 4 | 0.709 | none | — |
| [Claude Monet / LDN](../../spikes/tavily/results/right-now-famous-4-london-boost.json) | 581 / 4 | 0.709 | boost | 3 |
| [Claude Monet / NY](../../spikes/tavily/results/right-now-famous-4-new-york-boost.json) | 760 / 6 | 0.709 | boost | 3 |
| [Claude Monet / SF](../../spikes/tavily/results/right-now-famous-4-sf-bay-area-boost.json) | 370 / 3 | 0.709 | boost | 2 |

### Threshold and presentation decision for 04.09

| Candidate score cutoff | Filtered answers passing | Consequence |
|---|---:|---|
| 0.40 | 12 / 36 | Includes a generic 2017 biography and a blended roundup answer |
| 0.50 | 10 / 36 | Better retrieval coverage, still includes stale related-content material |
| **0.60** | **5 / 36** | Conservative retrieval candidate cutoff; still unsafe for automatic answer display |
| 0.70 | 1 / 36 | The surviving answer has a source-contradicted date |
| 0.80 | 0 / 36 | No usable coverage in this sample |

The 0.60 cutoff keeps Kusama/SF, Kusama/NY, Monet/London, Crosby/NY, and
De Othello/NY. Kusama/NY's answer supplies an August 9 death date while its
retrieved source says August 14. Monet/London's first sentence concerns a
different painting from the top result. Thus, **a higher score does not fix
answer grounding or attribution**. This cutoff is a conservative choice from
this sample, not a calibrated probability or validated production threshold.

Keep the proposed call shape explicit on the wire (`POST /search`):

```json
{
  "query": "<artist> exhibition OR news",
  "search_depth": "basic",
  "auto_parameters": false,
  "topic": "news",
  "time_range": "month",
  "include_answer": "basic",
  "include_domains": ["<region domains>"],
  "include_domains_mode": "filter",
  "max_results": 5,
  "include_usage": true
}
```

Before 04.09 enables display, its acceptance boundary must establish all of:

1. An eligible museum/editorial source, score ≥ 0.60, and a specific mention of
   the identified artist. Exclude shop, category, search, and archive-listing
   pages; do not treat related-content boilerplate as the article.
2. A parseable publication timestamp in `[now − 31 days, now]`. Missing,
   malformed, or future dates suppress the news card. Source content must
   support any assertion of a current or upcoming exhibition; a recent crawl
   or updated archive date is insufficient.
3. The actual displayed claim is supported by the actual cited source. Do not
   pair a multi-source generated answer with `results[0]` automatically. A
   semantically unsupported or contradictory claim becomes `empty: true`.
4. Only then take the first complete sentence, normalize whitespace, preserve
   initials such as “Rupy C. Tut”, and refuse sentences over 200 characters;
   truncation can remove a qualification or negation. Do not show an abstention as news.

04.09's conservative implementation requires the complete answer sentence to
match a complete sentence in the cited snippet, preserving punctuation and
words (only whitespace and quote typography may differ). It also requires an
explicit valid event date, including the year, within 31 days before or after
now; publication metadata cannot supply that date. A paraphrase, undated
ongoing exhibition, or longer sentence is suppressed. This reduces recall;
it does not independently verify the publisher's assertions.

An isolated matching sentence is insufficient when its context retracts or
qualifies it. The gate also suppresses correction, cancellation, postponement,
negation, and qualification signals in the other article sentences, the source
title, or the rest of the answer. Related-story boilerplate is excluded. This
conservative lexical guard can suppress unrelated qualifications and still needs
the held-out semantic review below; it is not a general contradiction detector.

The spike demonstrates why those checks are necessary; it does not implement
or certify an automated semantic validator. **Until 04.09 proves that boundary
with these regression cases and a held-out sample, keep the feature off.**
Cache accepted cards and empty outcomes for seven days per `(artist, region)`;
coalesce simultaneous misses, and avoid retrying empty searches during a scan.

## 2. Empty-window behavior

No real artist can be guaranteed to have no news without a complete census.
The negative control therefore uses the invented exact name
`Artlog Qzxvra Nullex 7c9e2`, once with Bay Area domains and once globally.
Neither request used `exact_match`; these exercise the planned search behavior.

| Mode (evidence) | C/S | Top score | Top date in window | On-topic | Credits |
|---|---|---|---|---|---|
| [filter](../../spikes/tavily/results/empty-filter.json) | 374 / 3 | 0.036 | yes | no | 1 |
| [none](../../spikes/tavily/results/empty-none.json) | 440 / 4 | 0.039 | yes | no | 1 |

The filtered answer narrates an unrelated Kusama/SFMOMA story. The global
answer acknowledges the mismatch and then offers a Lee Bul exhibition. Both
contain results and recent-looking dates. **Empty relevance does not mean
empty `answer`**; both requests still report one credit. Reject these responses
and cache the empty result. They are retained as deterministic regression
fixtures for the future acceptance boundary.

## 3. Label verification fallback

All ten queries returned a museum page naming the title/artist pair somewhere
in the five results. This is a deliberately easy, known-work set; it does not
measure performance on OCR errors, local collections, or homonymous artists.
Do not equate a pair mention with a canonical object or a unique physical work.

| Title — artist (evidence) | Museum | Top score | Pair page found / ranking | First image useful |
|---|---|---|---|---|
| [The Starry Night — Vincent van Gogh](../../spikes/tavily/results/verify-01.json) | MoMA | 0.903 | yes; Audio first; object second | yes |
| [The Persistence of Memory — Salvador Dalí](../../spikes/tavily/results/verify-02.json) | MoMA | 0.905 | yes; Audio first; no canonical object page returned | yes |
| [Water Lilies — Claude Monet](../../spikes/tavily/results/verify-03.json) | Metropolitan Museum of Art | 0.838 | yes; Object first | no: different Monet painting |
| [Washington Crossing the Delaware — Emanuel Leutze](../../spikes/tavily/results/verify-04.json) | Metropolitan Museum of Art | 0.779 | yes; Object first | yes |
| [Nighthawks — Edward Hopper](../../spikes/tavily/results/verify-05.json) | Art Institute of Chicago | 0.738 | yes; Video first; object fifth | yes |
| [A Sunday on La Grande Jatte — Georges Seurat](../../spikes/tavily/results/verify-06.json) | Art Institute of Chicago | 0.854 | yes; Study first; intended object fifth | yes |
| [The Fighting Temeraire — J. M. W. Turner](../../spikes/tavily/results/verify-07.json) | National Gallery | 0.906 | yes; Object first | yes |
| [A Bigger Splash — David Hockney](../../spikes/tavily/results/verify-08.json) | Tate | 0.874 | yes; Interpretive page; duplicated HTTP/HTTPS and shops | yes |
| [The Thinker — Auguste Rodin](../../spikes/tavily/results/verify-09.json) | Cleveland Museum of Art | 0.810 | yes; Two casts; top is 1979.138 | yes: different cast from top page |
| [The Red Studio — Henri Matisse](../../spikes/tavily/results/verify-10.json) | MoMA | 0.908 | yes; Exhibition first; object fourth | yes |

Top-level `images` contained five candidates for each query. The first was
downloaded for all ten cases and visually inspected by the coding agent:
**9/10 depict the requested named work**, but the Rodin image depicts a
different cast from the first text result. The Monet image is a different
painting, *Bridge over a Pond of Water Lilies*, not object 437137. Therefore
only 8/10 avoid those obvious object-association problems, and this is not a
benchmark of image matching. Tate's image returned HTTP 200 with
`application/octet-stream`; a JPEG signature check and visual inspection
confirmed the image. No image bitmaps are committed; URL, status, content type,
byte count, digest, and visual findings are in
[image-probes.json](../../spikes/tavily/results/image-probes.json).

Per-result `images` are also returned. They can contain unrelated related-work
images and advertising tracking endpoints; some valid results have none.
Global images can be merchandise, a video thumbnail, another artwork, or
another physical cast. Never download every returned URL or use `images[0]`
as verified artwork evidence. Resolve a candidate against the selected museum
object, its accession/identity and approved image source; use museum/API image
metadata where available. Image availability does not grant reuse rights.

For 04.06, use `POST /search`:

```json
{
  "query": "\"<title>\" <artist>",
  "search_depth": "basic",
  "auto_parameters": false,
  "topic": "general",
  "include_domains": ["<museum domain>"],
  "include_domains_mode": "filter",
  "include_images": true,
  "max_results": 5,
  "include_usage": true
}
```

Search all five results for the identity pair in substantive museum content,
prefer the canonical collection page over shops/audio/essays, and preserve the
chosen evidence URL. Seurat's intended object and Hopper's collection page
ranked fifth. Title/artist without accession cannot disambiguate Rodin casts.
This call is one credit in all ten observations; `include_images` did not add
a reported surcharge. The provider describes both image arrays in the
[Search response contract](https://docs.tavily.com/documentation/api-reference/endpoint/search).

## 4. Map, Crawl, on-view discovery, and the stop condition

Spike 00.05's decision was available in the sibling `tianjin-v1` workspace at
execution time, before it was merged here. It excludes the five default Bay
Area collection sites from automated indexing and proposes Cleveland's Open
Access API as the replacement. This spike used the same institution; its
[Open Access description](https://www.clevelandart.org/open-access) identifies
over 61,000 API records, and its
[terms](https://www.clevelandart.org/terms-and-conditions) distinguish CC0
collection content from restricted material. No Bay Area site was mapped.

Cleveland uses `/art/{accession}`, so the eMuseum example `/objects/.*` was
adapted to `^/art/[0-9]{4}\.[^/]+$`. This is **not an eMuseum validation**.
The [collection search UI](https://www.clevelandart.org/art/collection/search)
has an On View control; URL mapping alone did not enumerate that subset.

All calls explicitly used `allow_external: false`, `max_breadth: 100`,
`include_usage: true`, `timeout: 150`, and no natural-language instructions.
Crawl used `extract_depth: basic` and never exceeded `limit: 20`.

| Case (evidence) | Start path | Depth / limit | Selection | Returned | Credits | Seconds |
|---|---|---|---|---|---|---|
| [map-collections](../../spikes/tavily/results/map-collections.json) | / | 1 / 50 | collection paths | 0 | 0 | 1.684 |
| [map-objects](../../spikes/tavily/results/map-objects.json) | / | 2 / 2000 | object paths | 0 | 0 | 1.222 |
| [crawl-objects](../../spikes/tavily/results/crawl-objects.json) | / | 1 / 20 | object paths | 0 | 0 | 1.197 |
| [map-collection-start](../../spikes/tavily/results/map-collection-start.json) | /art/collection/search | 2 / 2000 | object paths | 0 | 0 | 0.484 |
| [map-object-start](../../spikes/tavily/results/map-object-start.json) | /art/1927.393 | 1 / 20 | object paths | 1 | 0 | 0.884 |
| [crawl-object-start](../../spikes/tavily/results/crawl-object-start.json) | /art/1927.393 | 1 / 20 | object paths | 1 | 0 | 1.113 |
| [map-any-path-control](../../spikes/tavily/results/map-any-path-control.json) | / | 1 / 20 | any path | 10 | 1 | 1.622 |

Filtered requests starting at the homepage or collection search returned no
URLs, so their path-match fraction is **N/A**. The object-start Map and Crawl
each returned the supplied `/art/1927.393` URL with a **100%** path-match
fraction. Crawl also returned the full artwork page in `raw_content`. Neither
object-start request discovered additional object URLs.

The broad `.*` control proves that the service could map some site navigation;
it returned ten URLs and reported one credit. This leaves the cause of empty
filtered results unresolved: traversal/filter semantics and discoverability
need a future controlled comparison. It does not prove that `select_paths`
is ignored, and it does not measure 2,000-page throughput.

The broad control included `https://shop.clevelandart.org/` although the start
host was `www.clevelandart.org`. That triggered this harness's **strict host
stop**; no further Map or Crawl requests were made. Both hosts share the same
registrable domain, so this is not proof that Tavily's flag allows unrelated
domains. It does prove that `allow_external: false` is insufficient to enforce
the crawler's exact collection-host boundary. There were no returned URLs
violating the broad `.*` path pattern. Evidence and request ID are in
[map-any-path-control.json](../../spikes/tavily/results/map-any-path-control.json).

For 02.06, retain the bounded generic Map request below only as the third
discovery path, after API/IIIF and sitemaps:

```json
{
  "url": "<approved collection URL>",
  "max_depth": 2,
  "max_breadth": 100,
  "limit": 2000,
  "select_paths": ["<venue object path regex>"],
  "allow_external": false,
  "include_usage": true,
  "timeout": 150
}
```

Client-side host, scheme, path, deduplication, and page-cap checks are mandatory,
including after redirects during subsequent fetching. Reject sibling shop
hosts unless explicitly part of the collection profile. An empty Map is not
evidence that the museum contains zero works or that indexing completed.
For Cleveland, use the official API's `currently_on_view` filter instead.
Whether `/collections/.*` reliably finds an eMuseum on-view listing remains
unmeasured because the candidate eMuseum was excluded by 00.05.

Both Crawl requests reported **zero credits**: the homepage request extracted
no pages, while the object-start request successfully extracted **one page**.
The zero-credit report therefore does not establish that extraction failed or
that successful extraction is generally free. No successful 20-page crawl was
measured. Pricing documents imply **200 credits for 2,000 mapped pages** and
**6 credits for 20 pages crawled with basic extraction**, without instructions.
Those are modeled costs, not achieved scale measurements.
[Tavily pricing](https://docs.tavily.com/documentation/api-credits) and
[Map parameters](https://docs.tavily.com/documentation/api-reference/endpoint/map)
are the source for these limits and cost formulas.

## 5. Credit accounting and 1,000-MAU model

| Experiment | Requests | Credits reported in responses |
|---|---:|---:|
| Filtered artist news | 36 | 36 |
| Boosted famous artists | 12 | 12 |
| Famous artists, no domains | 4 | 4 |
| Synthetic empty controls | 2 | 2 |
| Label verification | 10 | 10 |
| Map, including controls | 5 | 1 |
| Crawl, at most 20 pages/request | 2 | 0 |
| **Total** | **71** | **65 / 300** |

The read-only `/usage` calls are not included above. Both the
[before](../../spikes/tavily/results/usage-before.json) and
[after](../../spikes/tavily/results/usage-after.json) snapshots report key and
account usage of 14, on the Researcher plan with a 1,000-credit monthly limit.
A later [recheck](../../spikes/tavily/results/usage-recheck.json) still reports 14.
**The endpoint delta is zero despite 65 response-reported credits.** The reason
is unknown; do not interpret that as free searches or claim billing was
reconciled. Budget against 65, preserve the raw responses, and treat any later
dashboard reconciliation as separate evidence. The script reserves worst-case
cost before sending, prevents concurrent runs, persists possible spend across
timeouts, and never retries automatically.

Basic Search is documented at one credit; both answer-enabled and
image-enabled requests reported that amount here. Map charges by returned
pages; instructions double mapping cost. Crawl adds extraction cost. The
free allowance is monthly and shared, so a daily cap alone cannot guarantee
the account remains within it. [Provider credit model](https://docs.tavily.com/documentation/api-credits)

MAU alone cannot determine spend. For a concrete **30-day model**, assume
1,000 MAU × 8 scans = 8,000 scans, all requesting “Right now”; 5% require one
label-verification fallback = 400 credits. Let `A` be distinct `(artist, region)`
pairs shared across users. With seven-day caching, an always-revisited pair
can miss at most five times in the month. Then:

```text
news credits <= min(8000, 5 × A)
total credits <= news credits + 400 verification + mapping/extraction
```

These are occupancy assumptions and upper bounds for the stated traffic,
not observed production hit rates. Empty-result caching must use the same
TTL, and concurrent misses must be coalesced for the bound to hold.

| Distinct pairs A | News bound | Verification | One modeled 2,000-page Map | Monthly total |
|---:|---:|---:|---:|---:|
| 100, concentrated traffic | 500 | 400 | 200 | **1,100** |
| 500, moderate diversity | 2,500 | 400 | 200 | **3,100** |
| 1,000, broader diversity | 5,000 | 400 | 200 | **5,600** |
| Right now off | 0 | 400 | 200 | **600** |

Choose **`DAILY_TAVILY_CREDIT_CAP=20`** for the free-tier runtime and keep
`FLAG_RIGHT_NOW=off`. At most 620 daily-runtime credits over 31 days leaves
380 for other key usage, experiments, and occasional maintenance. A 200-credit
Map cannot fit a 20-credit daily cap: prefer the API path; if a bulk Map is
later explicitly scheduled, reserve its monthly allowance and account for it
under the same spend system. Workers must not bypass the cap. Reserve credits
atomically before dispatch so concurrent calls cannot all pass a read-only
cap check. The plan 04.04 draft's 300/day default would exhaust 1,000 credits
in a few days and should not be used for this account.

## 6. Proposed regions and venue mapping

[regions-proposed.json](../../spikes/tavily/regions-proposed.json) is the complete
proposed config content: 12 domains each for SF Bay Area, New York, London,
and Paris, plus eight each for `country:US`, `country:GB`, and `country:FR`.
It uses the requested `{ "<region>": { "name", "domains": [...] } }` shape.
Only the first three metro lists were evaluated; Paris and the country lists
are proposed starting points, not measured news coverage.

| Region | Proposed domains |
|---|---|
| sf-bay-area | `sfmoma.org`, `famsf.org`, `asianart.org`, `museum.stanford.edu`, `museumca.org`, `bampfa.org`, `sjmusart.org`, `kqed.org`, `sfchronicle.com`, `berkeleyside.org`, `mercurynews.com`, `48hills.org` |
| new-york | `metmuseum.org`, `moma.org`, `whitney.org`, `guggenheim.org`, `brooklynmuseum.org`, `newmuseum.org`, `queensmuseum.org`, `nytimes.com`, `gothamist.com`, `thecity.nyc`, `hyperallergic.com`, `ny1.com` |
| london | `tate.org.uk`, `nationalgallery.org.uk`, `vam.ac.uk`, `royalacademy.org.uk`, `whitechapelgallery.org`, `serpentinegalleries.org`, `southlondongallery.org`, `theguardian.com`, `standard.co.uk`, `londonist.com`, `bbc.co.uk`, `theartnewspaper.com` |
| paris | `louvre.fr`, `musee-orsay.fr`, `centrepompidou.fr`, `palaisdetokyo.com`, `mam.paris.fr`, `jeudepaume.org`, `fondationlouisvuitton.fr`, `lemonde.fr`, `beauxarts.com`, `telerama.fr`, `paris.fr`, `franceinfo.fr` |
| country:US | `si.edu`, `nga.gov`, `artic.edu`, `clevelandart.org`, `getty.edu`, `npr.org`, `apnews.com`, `hyperallergic.com` |
| country:GB | `tate.org.uk`, `nationalgalleries.org`, `museum.wales`, `nationalmuseumsni.org`, `bbc.co.uk`, `bbc.com`, `theguardian.com`, `theartnewspaper.com` |
| country:FR | `culture.gouv.fr`, `louvre.fr`, `musee-orsay.fr`, `centrepompidou.fr`, `lemonde.fr`, `beauxarts.com`, `telerama.fr`, `franceinfo.fr` |

These domains identify candidate publishers, not crawling permissions or
proof that an event is local. Countrywide press in a metro list is intentional
for recall, and requires a separate event-location check. Do not expand
automatically to global boost when a local search is empty.

For plan 02.02, assign a venue's country from Wikidata `P17`; match `P131`
administrative ancestry to the configured metro, or use its `P625` coordinates
within 60 km of a metro center **in the same country**. Choose the nearest
qualifying center deterministically. Proposed centers to add there are SF
`[37.7749, -122.4194]`, NYC `[40.7128, -74.0060]`, London
`[51.5074, -0.1278]`, and Paris `[48.8566, 2.3522]`. Administrative-ID lists
must be resolved against the venue seed; this spike does not invent Q-IDs.

Fall back to `country:<ISO 3166-1 alpha-2>` when no metro matches. Use the
matching country list only when configured; absent country coverage or
`country:unknown` suppresses “Right now” instead of an unrestricted search.
The 60 km radius is the downstream plan's simple approximation, not a
measured metro-boundary dataset.

The spike keeps the proposal here. Plan 02.02 should materialize it at
**`shared/sources/regions.json`**, the canonical location already named by 02.02 and
04.09; the spike plan's older `jobs/config/regions.json` wording does not
require a duplicate config. Jobs and Convex should read the same file.

## Verification and remaining limits

The standalone Python tests cover credit limits, timeout reservations, replay,
credit-report reconciliation stops across restarts, derived-summary accounting,
date windows, sentence truncation, and exact host filtering. Ruff and the tests
are run with the locked spike environment.
`npx tsc --noEmit` reports existing CSS declaration errors in
`src/components/animated-icon.web.tsx` and `src/constants/theme.ts`; no app files
were changed. ESLint is not configured, so the app lint script cannot provide
a check without installing unrelated tooling. No iOS behavior changed, so
there is no changed app flow to exercise with `npm run ios`.

The investigation answers the six questions without declaring unobserved
scale success: 2,000-page discovery, 20-page Crawl extraction pricing,
eMuseum on-view mapping, independent answer accuracy, held-out cutoff quality,
Paris/country search coverage, and account-level billing reconciliation remain
unverified. These limits constrain the decisions above; they are not reasons
to spend the unused 235-credit budget repeating an inconclusive experiment.
