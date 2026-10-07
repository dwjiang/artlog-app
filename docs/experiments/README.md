# Recognition and evaluation findings

Evaluation results describe a fixed workload. They do not establish provider
availability, prices, quotas, independent camera accuracy, or performance at
another corpus size. Reusable tools live in the [model evaluations](../../scripts/evals/token-factory/README.md),
[model workflow](../../scripts/model/README.md), and [physical-iPhone benchmark](../../scripts/model/benchmark/README.md).

## Embedding model

C-RADIOv3-B's DINOv2 adaptor summary produces 1,536 values at 512 × 512 input;
the backbone summary is 2,304-wide. The export uses symmetric per-channel int8
for 53 Linear weights and fp16 compute, followed by square-root-whitened PCA to
512 dimensions. Corpus embeddings reconstruct CoreML's actual dequantized
constants: independently rounding fp32 weights loses the phone's scale and
materialization rounding. Preprocessing follows the shared mean-color, bilinear
[letterboxing contract](../../shared/model/fixtures/letterbox/README.md).

The unprojected 1,536-dimensional int8 export measured approximately 67 ms per
prediction and 4.1 seconds to load on an iPhone 16 Pro. With bicubic resizing and
black letterboxing, minimum MPS/iPhone cosine was 0.99292 over 200 paintings.
These measurements apply to that export and preprocessing; they do not establish
PCA512 performance, camera recognition accuracy, or whole-app installation size.

The tested 4-bit palette reached only about 0.740 mean cosine against fp32 and
provided no useful speed advantage. That recipe is unsuitable for the numerical
contract; this result does not characterize other 4-bit methods. CPU fp16
produced NaNs in the evaluation while MPS fp16 passed.

Square-root-whitened PCA retained 96.1% of variance on the 402K-vector fitting
corpus. Full whitening lowered measured phone agreement below the mean 0.99 / min
0.97 gate. PCA also changes the cosine distribution, so dimensionality reduction
requires calibrated thresholds rather than reusing unprojected cutoffs.

Corpus deduplication's 0.93 projected-vector cutoff reproduced all 7,019 merges
from the unprojected fitting corpus (7,008 accession and 11 embedding merges).
This preserves those decisions; it does not independently establish deduplication
accuracy on unseen pairs.

## Vector search scale

[Pinecone's benchmark](pinecone.md) compares approximate retrieval with exact
cosine and passes both lists through the recognition pipeline. Alternate views
consume retrieval slots; object grouping cannot recover an object absent from
the candidate list. Retrieval limits and geometric-verification budgets therefore
need separate accuracy and cost evaluation.

Request limits depend on serialized JSON size, not raw floating-point payload
size. Import batching and direct feature-file uploads belong in the importer.
Raw payload estimates do not establish billed database or index storage.

## ORB verification

ORB verification checks candidate geometry after embedding retrieval. Matching
benchmarks must include homography, corner projection, and quadrilateral checks
when reporting end-to-end verification cost. Matcher-only prototype speedups do
not establish production action latency.

ORB byte parity requires identical lossless pixels. JPEG re-encoding changes
keypoints; reference/query preprocessing and extraction parameters belong in the
[shared fixtures](../../shared/orb/fixtures/orb-features-v1.json).

## Token Factory models

On-device Apple Vision OCR sends text to Nemotron for label-field sorting.
On a 25-label Mac harness using the app's prompt, Nemotron 3 Super got both title
and artist correct on 21 labels (24 correct titles and 22 artists). Two joint
misses came from OCR errors and two from labels naming several makers. The
121 ms median OCR measurement is from the Mac harness, not an iPhone.

Strict JSON-schema output and valid citation IDs do not establish factual
support. A reviewed docent sentence invented an exhibition venue while citing
real fact IDs. Requested sentence counts and temperature zero also do not ensure
output cardinality or identical prose. Validators and acceptance rules must
check the required response contract.

Small structured-output token budgets require disabled thinking or enough room
for reasoning and the response. Provider rate and spend caps must be based on
verified service limits and measured usage rather than a sequential quality run.
Evaluation commands and fixtures live in the
[Token Factory guide](../../scripts/evals/token-factory/README.md).

## Data sources

Admission distinguishes metadata terms from image rights. Met Open Access,
AIC metadata and separately licensed descriptions, Wikidata structured data,
and per-file Commons permissions have different contracts. A `P18` image URL is
not a public-domain determination. Museum attribution does not imply image
reuse permission. The [root README](../../README.md#data-sources-and-terms)
describes source admission and attribution.

Use provider-returned thumbnail URLs rather than inventing image host/size
paths. Access failures do not justify bypassing source restrictions. Bounded,
user-initiated museum-page reads do not authorize automatic collection crawling.

## Native modules

Rectangle throughput does not establish artwork-boundary quality: a visually
plausible inner rectangle can select a painting's content instead of its canvas.
Capture evaluation must inspect resulting crops, not only detection timing.

App Attest's environment follows the entitlement, not development signing.
Assertions verify with `SHA256(authenticatorData || SHA256(UTF8(clientData)))`
as the message supplied to ECDSA/SHA-256 verification. The
[public assertion fixture](../../convex/lib/fixtures/app-attest-assertion.json)
contains no private key and supports regression coverage.

Museum search combines MapKit category and natural-language candidates; a
museum-only category filter can omit valid museums.

## Tavily and Right now

Keep `FLAG_RIGHT_NOW=off`: recent timestamps and high retrieval scores do not
establish semantic grounding. Fabricated artist queries received confident
answers in the evaluation, and an answer contradicted its cited source. The
0.60 retrieval cutoff is not a factuality score. Complete-source-sentence and
explicit-event-date checks are conservative acceptance guards.

Museum-scoped searches found all ten tested title/artist pairs, but top-level
images were wrong in two cases and canonical pages sometimes ranked fifth.
Search proposes evidence; embedding and homography confirm images. Exact host
checks remain necessary for museum URLs; a provider's external-link setting
alone does not establish host membership.

Region-domain filtering constrains publishers, not the location of an event.
Empty outcomes and concurrent misses need the same caching/coalescing treatment
as successful results. Response-reported usage and provider billing are separate
measurements; reconcile them before making cost claims.

## Batch infrastructure

Corpus preparation runs locally using the phone-compatible recovered weights.
Token Factory is the runtime Nebius integration. Experimental Serverless AI Jobs
are not a production corpus-build or recognition path. Batch-service startup,
resource quotas, and billing require a fresh operational check when using that
service; a probe does not establish a production deployment contract.

## Calibration

Active weights and thresholds live in
[weights.ts](../../convex/lib/calibrator/weights.ts). Training and evaluation
commands are in the [pipeline guide](../../scripts/data/README.md#calibrator-training).
Augmented indexed images with simulated venue context do not replace independent
camera photos or absent-artwork evaluation. Source-object groups must remain
separate across training and holdout data.

The `lr-v4` fit searched a 402,139-vector package using 3,643 public-domain objects.
It included screen and gallery-photo augmentations, withheld target artworks for
30% of queries, and used artwork-level labels. Near-copy wrong references were
set aside using cosine or reference-to-reference homography. Half of queries
carried a venue. Holdout comprised 729 objects and 5,103 queries, of which 3,571
were answerable; confident precision was 0.990 and accepted recall 0.992 of
answerable queries. Holdout tuning is not an independent production accuracy rate.

The independent check used 1,046 Commons camera photos of 919 catalogued paintings,
excluded each reference file, and cropped through the import path. Removing
23 near-copies and 21 crops depicting another painting/panel left 937 photos.
Retrieval reached the target artwork in 507. `lr-v4` produced 458 correct and
six incorrect confident answers, plus one correct and two incorrect soft answers;
accepted recall was 0.490. All six confident errors were copies or versions of
the photographed composition. This dataset does not establish a zero false-match
rate or accuracy for every venue and camera condition.

The fitted object-penalty coefficient is zero. Stored hub and rejection penalties
therefore do not affect this calibrator's probabilities. A penalty cannot gain an
effect merely by importing its value; its behavior requires evaluated weights.
