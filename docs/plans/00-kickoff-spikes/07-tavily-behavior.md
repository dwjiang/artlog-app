# Spike 00.07: Characterize Tavily for "Right now", label verification and site mapping

> **Executor instructions**: Time-boxed investigation (half a day, ≤ 300 Tavily
> credits). Deliverable is a decision record and a proposed regions config.
> Update the status row in `docs/plans/README.md` when done. Read the key from
> `TAVILY_API_KEY`; never write it to a file.
>
> **Drift check**: `ls docs/decisions/007-tavily.md` must not exist.

## Status

- **Priority**: P1 (gates 04.09 "Right now", 04.06 verification fallback, 02.06 discovery)
- **Effort**: S (0.5 day)
- **Risk**: LOW
- **Depends on**: none
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §7 makes three live Tavily calls part of the product and one background path, all behind flags, and §12 asks about `include_answer` behavior on an empty window, answer length, whether `include_domains` + `topic: news` surfaces local press for lesser-known artists, Map behavior on a large collection site, `select_paths` reliability, and real credit cost. §10's scaling driver is Tavily, so the caching strategy depends on these numbers.

## Facts established during planning (docs.tavily.com, 2026-09-08)

- Search: `query`, `search_depth` (`basic`=1 credit, `advanced`=2, `fast`, `ultra-fast`), `topic` (`general|news|finance`), `time_range` (`day|week|month|year`), `start_date/end_date`, `include_answer` (`false|true|basic|advanced`; no documented surcharge), `include_images`, `include_domains` (≤300) / `exclude_domains`, `include_domains_mode` (`filter|boost`), `max_results` (0–20), `country`. **`days` is not in the current API** (legacy SDK field). Response: `answer`, `results[{title,url,content,score,published_date?}]` — `published_date` is documented only for `topic: news`.
- Map: `url`, `instructions` (doubles cost), `max_depth` 1–5, `max_breadth` 1–500, `limit` (default 50), `select_paths`/`exclude_paths` (regex arrays), `select_domains`, **`allow_external` defaults to true — set false**; cost 1 credit per 10 pages (2 with instructions). Crawl = map cost + extract cost (10 pages ≈ 3 credits). Free plan: 1,000 credits/month; dev keys 100 RPM.
- SDKs: `@tavily/core` (`tavily({ apiKey }).search(query, { searchDepth, topic, timeRange, includeAnswer, includeDomains, maxResults })`, `.map(url, { maxDepth, maxBreadth, limit, selectPaths, allowExternal })`), `tavily-python` (`TavilyClient(api_key).search(...)`, `.map(...)`).

## Questions to answer

1. "Right now" (§4.8): for 12 artists (4 famous, 4 mid, 4 local/lesser-known) × 3 regions (SF Bay Area, New York, London) run `search(f"{artist} exhibition OR news", { topic: 'news', time_range: 'month', include_answer: 'basic', include_domains: <region list>, max_results: 5 })`. Record: answer present?, answer length (chars, sentences), top result `score`, `published_date` present and inside the window?, whether the answer is on-topic (manual yes/no). Repeat 4 famous artists with `include_domains_mode: 'boost'` and without domains. Derive the score threshold and the "first sentence only" truncation rule.
2. Empty window behavior: an artist with certainly no news this month — does `answer` come back empty, generic, or hallucinated?
3. Label verification fallback (§4.4 step 4c): for 10 (title, artist, museum) triples, `search(f'"{title}" {artist}', { include_domains: [museum domain], include_images: true, max_results: 5 })` — does a museum page naming the pair appear; are `images` useful (URL to the artwork image)?
4. Map on one large collection site from spike 00.05's venue table (eMuseum or similar, ~2,000+ object pages): `map(url, { max_depth: 2, max_breadth: 100, limit: 2000, select_paths: ['/objects/.*'], allow_external: false })` — pages returned, credits charged (`usage.credits`), duration, fraction of results matching the object pattern; whether an on-view listing can be mapped first with `select_paths: ['/collections/.*']`. Do **not** run Crawl beyond `limit: 20`; record its cost.
5. Cost model: credits per "Right now" cache miss (1), per verification (1), per 2,000-page map (~200); with a 7-day per-(artist, region) cache and 1k MAU, monthly credits estimate; recommended `DAILY_TAVILY_CREDIT_CAP`.
6. Per-region domain lists: propose 8–15 domains per region for SF Bay Area, New York, London, Paris (museum sites + local press) as `jobs/config/regions.json` content: `{ "<region>": { "name", "domains": [...] } }`, and the rule for mapping a venue to a region (country + metro from Wikidata `P131`/coordinates; default region = country-level list).

## Method

`spikes/tavily/` with `uv` + `tavily-python`; `right_now_eval.py`, `verify_eval.py`, `map_eval.py`; results in `results/*.json` with the raw responses (they contain no secrets). Budget ≤ 300 credits; print the running total.

## Deliverable

`docs/decisions/007-tavily.md`: tables per question, the chosen thresholds (score ≥ x, window check, sentence truncation), the exact call shapes for plans 04.09 and 04.06, the Map parameters and cost for plan 02.06, and the proposed `regions.json` (plan 02.02 writes the file).

## Done criteria

- [ ] Decision record exists with all six answers
- [ ] `spikes/tavily/` committed; credit total recorded
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- No API key / credits — report.
- Map returns `allow_external` results despite `false` or `select_paths` is ignored — record; plan 02.06 will filter client-side regardless.

## Maintenance notes

- Keep "Right now" off (`FLAG_RIGHT_NOW=off`) during museum testing (§7) — the flag exists in plan 04.04.
