# Plan 04.12: Museum-site search backend — describe the crop, search the venue's site, extract candidate pages, confirm with pixels

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`. Secrets are Convex env vars; never in files.
>
> **Drift check (run first)**: `git diff --stat 55f0673..HEAD -- convex/museumSearch.ts convex/label.ts convex/scans.ts convex/lib/labelVerify.ts convex/lib/describePrompt.ts convex/lib/validators.ts convex/schema.ts`
> Confirm `convex/label.ts`, `convex/lib/labelVerify.ts`, `convex/lib/pageExtract.ts`, `convex/lib/tavily.ts`, `convex/lib/tokenFactory.ts` and `convex/lib/venueFetch.ts` exist (plan 04.06). STOP if any is missing.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED (sends the artwork crop to a hosted model; one search credit per consented miss; SSRF surface shared with 04.06)
- **Depends on**: 04.06 (clients, page extraction, evidence model), 04.04 (device identity, rate limits, spend), `docs/decisions/004-token-factory-models.md`, `docs/decisions/007-tavily.md`
- **Category**: feature
- **Planned at**: 2026-09-10, after the crawler was removed (see `docs/plans/README.md`, "No crawler")

## Why this matters

Design §4.2 "Venue collections (found at scan time)": there is no crawler, so a museum's own site enters the index one work at a time, when a scan misses there. §4.4 "Museum-site search": with consent, the vision model describes the painting, one Tavily search scoped to the venue's hosts returns candidate object pages, the server extracts each page's fields and artwork image, and the phone confirms a candidate by embedding and ORB homography before the card names the work. §4.7: a phone-confirmed museum image (`tavily+image`) promotes alone. §7: this is the Tavily call on the primary loop. §8: fetches are single-page, on the venue's own hosts, opt-out checked first, robots.txt not consulted.

## Current state

- `convex/label.ts` (04.06): `readLabel` shows the pattern for sending an image to `LABEL_VL_MODEL` through `chatJson` with spend reservation and a 20 s timeout; `searchMuseumSite()` (private) reserves one Tavily credit and calls `search({ query, includeDomains: hosts, includeImages: true, maxResults: 5 })`; `applyImageCheck` upgrades `tavily` → `tavily+image` on `imageCheck: { url, cosine }` with `cosine ≥ IMAGE_MATCH_COSINE` (0.85) — cosine only, no homography.
- `convex/lib/labelVerify.ts`: `selectTavilyEvidence(response, pair, hosts)` requires a known title/artist pair; `OBJECT_PATH`, `NON_OBJECT` and `TRACKING` filters and the ≤ 3 image-URL rule are what a candidate selector without a pair must reuse. `labelField`, `withEvidence`, `evidenceSummary`, `LOCKING_EVIDENCE`.
- `convex/lib/pageExtract.ts`: `extractPage(html)` → `{ fields, imageUrls, source }`, `hasArtworkMetadata`.
- `convex/lib/venueFetch.ts`: `venueHosts(venue)`, `allowedVenueUrl`, `fetchVenuePage(url, hosts)` — every outbound page fetch goes through these.
- `convex/lib/flags.ts` (`labelFlow`, `rightNow`), `convex/lib/rateLimits.ts` (`labelRead` 30/h, `labelVerify` 60/h), `convex/lib/spend.ts` (`tokenFactory`, `tavily` daily caps), `convex/lib/moderation.ts` (`checkText`).
- `scans.labelFlow` (typed by `convex/lib/validators.ts` `labelFlow`) is what 04.07's `contribute` reads (`stage === 'verified'`); this plan writes the same shape so contributions need no new path.
- `convex/scans.ts` exposes an explicit `scanDisplay` validator and `displayScan` projection; neither includes `labelFlow` or museum-search state yet. Step 5 adds both to the device-owned public query.
- Decision 007 §3: museum-scoped searches for exact title + artist found a page naming the pair in 10/10 cases but the canonical object page ranked first in only 3; audio, video, study and exhibition pages outrank it. Decision 005: FAMSF and Cantor disallow their object routes to crawlers, so the search index may not hold their pages; SFMOMA's artwork paths are allowed.

## Scope

**In scope**: `convex/museumSearch.ts` (search, confirmation and atomic spend reservation), `convex/lib/describePrompt.ts`, `convex/lib/labelVerify.ts` (`selectSearchCandidates`), `convex/label.ts` (`applyImageCheck` requires the homography; shared display and image-check validators), `convex/lib/validators.ts` (`museumSearch` scan state, `labelFlowDisplay`, `imageCheck`), `convex/schema.ts` (`scans.museumSearch`), `convex/scans.ts` (public display validator and projection), `convex/_generated/` (codegen), `convex/lib/rateLimits.ts` (`museumSearch`), `convex/lib/flags.ts` (`museumSearch` / `FLAG_MUSEUM_SEARCH`), `.env.example` (name only), tests, one live check module `convex/museumSearch.live.test.ts` behind `MUSEUM_SEARCH_LIVE=1`.

**Out of scope**: the phone (05.07: consent, crop upload, downloading and verifying candidate images), promotion (04.08 treats `tavily+image` as strong), contributions (04.07 reads `labelFlow` unchanged), any change to which hosts may be fetched.

## Steps

### Step 1: Describe prompt

`convex/lib/describePrompt.ts`: `DESCRIBE_PROMPT_VERSION = 'describe-v1'`; `DESCRIBE_SYSTEM_PROMPT` — "You describe paintings for a museum catalogue search. Return only JSON matching the schema. Describe only what is visible; never name the work."; `DESCRIBE_SCHEMA` `{ description: string, artist_guess: string | null, confidence: number 0–1 }` with `additionalProperties: false`; `DESCRIBE_USER_PROMPT` asking for at most 40 words covering subject, composition, palette and notable objects, and a separate artist guess only when the style is unmistakable; `parseDescription(value) → { description, artistGuess, confidence } | null` (reject empty or > 400-character descriptions); `searchQuery(parsed) → string` = description plus the artist guess when `confidence ≥ 0.5`, whitespace-collapsed, ≤ 300 characters.

**Verify**: `describePrompt.test.ts`: parse accepts the schema and rejects extra keys, empty and oversize descriptions; `searchQuery` includes the guess only above the confidence bar.

### Step 2: `searchMuseumSite`

`convex/museumSearch.ts`, public action args `{ scanId, imageBase64 }` → returns `museumSearchDisplay`:

1. `requireDeviceFromAction`; `isEnabled('museumSearch')` else `feature_off`; load the scan (must belong to the device, have a `venueId`, be `identified` with `outcome !== 'confident'`, else `invalid_scan`); load the venue; `venueHosts(venue)` must be non-empty else `no_venue_site`; opt-out registry check via `isVenueOptedOut` else `venue_opted_out`.
2. Base64 and size checks exactly as `readLabel` (≤ 1.5 MB decoded); `limitDevice('museumSearch')`. Add `reserveSearchSpend` as an internal mutation in this module: call `reserveSpend` from `lib/spend.ts` for two `tokenFactory` calls (the read and its one retry) and one `tavily` credit **in the same mutation**, returning their reservation days. Let a cap error escape the mutation so both reservations roll back; do not split them into separate `runMutation` calls. The action catches `spend_cap`, writes `museumSearch = { stage: 'none', reason: 'cap', updatedAt }`, and returns without calling any provider.
3. `chatJson` with `LABEL_VL_MODEL`, the describe prompt, `imageBase64`, `parseDescription`, the label flow's 20 s timeout. The photo goes to the model and nowhere else: never stored, never logged, and the description and artist guess are never written to the scan or the logs — only `promptVersion`.
4. `search({ query: searchQuery(parsed), includeDomains: hosts, includeImages: false, maxResults: 5 })`. Wrap all work after reservation in `try`/`finally` and settle each successful reservation exactly once on its original day: Token Factory uses `chatJson`'s returned `calls` or the error's `data.calls`; Tavily uses response-reported credits. Refund any provider that was never called (including Tavily when description fails, and unconfigured clients). Retain the reserved amount when a request was attempted but its usage is unknown; never refund an ambiguous timeout as zero usage.
5. `selectSearchCandidates(response, hosts)` (in `labelVerify.ts`): keep `https:` results on the venue's hosts whose path matches `OBJECT_PATH` and not `NON_OBJECT`, ordered by `score`; for at most the first three, `fetchVenuePage` → `extractPage`; keep pages where `hasArtworkMetadata` holds and `fields.title` is present; image URLs through `allowedVenueUrl`, `TRACKING` and `.svg` filters, ≤ 3 per page. Result `[{ sourceUrl, fields: { title, artist?, date?, accession?, medium?, creditLine? }, imageUrls }]` with at least one image URL each (a page with no image cannot be confirmed and is dropped).
6. Write `scans.museumSearch` through an internal mutation that checks `deviceId` and `generation`: a non-empty list becomes `{ stage: 'candidates', candidates, promptVersion, updatedAt }`; an empty list becomes `{ stage: 'none', reason: 'no_candidates', promptVersion, updatedAt }`. Return the display shape.

Define and export `museumSearchDisplay` in `lib/validators.ts` and use it for the stored state, action responses and scan queries; candidates carry no page HTML. The states are `none` (reason `cap` or `no_candidates`), `candidates` (candidate list), or `confirmed` (the retained candidate list plus `selected: { sourceUrl, imageUrl }`); every state has `updatedAt`, and `promptVersion` is present when a description was attempted.

**Verify**: `museumSearch.test.ts` with `vi.stubGlobal('fetch')`: flag off; foreign scan; confident scan refused; scan without venue refused; oversize image; either cap → `stage: 'none', reason: 'cap'`, no provider call and both spend counters unchanged (repeat at the Tavily cap to prove Token Factory allowance is not consumed); a failed description refunds the unused Tavily credit and records only attempted model calls; successful calls reconcile unused retry allowance; an ambiguous search timeout retains its credit; results on other hosts, shop/audio paths and pages without metadata dropped; a page with no image dropped; happy path ≤ 3 candidates with image URLs and fields; the description string never appears in the stored scan (`JSON.stringify(scan)` does not contain it); every outbound page fetch went through `fetchVenuePage` (spy).

### Step 3: `confirmSearchCandidate`

Public action args `{ scanId, sourceUrl, imageCheck: { url, cosine, homographyValid } }` → returns `labelFlowDisplay`:

1. Device and scan checks as Step 2; accept `museumSearch.stage` of `candidates` or `confirmed`. Find a retained candidate with `sourceUrl` whose `imageUrls` include `url`, else `unknown_candidate`.
2. Require `Number.isFinite(cosine) && cosine ≥ IMAGE_MATCH_COSINE && cosine ≤ 1 && homographyValid`, else `image_mismatch`. If already `confirmed` with the same selected page/image and `scan.labelFlow` still has that candidate's verified fields, evidence, source URL and image URL, return its display without moderation, another search, or any write (including timestamps). A flagged result with empty fields and evidence for that selected page/image is also retryable. If the label flow has since changed, or another retained candidate is selected, process a new confirmation through the remaining steps.
3. Build typed label fields with `labelField`: `title` and `artist` get `tavily+image`, every other page field gets `tavily` (all locked). Run `moderateVerifiedFields` (from `label.ts`; export it) on those fields; flagged → empty fields and evidence with `moderation: 'flagged'`.
4. In one internal mutation, recheck device ownership, generation, candidate membership and the duplicate-confirmation guard before writing. Write `labelFlow = { stage: 'verified', fields, evidence, warnings: [], moderation, sourceUrl, imageUrls: [url], updatedAt }`; set `museumSearch.stage = 'confirmed'`, retain the candidates, and record `selected: { sourceUrl, imageUrl: url }`. Selecting another retained candidate replaces the prior selection and label result after the same validation and moderation. Return the display of the committed label flow.

**Verify**: tests: unknown page or image URL rejected in both accepted states; invalid cosine or `homographyValid: false` rejected with `image_mismatch`; flagged moderation clears fields; happy path locks title/artist with `tavily+image`, other fields with `tavily`, sets `sourceUrl`; discard the first response and retry the same page/image → identical stored result and timestamps, no additional provider calls or spend; repeat for a flagged result; a different retained candidate replaces the first without another search; a restarted generation rejects the stale write; 04.07's `contribute` precondition (`labelFlow.stage === 'verified'`) holds on the stored scan.

### Step 4: One image rule

Move the `imageCheck` validator to `convex/lib/validators.ts` as `{ url, cosine, homographyValid: boolean }` and use it in both `verifyLabel` and `confirmSearchCandidate`. `applyImageCheck` in `label.ts` upgrades to `tavily+image` only when `cosine ≥ IMAGE_MATCH_COSINE && homographyValid`. Update `label.test.ts` accordingly; 05.03's phone check gains the homography step (its plan is updated).

**Verify**: `label.test.ts`: a cosine-only check no longer upgrades; cosine plus homography does.

### Step 5: Public scan display

Move `labelFlowDisplay = labelFlow.omit('rawOcr')` and its inferred type from `label.ts` to `lib/validators.ts` so label actions and scan queries share the same public shape. Extend `scanDisplay` with optional `labelFlow: labelFlowDisplay` and `museumSearch: museumSearchDisplay`; update `displayScan` to project both, stripping `rawOcr` from the stored label flow. This covers `api.scans.get` and `internal.scans.getDisplay`; preserve their existing device ownership checks. Do not return the whole stored scan.

**Verify**: `scans.test.ts`: read through `api.scans.get` as the owner before search, after candidates are stored, after a cap/no-candidate result, and after confirmation; assert the returned state, selected page/image and verified fields. Seed `rawOcr` and assert it is absent from the public label flow; `vector` and `deviceId` remain absent. Another device gets `null`. `internal.scans.getDisplay` returns the same public projection for the owner.

### Step 6: Limits, flag, env

`rateLimits.ts`: `museumSearch: { kind: 'fixed window', rate: 10, period: HOUR }`. `flags.ts`: `museumSearch: { env: 'FLAG_MUSEUM_SEARCH', defaultOn: true }`. `.env.example`: add `FLAG_MUSEUM_SEARCH` to the server-side names list. `convex/museumSearch.live.test.ts` (skipped unless `MUSEUM_SEARCH_LIVE=1`): with a real crop fixture under `convex/lib/fixtures/` (a public-domain Met image, ≤ 200 KB) and a seeded venue whose hosts are SFMOMA's, run Step 2 and print the candidates; assert only that the action completes and spends ≤ 1 credit.

**Verify**: `npx vitest run convex/lib/rateLimits convex/lib/flags`; `npx convex codegen`; `npx convex dev --once`; `MUSEUM_SEARCH_LIVE=1 npx vitest run convex/museumSearch.live` completes and reports the candidates for the record in `docs/plans/README.md`.

## Test plan

`convex/museumSearch.test.ts`, `convex/lib/describePrompt.test.ts`, additions to `convex/lib/labelVerify.test.ts` (`selectSearchCandidates`), `convex/label.test.ts` (Step 4) and `convex/scans.test.ts` (Step 5); all `fetch` stubbed. One live run against the dev deployment (Step 6) before marking done.

## Done criteria

- [ ] Tests pass (≥ 15 new); tsc/lint; `npx convex dev --once`
- [ ] `grep -n "storage.store\|storage.generateUploadUrl\|console.log" convex/museumSearch.ts` → no matches (crop and description never stored or logged)
- [ ] Every outbound page `fetch` in `museumSearch.ts` and `labelVerify.ts` goes through `fetchVenuePage` (review)
- [ ] Either spend cap leaves both counters unchanged; unused reservations are reconciled (tests)
- [ ] Lost-response confirmation retries preserve the stored result and spend (tests)
- [ ] `api.scans.get` exposes search state and verified fields only to the owner, without `rawOcr`; generated output committed
- [ ] The live check ran; the venue, query length, credit spend and candidate count are recorded in the README status row
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The live check returns no object pages for every Bay Area venue tried — report the venues and the search responses; do not widen `includeDomains` or drop the host filter.
- `LABEL_VL_MODEL` refuses image input with the describe schema — report; do not choose another model here.

## Maintenance notes

- The describe prompt is a product surface: bump `DESCRIBE_PROMPT_VERSION` on any change and keep the "never name the work" instruction — the model proposes a query, the museum's page supplies the words, the phone's pixels decide.
- The phone-side check exists because the server has no embedder (§5.2); if that changes, move both the embedding and the homography server-side and drop `imageCheck` from the public API.
