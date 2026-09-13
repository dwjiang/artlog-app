# 009 — Calibrator v2 training

Date: 2026-09-12. Updated: 2026-09-13. Status: **real fit passed; v2 adopted**.
Implements [plan 02.09](../plans/02-index-build/09-calibrator-training.md).

The real run used the verified 10,000-painting index on development deployment
`usable-owl-256`: 13,616 embedding views and 10,000 ORB references. Every imported
metadata field, reference, vector, and ORB byte matched the local package.
Hub penalties remain zero.

The sampler processed **5,500 public-domain paintings** with no skipped images:
2,847 Met and 2,653 Wikidata. Canonical AIC objects lack a direct `imageRef`, so
the current sampler cannot select them, although they remain indexed candidates.
Four augmentations per painting produced **22,000 queries and 435,600 candidate
rows**, including 21,984 positive rows; 16 queries failed to retrieve their true
object. Downloaded images were removed after feature extraction.

The fit used 4,400 source objects / 348,441 rows for training and held out 1,100
different source objects / 87,159 rows / **4,400 queries**. The source-object
groups do not overlap. Seed: `20260911`; model:
`c-radiov3-b-int8-512-dinov2-v1`, with the accepted fake-quantized weights on
MPS/float16. Train-only standardization was folded into the emitted coefficients.

| Held-out outcome | Queries | Correct | Incorrect | Precision | Correct / all queries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Confident | 4,369 | 4,366 | 3 | 99.9313% | 99.2273% |
| Soft | 29 | 28 | 1 | 96.5517% | 0.6364% |
| Miss | 2 | 1 | 1 | — | — |

Candidate-level ROC AUC: **0.999966**. Top-1 accuracy:
**99.8864%**. Confident + soft precision:
**99.9090%**; accepted correct-object recall:
**99.8636%**. The actual TypeScript
`scoreCandidates`/`decide` implementation, given the exported v2 configuration,
reproduced the Python outcome counts across all 4,400 queries and passed both gates.

The chosen confident threshold is `0.13716605621132733`. The uncapped soft
threshold was `0.9999935725973662`; the required ordering caps it at the
confident threshold. Consequently, soft results at these thresholds are winners
blocked from confidence by the hard rules. The 80-keypoint / 15-inlier rule
constants remain unchanged; the report includes the nine-way rule sweep.
All training object penalties were zero, so their learned coefficient is zero.
Consequently, both corpus and rejection penalties are still recorded and passed
as features but do not affect scores under v2. This fit supplies no evidence for
their effect; learning that effect requires training rows with nonzero penalties.

These are tuning estimates: the holdout also selects thresholds, context priors
are simulated, and queries are augmentations of indexed collection images.
They do not establish accuracy on independent museum-camera or outside-index
photos. A separate small offline check with full-image letterboxing and neutral
context matched all seven indexed demo originals, including Wheat Field with
Cypresses. Five excluded originals produced three misses and two soft matches,
with no confident false matches. That check did not run v2 on the iPhone.

The operator authorized adoption on 2026-09-13. `CALIBRATOR_V2` now replaces the
hand-set v1 priors as the default in `convex/lib/calibrator/weights.ts`. The deployed
configuration exactly matches the artifact below, and running the adopted default
reproduced the 4,400-query evaluation counts. All 864 backend tests, TypeScript,
and ESLint passed. The physical iPhone build succeeded; subsequent live dev scans
recorded `lr-v2`, including a confident Wheat Field with Cypresses match.

V2 is deployed to dev `usable-owl-256` and production `admired-goldfinch-660`.
Production corpus setup and release status are tracked in
[plan 06.01](../plans/06-release/01-testflight-and-app-size.md).

The first sampling attempt stopped after 200 objects on a Unicode HTTP header.
Preserving raw `httpx.Headers` in bandwidth-limited reads and cached-response
replay fixed the crash; the incomplete sample was discarded. The successful run
used the same seed and verified index. Six regression cases cover UTF-8/Latin-1
and streamed, buffered, and cached responses. All 140 relevant Python tests,
11 TypeScript feature/configuration tests, Ruff, TypeScript, and ESLint passed.

Artifacts are under `jobs/out/02-09-2026-09-12-calibrator/`: trained JSON, full
report and metrics, source manifest and feature rows, import/readback audits,
verified index snapshot, TypeScript evaluation, demo evaluation, logs, and code
hashes. Feature SHA-256:
`dec07b38a7d04fa361c83d0e51c25641f5415dbe0286e1abe3d9f9483945cf6e`.
Re-run commands and context priors are in
[the jobs runbook](../../jobs/README.md#calibrator-training-0209).

## Trained artifact

```json
{
  "version": "lr-v2",
  "featureNames": [
    "similarity",
    "margin",
    "logCandidateCount",
    "atVenue",
    "gallerySame",
    "galleryDifferent",
    "onView",
    "logKeypointCount",
    "logInliers",
    "homographyValid",
    "objectPenalty"
  ],
  "weights": [
    7.474195072142699,
    383.78817433584715,
    -4.045085586473862,
    2.778795932765667,
    2.470154752909581,
    -0.2672894750022002,
    -0.46764532924772256,
    -0.7245000823878253,
    0.7926605931130953,
    4.306513855067736,
    0.0
  ],
  "bias": 1.5125644129619618,
  "thresholds": {
    "confident": 0.13716605621132733,
    "soft": 0.13716605621132733
  },
  "lowTextureKeypoints": 80,
  "textured": {
    "minInliers": 15
  },
  "lowTexture": {
    "minSimilarity": 0.93,
    "minMargin": 0.04,
    "requireVenueAgreement": true
  }
}
```
