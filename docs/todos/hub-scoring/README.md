# Hub scoring for the artwork index

**Status: DEFERRED by the user on 2026-09-12.** Resume only when the user asks
to take up this work.

## Purpose

Detect embedding views that are unusually similar to much of the corpus and
apply an object-level penalty when calculating identification confidence.
Average similarity is a proxy for hubness; its usefulness needs evaluation
against actual retrieval results.

## Starting point

- [hubs.py](../../../scripts/data/pipeline/hubs.py) already implements the scoring
  calculation, penalty output, and histogram summary.
- [hubs_test.py](../../../scripts/data/pipeline/hubs_test.py) covers a synthetic hub,
  equivalence to pairwise mean cosine, repeatable sampling, and empty/constant
  distributions.
- Use the deduplicated input and audits listed in the dated
  [corpus inventory](../../operations/corpus.md). Revalidate or rebuild those
  artifacts if unavailable when this task resumes.
- Hub scoring has not run on this completed corpus. An earlier partial-corpus
  experiment found no outliers; it does not validate the completed corpus.

## Import dependency while deferred

[push.py](../../../scripts/data/pipeline/push.py) imports every selected object with
`calibratorPenalty: 0`. Offline exports and dry runs require no penalty files,
and old scoring artifacts are ignored. Resuming this task must explicitly wire
validated scoring artifacts back into the importer and checkpoint fingerprint;
do not automatically run scoring during import preparation.

## Proposed implementation when resumed

1. Validate the deduplicated input files against `stats.json` before scoring;
   refuse changed input before writing output.
2. Sample up to 20,000 embedding views without replacement using seed
   `20260908`. For each view, calculate its mean cosine similarity to the sample.
   The existing implementation uses a dot product with the unnormalized sample
   centroid, which equals the mean of the individual dot products for unit vectors.
3. Flag scores strictly above the distribution mean plus three standard
   deviations, retaining at most the highest `floor(viewCount × 0.005)` scores.
   Zero flagged views is a valid result; the cap is an upper bound.
4. Resolve flagged views to their canonical objects through `vector-index.jsonl`.
   An object with any flagged view gets `calibratorPenalty: 0.5`; all other
   object rows get `0`, so a later import can clear obsolete hub penalties.
5. Write `penalties.jsonl`, `penalties.summary.json`, and an audit listing flagged
   objects, scores, distribution statistics, threshold, and input/output hashes.
   Review the highest-scoring objects before importing the penalties.

The importer writes penalties through `ingest:setObjectPenalty` into
`objects.calibratorPenalty`. Identification combines that value with other
signals and stores resulting probabilities in `scans.best.probability` and
`scans.runnerUps[].probability`, with `scans.calibratorVersion`. The raw hub
scores belong in the offline audit. Calibrator weights and thresholds live in
[the active configuration](../../../convex/lib/calibrator/weights.ts).

The `0.5` penalty and detection threshold are existing heuristics. Their effect
on false matches and valid matches needs evaluation during recognition testing
and [calibrator training](../../../scripts/data/README.md). The current v2 penalty
coefficient is zero: neither hub nor rejection penalties change its scores.
See the [training limitations](../../experiments/README.md#calibrator-v2).
This task does not change user-feedback rejection penalties or adopt new
calibrator weights.

## Verification and completion

- [ ] Add integration coverage for alternate views mapping to one survivor,
      zero penalties on other objects, and rejection of mismatched input hashes.
- [ ] Exercise the 0.5% cap with more eligible outliers than the cap, including
      tied scores; preserve deterministic output.
- [ ] Run the existing numerical and repeatability tests plus relevant import tests.
- [ ] Score the full verified corpus and audit flagged objects and artifact hashes.
- [ ] Evaluate the penalty's effect with a configuration that gives it weight;
      the current v2 should remain unchanged until a separately authorized retrain.
      Preserve ORB and venue eligibility rules.
- [ ] Archive the output and evaluation results, then update this todo.

Future scoring command, from `scripts/data/`, after this task is resumed:

```sh
uv run python -m pipeline.hubs \
  --features "/Users/dwjiang/Documents/Artlog Data/jobs/scratch/merged" \
  --out "/Users/dwjiang/Documents/Artlog Data/jobs/scratch/merged/penalties.jsonl"
```

Generating local scoring artifacts does not itself import them into Convex.
