# Re-add the painting-description fallback to museum-site search

**Status: DEFERRED by the user on 2026-09-21.** Resume only when the user asks
to take up this work.

## Purpose

Museum-site search identifies a missed scan from the venue's own website. Until
2026-09-21 it had two rounds: an exhibitions search whose page images the phone
checks, then, when no image matched, a vision-model description of the crop that
formed a Tavily query over the venue's object pages. The second round was removed
so that every model on a live request path is an NVIDIA model: the only vision
model on Nebius Token Factory was Moonshot Kimi K2.6 (`LABEL_VL_MODEL`), and the
label flow moved to on-device OCR plus Nemotron at the same time. After the
removal a failed exhibitions search asks the visitor for the wall label, whose
verified title and artist already drive a museum-scoped Tavily search in
`verifyLabel` (`convex/label.ts`).

Re-add the description round only when an NVIDIA vision model is available on
Token Factory (or another Nebius runtime path) so the README's model table stays
NVIDIA-only. Read `docs/hackathon/README.md` before changing model providers.

## Starting point

The removed implementation is intact at commit `5957016` (the last commit on
`main` that contains it). Restore from history rather than rewriting:

```sh
git show 5957016:convex/lib/describePrompt.ts
git show 5957016:convex/lib/describePrompt.test.ts
git show 5957016:convex/museumSearch.ts            # searchMuseumSite, lines 125–191
git show 5957016:convex/lib/labelVerify.ts         # selectSearchCandidates, lines 180–207
git show 5957016:convex/lib/validators.ts          # museumSearchDisplay, lines 230–257
git show 5957016:src/lib/museum-search/flow.ts     # 'describe' and 'search' stages, lines 84–90
git show 5957016:src/lib/label/crop.ts             # prepareMuseumSearchCrop, lines 51–61
```

What each piece did at `5957016`:

- `convex/lib/describePrompt.ts` — `DESCRIBE_SYSTEM_PROMPT`, `DESCRIBE_USER_PROMPT`,
  strict `DESCRIBE_SCHEMA` (`description`, `artist_guess`, `confidence`),
  `parseDescription`, and `searchQuery`, which appends the artist guess only at
  confidence ≥ 0.5 and caps the query at 300 characters. `DESCRIBE_PROMPT_VERSION`
  (`describe-v1`) was written to the scan so a prompt change could be told apart.
- `convex/museumSearch.ts` `searchMuseumSite(scanId, imageBase64)` — reserved
  two Token Factory calls and one Tavily credit in one transaction
  (`reserveSearchSpend`), called `chatJson` with the crop, searched
  `includeDomains: hosts` with `searchQuery(described)`, ran
  `selectSearchCandidates`, and wrote `{ stage: 'candidates' }` or
  `{ stage: 'none', reason: 'no_candidates' }`. The crop went to the model and
  nowhere else: never stored, never logged; the description was never written.
- `convex/lib/labelVerify.ts` `selectSearchCandidates(response, hosts)` — kept
  object-page URLs on the venue's hosts, fetched up to `MAX_CANDIDATE_PAGES`,
  and required a title, artwork metadata (`hasArtworkMetadata`) and an image.
  `confirmSearchCandidate` then treated a candidate without `exhibition` as a
  named object page (fields carry `tavily`, title and artist `tavily+image`).
- `convex/lib/validators.ts` `museumSearchDisplay` — had a `candidates` stage and
  an optional `promptVersion` on `none` and `confirmed`; `scans.museumSearch`
  stores this union (`convex/schema.ts`).
- `src/lib/museum-search/flow.ts` — after an exhibitions round without a match:
  `onStage('describe')`, `prepareCrop(capture.cropPath)`, `onStage('search')`,
  `api.searchMuseumSite({ scanId, imageBase64 })`, then the shared
  `checkCandidates` round. `MuseumSearchStage` included `'describe' | 'search'`.
- `src/lib/label/crop.ts` `prepareMuseumSearchCrop(uri)` — JPEG 0.8 at 1024 px,
  falling back to 800 px, under `MAX_LABEL_PHOTO_BYTES`.
- Tests: `convex/lib/describePrompt.test.ts`, the `searchMuseumSite` block in
  `convex/museumSearch.test.ts` (lines 105–181 and the `candidates` cases after
  269), `museum-site search candidates` in `convex/lib/labelVerify.test.ts`
  (lines 187–260), the `candidates` writes in `convex/scans.test.ts` (136–158),
  `src/lib/museum-search/flow.test.ts` (stage order at line 38), and
  `convex/museumSearch.live.test.ts`.
- Docs: README "Where NVIDIA and Nebius are used" row for the vision model and
  the Tavily "Museum-site search" row; `.env.example` line 41; the model table in
  `docs/operations/production.md`.

## Proposed implementation when resumed

Match the current label-flow conventions at that time, not the `5957016` ones.
Each step ends with a check; stop and report on a mismatch instead of improvising.

1. **Confirm a vision endpoint.** Record the model ID, that it accepts an
   `image_url` data URL in the OpenAI-compatible chat API, and strict
   `json_schema` support, in `docs/experiments/README.md#token-factory-models`
   with the date. Add a new env var (for example `DESCRIBE_VL_MODEL`) to
   `.env.example` with a placeholder and to the Convex deployment; do not reuse a
   label-flow variable. Check: `npx convex env get DESCRIBE_VL_MODEL` prints the ID.
2. **Restore `convex/lib/describePrompt.ts` and its test** from `5957016`. Bump
   `DESCRIBE_PROMPT_VERSION` if the prompt changes for the new model.
   Check: `npm run test:convex -- describePrompt` passes.
3. **Restore the `candidates` stage and `promptVersion`** in
   `museumSearchDisplay` (`convex/lib/validators.ts`) and update the scans tests.
   Adding union members needs no data strip on the dev deployment.
   Check: `npx tsc --noEmit` exits 0.
4. **Restore `selectSearchCandidates`** in `convex/lib/labelVerify.ts` with its
   tests, and the non-exhibition branch of `confirmSearchCandidate` if it was
   simplified during the removal. Check: `npm run test:convex -- labelVerify museumSearch`.
5. **Restore `searchMuseumSite`** in `convex/museumSearch.ts`, reading the new
   env var, keeping the single-transaction reservation of two Token Factory calls
   plus one Tavily credit and the "crop is never stored or logged" comment. Rate
   limit kind stays `museumSearch`. Run `npx convex codegen` and commit
   `convex/_generated/`. Check: the restored `searchMuseumSite` tests pass.
6. **Restore the client round**: `'describe' | 'search'` stages in
   `src/lib/museum-search/flow.ts`, `prepareMuseumSearchCrop` in
   `src/lib/label/crop.ts`, the `searchMuseumSite` entry in
   `museum-search-deps.ts`, and the progress copy for those stages in
   `src/components/scan/result/museum-search-section.tsx`. Keep the order:
   exhibitions → image check → describe → search → image check. Check:
   `npm run test:app -- museum-search crop` passes with the stage-order assertion
   `['exhibitions', 'describe', 'search', 'check', 'done']`.
7. **Docs.** Add the vision model to the README model table and the Tavily
   museum-site row ("at most two credits per attempt"), `.env.example`, and
   `docs/operations/production.md`; keep `docs/hackathon/README.md` item 1 true.
8. **Live check** on the dev deployment with `LABEL_LIVE=1`-style gating as in
   `convex/museumSearch.live.test.ts`, then on a phone at a venue whose site
   serves object pages with artwork metadata. Sites whose pages carry no
   JSON-LD or author meta (SFMOMA) yield zero candidates, and famsf.org and
   Cantor answer Cloudflare 403 to the page fetch.

## Out of scope

- Reintroducing a non-NVIDIA model on a live request path.
- Changing the exhibitions round, the label flow, or the contribution path.
- Running a vision model on the phone for this purpose.

## Verification and completion

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:convex`, `npm run test:app` pass.
- [ ] A miss at a venue with object pages reaches `stage: 'candidates'` on the dev
      deployment and the phone confirms a page image (or reports `no_match`).
- [ ] Spend counters reconcile: a capped day writes `{ stage: 'none', reason: 'cap' }`
      without a model or search call.
- [ ] README model table and `docs/hackathon/README.md` remain consistent.
- [ ] Update this todo's status.
