# Plan 04.06: The label flow backend — QR fetch, label reading on Token Factory, verification, plausibility and moderation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`. Secrets are Convex env vars; never in files.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/label.ts convex/lib/tokenFactory.ts convex/lib/wikidata.ts convex/lib/pageExtract.ts convex/lib/tavily.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (external APIs; SSRF surface; the vision model choice comes from spike 00.04)
- **Depends on**: 04.03, 04.04, `docs/decisions/004-token-factory-models.md`, `docs/decisions/007-tavily.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.4 "The label flow": QR code check → read the label into structured JSON with a vision model on Token Factory (photo not retained) → verify in order of strength: accession on the venue's own site, title+artist pair on Wikidata, Tavily scoped to the museum ("text proposes, pixels decide") → present verified fields locked. §8: the artist must resolve to a Wikidata entity with an artist occupation, the date must fall within the artist's lifespan, extracted fields pass a text moderation check. §11: model IDs are config.

## Current state

- `scans` has `labelFlow?: any` (01.03) — this plan replaces it with a typed validator: `labelFlow?: { stage: 'qr' | 'read' | 'verified', fields, evidence, moderation, updatedAt }`.
- Env from spikes: `LABEL_VL_MODEL`, `MODERATION_MODEL`, `NEBIUS_API_KEY`, `TAVILY_API_KEY`; flags `FLAG_LABEL_FLOW`; caps (04.04 `spend`).
- Token Factory: `POST https://api.tokenfactory.nebius.com/v1/chat/completions` with `Authorization: Bearer`, messages with `{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,…' } }`, `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }` (or `json_object` if the record says so); 429 → `Retry-After`. Spike 00.04 fixed the prompt/schema and the accuracy expectations.
- Tavily (00.07): `POST https://api.tavily.com/search` `{ query, include_domains: [venueDomain], include_images: true, max_results: 5 }` = 1 credit.
- Wikidata: `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<title>&language=en&type=item&limit=10&format=json` then `Special:EntityData/<Q>.json` for `P31` (Q3305213 painting), `P170` creator; creator entity for `P106` occupation (painter Q1028181 / artist Q483501 / visual artist Q3391743), `P569`/`P570`. UA header required.
- Convex default runtime has `fetch`, `TextDecoder`, `atob`; args ≤ 16 MiB (a 1 MB JPEG as base64 ≈ 1.4 MB — fine).
- Rate limits (04.04): `labelRead` 30/h per device.

## Scope

**In scope**: `convex/label.ts`, `convex/lib/{tokenFactory,wikidata,pageExtract,tavily,plausibility,moderation}.ts` (+ tests), `convex/schema.ts` (`labelFlow` typed; `feedback` untouched), `convex/lib/validators.ts` (`labelFields` validator), tests with stubbed `fetch`.

**Out of scope**: contribution writes (04.07), the phone UI (05.03), the phone-side image-embedding comparison for Tavily images (05.03 calls `verifyLabel` again with `imageCheck`).

## Steps

### Step 1: Clients

`tokenFactory.ts`: `chatJson({ model, system, user, imageBase64?, schema, maxTokens })` → parsed JSON or throws `ConvexError({ code: 'model_error' })`; retries once on 429/5xx honoring `Retry-After` (cap 5 s); records `spend.recordSpend({ tokenFactoryCalls: 1 })` via the caller. `tavily.ts`: `search(params)` typed per 00.07. `wikidata.ts`: `searchEntities(title)`, `getEntity(qid)`, helpers `isPainting(entity)`, `creators(entity)`, `lifespan(creatorEntity)`, `isArtist(creatorEntity)`. All with the identified UA and 8 s timeouts.

**Verify**: unit tests with `vi.stubGlobal('fetch')`: JSON parse, retry on 429, UA header present.

### Step 2: QR fetch (`fetchQr`)

Public action args `{ scanId, url }` → `requireDeviceFromAction`; scan must belong to the device; `url` must be `https:` and its host must equal (or be a subdomain of) the visit venue's `website`/`collectionSiteUrl` host — otherwise `ConvexError({ code: 'qr_host_not_allowed' })` (prevents server-side requests to arbitrary hosts). Fetch once (no redirects off-host), `pageExtract.ts` parses schema.org `VisualArtwork` JSON-LD, then `og:title`, `meta[name=author]`, an accession-looking token (`/\b\d{2,4}\.\d{1,4}(\.\d{1,4})?\b/`), and the page URL; writes `labelFlow = { stage: 'qr', fields (evidence 'qr'), … }`.

**Verify**: tests: host allow/deny; JSON-LD parse; og fallback.

### Step 3: Read the label (`readLabel`)

Public action args `{ scanId, imageBase64 }` (≤ 1.5 MB decoded; reject larger): device check; `isEnabled('labelFlow')` else `ConvexError({ code: 'feature_off' })`; `limitDevice('labelRead')`; `assertUnderCap('tokenFactory')`; call `chatJson` with `LABEL_VL_MODEL`, the 00.04 prompt and schema; `moderation.ts`: `checkText(fields)` — `MODERATION_MODEL` yes/no JSON on the concatenated text (fallback to a small blocklist when the model errors); if flagged → `labelFlow.moderation = 'flagged'` and fields are returned empty with `reason: 'moderated'`; else write `labelFlow = { stage: 'read', fields (each `{ value, confidence, evidence: 'ocr' }`), rawOcr }` and return the fields. The image is not stored anywhere (assert no `storage.store` in this file — done criteria grep).

**Verify**: tests: flag off; rate limit; cap; happy path writes fields; moderation flag path; oversize rejected.

### Step 4: Verify (`verifyLabel`)

Public action args `{ scanId, fields: { title?, artist?, date?, accession?, medium?, creditLine? }, imageCheck?: { url, cosine } }`:

1. **Accession** (strongest): if the venue has `accessionUrlPattern` and `fields.accession` → fetch `pattern.replace('{accession}', encodeURIComponent(accession))` (same-host rule as Step 2); if the page's extracted title fuzzy-matches (`normalize` → token Jaccard ≥ 0.6) → evidence `accession` for title/artist/accession; also use the page's fields to fill blanks.
2. **Wikidata pair**: `searchEntities(title)` → paintings whose creator label fuzzy-matches `artist` → evidence `wikidata` with the Q-id (returned as `wikidataId`).
3. **Tavily**: atomically reserve one credit through 04.04, then use the exact basic Search shape from [decision 007](../../decisions/007-tavily.md), with domain `filter`, images, and all five results. Find the title/artist pair in substantive museum content, prefer a canonical object page over shops/essays/audio, and preserve its evidence URL → evidence `tavily`. Return `imageUrls` (≤ 3) associated with that selected museum object and approved image source; do not return the first global images blindly or include tracking endpoints. Title/artist alone cannot disambiguate different casts or similarly titled works; preserve accession evidence. When `imageCheck.cosine ≥ 0.85` is supplied on a second call, upgrade the evidence to `tavily+image`.
4. **Plausibility** (`plausibility.ts`): artist entity has an artist occupation; `date` (parsed year or range) within `[birth − 0, death + 0]` (or birth + 10 … death when only birth) — failures produce `warnings: ['artist_not_found' | 'date_outside_lifespan' | 'venue_unlikely']` and **downgrade** the affected field's evidence to `weak`; `venue_unlikely` when Wikidata lists no collection/location for the artist in this venue's country — advisory only.

Write `labelFlow = { stage: 'verified', fields (each with `evidence` ∈ accession|qr|wikidata|tavily|weak|ocr, `locked: evidence ∈ {accession, qr, wikidata, tavily}`), evidence: [...], warnings, wikidataId?, imageUrls? }`; return it. `false_rejection` hook: if the scan has an unresolved `feedback` row and the verified title+artist normalize to the rejected object's artwork → `internal.feedback.markFalseRejection` (04.07; if absent, skip and note).

**Verify**: tests: accession path locks fields; Wikidata path; Tavily path with image URLs; correct object at result five; study/shop result does not select the wrong object; global images of a different work/cast and tracking URLs are not treated as verified images; plausibility downgrades; SSRF host check on the accession URL.

## Test plan

`convex/label.test.ts`, `convex/lib/{tokenFactory,wikidata,pageExtract,plausibility,moderation}.test.ts` — all `fetch` stubbed; no live calls in tests. One manual live check against the dev deployment with a real label photo from the app (05.03) before marking done.

## Done criteria

- [ ] Tests pass (≥ 25 new); tsc/lint; `npx convex dev --once`
- [ ] `grep -n "storage.store\|storage.generateUploadUrl" convex/label.ts` → no matches (label photo never stored)
- [ ] Every outbound `fetch` in `label.ts` goes through the same-host check or a fixed API base URL (review)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- Spike 00.04 chose no viable VL model — do not pick one here; report.
- Token Factory rejects `json_schema` for the VL model — switch to `json_object` + validation and note the parse-failure rate.

## Maintenance notes

- Prompt/schema live in `convex/lib/labelPrompt.ts` with a `PROMPT_VERSION`; store it in `labelFlow.promptVersion` for later analysis.
- The phone-side image check exists because the server has no embedder (§5.2); if that changes, move the comparison server-side.
