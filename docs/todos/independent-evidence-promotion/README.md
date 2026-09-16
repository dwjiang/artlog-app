# Plan: Certify visitor labels with independent identity evidence

> **Deferred — do not implement as part of tentative contribution sharing.**
> Executor: read this entire handoff, compare the baseline with the current code,
> and run each verification gate before proceeding. Acceptance taps and matching
> photographs alone must never certify label text.
>
> Drift check: `git diff "$(git log -1 --format=%h -- docs/todos/independent-evidence-promotion/README.md)" -- convex src/components/scan src/lib/result src/lib/museum-search`.
> Baseline: the commit that last updated this handoff.
> Compare the listed symbols and invariants before implementation. Stop if the
> baseline has changed materially.

## Status

- **Status:** DEFERRED
- **Priority:** P2
- **Effort:** L
- **Risk:** HIGH — incorrect promotion presents visitor text as established fact
- **Category:** direction
- **Depends on:** immediate tentative contribution sharing and precise device removal
- **Planned at:** `e97199d`, 2026-09-15

## Why this matters

Visitors can already make a single consented contribution useful to others at
one museum. Its identity remains tentative even when museum evidence supports
it. A future release can establish an identity only when independently sourced
evidence binds the exact title and artist to the depicted work. That evidence
must remain attributable so withdrawal, bans, and rights changes can reverse
the decision without destroying independent support or private journal records.

## Current state

- `convex/contributions.ts`: `authorize`, `findGroupPage`, and `commit` retain
  authentication, attestation, rate limits, crop validation, and idempotency.
  Publication and recognition records commit together. The venue revision guards
  paginated grouping against concurrent submissions and removals.
- `convex/lib/tentativeEntries.ts`: `publishContribution` creates a separate
  community artwork with `identityStatus: 'tentative'`; `compatibleAnchor` checks
  model, museum, normalized names, verified accession compatibility, and cosine
  in `[0.9, 0.999)` against the oldest eligible backer, so a share that lands
  between a removal and its rebuild joins the entry instead of forking it.
  `replaysEntry` rejects a submission within `0.999` of any vector already on
  the entry as a duplicate rather than a second view. Publishing sets
  `acceptedAt` and records the leaderboard contribution credit.
  `applyReference` copies the entire displayed reference from one contributor. Museum/Wikidata claims stay on originating contributions;
  `museumWorkIdentities` remains owned by corpus ingestion.
- `convex/lib/agreement.ts`: `verifiedAccession`, `workKey`, and `contributionGroup`
  normalize claims for grouping. There is no contribution-promotion evaluator or
  trust increase.
- `convex/schema.ts`: artworks, objects, placements, and scan candidates carry
  explicit identity status. Vectors carry a model/scope partition and exact
  contribution or scan/proposal attribution. Contributions use `indexedObjectId`
  and `tentative | rejected` status.
- `convex/identify.ts` and `convex/lib/identifyPipeline.ts`: retrieve established
  and museum-scoped tentative candidates separately; score each pool independently.
  An established confident result wins. A tentative suggestion must satisfy the
  existing visual gates and soft score threshold, and its outcome is capped at soft.
- `convex/lib/recognitionEligibility.ts`: checks source eligibility on read paths,
  including bans, withdrawal, rights, and reviewed proposal provenance.
  `contributionRightsIssue` is the one rights predicate for sharing and reading.
- `convex/contributionRemoval.ts`: withdrawal and banning share `removeContribution`;
  `rebuildPage` selects the oldest surviving eligible contribution, ordering by
  creation time then ID. Support revisions and final transactional eligibility
  checks prevent stale jobs from restoring removed evidence.
- `convex/feedbackReplay.ts`, `convex/revert.ts`, `convex/placements.ts`, and
  `convex/promotion.ts`: replay attributable feedback, run durable device cleanup,
  reassess placement evidence, and reassess alternate-view witnesses. The
  ten-minute job only learns alternate views of established identities.
- `convex/docent.ts`, `convex/enrich.ts`, `convex/ingest.ts`, and `convex/feedback.ts`:
  tentative identities are excluded from enrichment and training exports.
- `src/components/scan/result/tentative-origin-notice.tsx` says:
  `Shared by a visitor. Label not independently confirmed.`
  `src/lib/museum-search/use-museum-search.ts` requires a user action to search
  when the primary suggestion is tentative.

Exemplars: registered Convex functions use object-form `args`, `returns`, and
`handler`; `convex/contributions.test.ts` drives real handlers with `convex-test`.
Use indexed pagination and persist cleanup progress; never an unbounded scan.
This is an iOS-only, light-mode, pre-release app. Make direct schema changes and
update every caller; do not add compatibility shims or migrations for old data.

## Scope

**In scope:** the files above, their colocated tests, generated Convex output,
and narrowly scoped evidence-storage/validation modules introduced for this work.
Read the applicable project and Expo SDK 57 guidance first.

**Out of scope:** account-wide bans, social ranking, trusting save counts,
certification from image agreement alone, dark mode, Android/web features,
automatic device-trust increases, app-store deployment, and retraction from
already trained external models.

## Commands

| Purpose | Command | Expected result |
| --- | --- | --- |
| Generate types | `npx convex codegen` | Generated output included in the diff |
| Typecheck | `npx tsc --noEmit` | Exit 0 |
| Backend tests | `npm run test:convex` | All non-live tests pass |
| App tests | `npm run test:app -- --runInBand src/components/scan src/components/settings src/lib/result src/lib/museum-search src/lib/label` | All pass |
| Lint | `npm run lint` | Exit 0, no new warnings |
| iOS | `npm run ios` | App builds and launches in light mode |

Use an explicitly classified development or isolated local backend for runtime
verification. Do not weaken the schema or reset a shared corpus just to make
a verification push pass.

## Ordered implementation

1. **Define independent identity evidence.** Add a typed, attributable evidence
   record binding an object to exact title/artist claims and the captured work.
   Support two sources: a museum record whose provenance and identity binding
   can be checked, or an independently captured matching wall label from another
   device. Capture acquisition identity, timestamps, field evidence, source
   document/image references, and revocation state. Reusing OCR output, edited
   text, an acceptance tap, or a matching painting photograph is insufficient.
   Write negative tests before implementing the certification predicate.
   **Gate:** `npm run test:convex -- convex/identityEvidence.test.ts` passes.

2. **Implement reversible certification.** Add an internal evaluator that reads
   eligible evidence transactionally and records the evidence IDs behind each
   decision. Keep community claims separate from canonical corpus records.
   A museum-backed route must validate the exact work/label binding, not merely
   membership on an exhibition page. An independent-label route must prove a
   distinct capture and compatible field claims; edited fields cannot borrow
   the original field's assurance. Add explicit conflict handling and tests.
   **Gate:** evaluator tests prove both qualifying routes, conflict refusal,
   duplicate/replay refusal, and concurrent evidence revocation.

3. **Integrate identity status with recognition.** Change partitions only after
   certification commits. Keep corpus origin separate from trust, update the
   object/artwork/placement and candidate contracts consistently, and guard
   enrichment, training, and placement writes with current evidence eligibility.
   Preserve established candidate quotas and deterministic displayed references.
   **Gate:** `npm run test:convex -- convex/identify.test.ts convex/lib/identifyPipeline.test.ts convex/contributions.test.ts convex/ingest.test.ts` passes.

4. **Wire reassessment into every evidence removal.** Extend withdrawal, device
   bans, rights revocation, and proposal cleanup to revisit dependent certification
   decisions. Retain established status only if surviving evidence independently
   qualifies; otherwise return to tentative museum-only recognition or remove the
   entry when no contributor remains. Update partitions and exports accordingly.
   Preserve valid corpus records, other contributors' assets, calibration penalties,
   and saved journal snapshots. Keep jobs indexed, paginated, resumable, and
   idempotent, with accurate operator completion status.
   **Gate:** removal tests cover both surviving and insufficient evidence,
   interrupted jobs, concurrent submissions, and more than one cleanup page.

5. **Update the iOS explanation and verify the complete flow.** Reuse the Maybe
   card and visitor-origin notice for tentative entries. Distinguish what the
   independent evidence confirms; do not imply that saving certifies a label.
   Test museum search behavior, save/edit/withdraw, and alternatives after status
   changes. Run the full commands above and two-device iOS scenarios, including
   evidence removal after certification. Record verification gaps explicitly.
   **Gate:** all commands pass and both certification routes and their reversal
   are demonstrated on iOS in light mode.

## Done criteria

- [ ] Both museum evidence and a distinct matching-label capture have positive tests.
- [ ] Acceptance taps, repeated scans, photo agreement, replayed labels, and edited claims have refusal tests.
- [ ] Removal re-evaluates the exact supporting evidence and reverses only unsupported decisions.
- [ ] Candidate partitions, enrichment, placements, and exports reflect current status.
- [ ] Corpus metadata, unrelated contributors, and private journal snapshots are preserved.
- [ ] Generated output, TypeScript, lint, backend/app tests, and two-device iOS checks pass.
- [ ] This handoff and the documentation index reflect the completed scope.

## STOP conditions

Stop and report if independent label acquisition cannot be distinguished from a
replay; museum evidence cannot bind the exact text to the exact work; certification
requires treating a save or painting image match as label evidence; canonical
metadata would need to absorb unverified community claims; or a deployment change
would require erasing shared data. Resolve the product/evidence contract before
adding weaker fallbacks.

## Git workflow and maintenance

Use the assigned workspace branch; do not rename it. Keep changes reviewable by
logical concern and include `convex/_generated/` output. Do not push, merge, or
perform store commands without an explicit request. Future evidence sources must
implement the same attribution, revocation, and reassessment contract. Reviewers
should scrutinize transaction boundaries and read-path eligibility while cleanup
is still running. Retraction from already trained external models stays deferred.
