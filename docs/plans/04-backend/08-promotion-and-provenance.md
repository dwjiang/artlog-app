# Plan 04.08: Promotion (strong evidence or Sybil-resistant agreement), multi-view vectors, provenance, and cascade reverts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/promotion.ts convex/revert.ts convex/crons.ts convex/schema.ts convex/lib/agreement.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (writes into the shared index; must be reversible)
- **Depends on**: 04.07, 04.12 (`tavily+image` evidence), 02.07/04.09 (enrichment claims promoted works)
- **Category**: feature / security
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.7: a contribution moves `private → pending → promoted | rejected`; promotion requires strong evidence (accession resolves on the venue's site, a QR to the collection page, or a museum page image the phone confirmed against the scan — `tavily+image`) or agreement (a second independent scan, same venue, matching embedding, naming the same work — distinct App Attest keys on distinct devices, ideally on different days; identical vectors rejected). Weak evidence always needs agreement. Promoted entries are indistinguishable from corpus works except `source` and provenance; everything is revertible. §4.6: resolved rejections add `user_scan` multi-view vectors after the same promotion rule. §8: trust weights (new devices count fractionally), banning a device cascades, opt-outs and takedowns cascade, review queue in the dashboard.

## Current state

- `contributions` rows (`private`) with vector/descriptors/fields/evidence/crop (04.07); `feedback` with resolutions; `devices.trustWeight` (default 0.5); `placementProposals` (04.03); `objects.provenance`, `objects.reverted`; `optOuts`/`takedowns` tables. There is no `crons.ts` yet (the crawler's was removed).
- Convex facts: cron target must be a mutation or action; a mutation writes ≤ 16,000 docs — cascades over large sets must be chunked and self-rescheduled; storage delete `ctx.storage.delete(id)`.

## Scope

**In scope**: `convex/promotion.ts`, `convex/lib/agreement.ts` (+ test), `convex/revert.ts`, `convex/review.ts` (dashboard queries), `convex/crons.ts` (create, with the promote cron), `convex/schema.ts` (`objects.thumbnailStorageId?: id('_storage')`, `placementSource` += `'contribution'`, `contributions.promotionNote?`), tests.

**Out of scope**: placement proposal review (04.10), enrichment (04.09/02.07), UI.

## Steps

### Step 1: Agreement rule (pure)

`agreement.ts`: `evaluate(candidate: Contribution, others: Contribution[], devices: Map<deviceId, Device>, now) → { promote: boolean; reason: 'strong' | 'agreement' | 'insufficient'; partners: contributionId[] }`:

- `strong` when `candidate.evidence` includes `accession`, `qr` or `tavily+image` **and** no title/artist field is `user_edited`. `tavily+image` counts because the phone confirmed the museum page's own image by embedding and homography (04.12): the museum's page, not the visitor, named the work.
- else `agreement` when there exists ≥ 1 other contribution with a different `deviceId`, same `venueId`, `cosine(vectors) ≥ 0.9` and `< 0.999` (identical = replay), same normalized `title+artist`, and the trust sum over distinct devices `Σ trustWeight ≥ 1.0` (two new devices at 0.5 each qualify; a confirmed device alone does not — it still needs a partner); `differentDays` is recorded but not required (design: "ideally").
- else `insufficient`.
Normalization: casefold, strip punctuation/diacritics, collapse spaces.

**Verify**: `agreement.test.ts` covers each rule, the replay exclusion, and the trust sum.

### Step 2: Promote (cron)

`promotion.ts`: `run` (internal action, cron every 10 min): page `contributions` by `by_status` (`private` and `pending`, ≤ 200 per run); for each: load same-venue contributions (`by_venue_status`) and devices; `evaluate`; on promote → `internal.promotion.apply({ contributionId, partners, reason })` (mutation):

1. Artwork: if `wikidataId` (from verification) → find `artworks` `by_wikidataId` else create `{ key: 'user:' + contributionId, title, artist, rightsStatus: 'unknown' → treated as in_copyright, multiplicity: 'unknown' }`.
2. Object: `{ key: 'user:' + contributionId, artworkId, ownerId: venueId, accession?, source: 'user', sourceId: contributionId, imageRef: 'storage:' + cropStorageId, thumbnailStorageId: cropStorageId, provenance: { contributionIds: [id, ...partners], deviceIds: distinct }, confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false }`.
3. Placement `{ venueId, gallery: scan.gallery?, onView: true, source: 'contribution', confidence: 0.7 }`.
4. Vectors: one `source: 'user'` row per contribution in the set (`modelVersion` from each); descriptors from the candidate (`extractedFrom: 'contribution:' + id`).
5. Contributions → `promoted`, `promotedObjectId`; partner devices' `trustWeight = 1.0`.
6. Nothing else: enrichment claims the new artwork via `enrich.claimBatch` (04.09) which prioritizes `source: user` objects.

Contributions older than 30 days still `private` with `insufficient` stay (they remain useful for the device); do not reject them.

**Verify**: `promotion.test.ts`: each strong evidence kind (`accession`, `qr`, `tavily+image`) promotes alone; `tavily` alone does not; weak needs a partner; same-device pair never promotes; replay excluded; promoted object visible to `identify` (run the identify test factory search and find it); `scans.get` returns a thumbnail URL for `source: user` via `thumbnailStorageId` (add that join to `scans.get` — in scope by exception, one branch).

### Step 3: Multi-view vectors from resolved rejections

In the same cron: group `feedback` with `resolution.kind === 'runner_up'` by `(objectId, venueId)` where ≥ 2 distinct devices resolved within 90 days; for each row not yet promoted (`feedback.multiViewAt?` — schema add), insert `vectors { objectId, modelVersion, source: 'user_scan', vector }` unless a `user_scan` vector for that object has cosine ≥ 0.995 with it; mark `multiViewAt`.

**Verify**: test: two devices → one vector per feedback row; one device → none; duplicate suppressed.

### Step 4: Cascade reverts

`revert.ts` (internal, dashboard-run via `npx convex run`):

- `revertDevice({ deviceId, reason })`: `devices.banned = true`; every object whose `provenance.deviceIds` includes it → `revertObject`; contributions by the device → `rejected` (`rejectedReason: 'device_reverted'`); proposals with the device's scans → `rejected`; feedback by the device → `resolution.kind = 'unresolved'`. Chunked: processes ≤ 200 objects per call and reschedules itself with a cursor.
- `revertObject({ objectId, reason })`: `reverted = true`; delete its `vectors` and `descriptors` rows; close placements (`closedAt`); delete `thumbnailStorageId` from storage; mark contributions `rejected`.
- `applyOptOut({ venueId, requester })`: insert `optOuts`, `museums.optOut = true`; revert every `source: 'user'` object placed at the venue (paginate `placements.by_venueId`) — the venue asked, and museum-site search and the label flow will no longer fetch its pages (`isVenueOptedOut`); chunked.
- `applyTakedown({ artworkId | objectId, requester })`: insert `takedowns`; revert the object(s); for an artwork, also clear `factSheet`/`docent`.

**Verify**: tests: revert removes vectors so `identify` no longer finds the object; opt-out flips the museum and reverts user objects across two chunks (`t.finishAllScheduledFunctions`); takedown clears docent.

### Step 5: Review queue and cron

`review.ts`: `listFlaggedObjects`, `listPendingContributions`, `listProposalsReady` (internal queries for the dashboard). `crons.ts`: `cronJobs()` with `crons.interval('promote', { minutes: 10 }, internal.promotion.run)`.

**Verify**: `npx convex dev --once`; dashboard shows the cron; `npx convex run review:listPendingContributions` returns JSON.

## Test plan

`agreement.test.ts`, `promotion.test.ts`, `revert.test.ts` (convex-test), plus the `scans.get` thumbnail branch test.

## Done criteria

- [ ] Tests pass (≥ 18 new); tsc/lint; `npx convex dev --once`
- [ ] Promotion never writes without `strong` or `agreement` (test); every promoted object has `provenance` (test)
- [ ] Reverts are chunked (grep for `scheduler.runAfter` in `revert.ts`)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The promote action needs more than ~2 s per run at 200 contributions — reduce the page size and report.

## Maintenance notes

- Deferred by design (§3): re-embedding from the consented crop before promotion. When added, it slots in between `evaluate` and `apply`.
- Trust weights beyond `0.5 → 1.0` are second priority (§8).
