# Experiment findings

Recorded observations from 2026-09-08 through 2026-09-13. These explain choices
and limitations; implementation and configuration live in code. Provider
availability, pricing, quotas, and source access are dated observations.
This is a reference for future work, not a new verification backlog.
Raw spike evidence is linked to the Git snapshot before the experiments were
removed from the working tree.
Reusable tools remain in the [model evaluations](../../scripts/evals/token-factory/README.md)
and [physical-iPhone benchmark](../../scripts/model/benchmark/README.md).

## Embedding model

C-RADIOv3-B's DINOv2 adaptor summary produces 1,536 values at 512 × 512 input;
the backbone summary is 2,304-wide. The accepted export uses symmetric
per-channel int8 for 53 Linear weights and fp16 compute. The index reconstructs
weights from CoreML's actual dequantized constants: independently rounding fp32
weights loses the phone's scale/materialization rounding. The production export
recipe and version contract are in [scripts/model](../../scripts/model/README.md).

On an iPhone 16 Pro, the int8 export predicted in approximately 67 ms but took
about 4.1 seconds to load. Minimum MPS/iPhone cosine was 0.99292 over 200
paintings; top-1 agreement with fp32 was 94.5% on a separate 2,000-image index.
These measure numerical agreement with prepared pixels, not camera recognition
accuracy. The 119.5 MB model package is not a whole-app or App Store size.

**Reject the tested 4-bit palette:** mean cosine against fp32 fell to about
0.740 and it offered no useful speed advantage. Other 4-bit recipes were not
evaluated. CPU fp16 produced NaNs; MPS fp16 passed. CUDA agreement was not
established. The export comparison used black letterboxing; production capture
and corpus preprocessing use the shared mean-color, bilinear contract.
Evidence: [export results](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/coreml-export/results),
[preprocessing fixtures](../../shared/model/fixtures/letterbox/README.md).

## Vector search scale

The measured corpus contained 30,000 synthetic vectors on Convex Starter/S16.
It does not establish storage, recall, or latency at 100k/300k/1M on Pro.
Python/HTTP batches of 500 and 1,000 vectors exceeded request-body limits;
250-row batches worked. JSON expansion, not raw float size, governed the limit.

Alternate views consume result slots. During a two-version experiment,
equality-filtered retrieval at limit 32 missed 3/100 known target objects;
limit 256 recovered all 100. Grouping cannot recover objects absent from the
retrieved results. More candidates also increase hydration cost, so retrieval
and geometric-verification limits are separate tradeoffs. These synthetic
observations do not establish real-artwork recall.
Evidence: [measurements](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/convex-vector-scale/results/2026-09-08).

## ORB verification

At 500 keypoints per side, JavaScript verification of ten synthetic positive
pairs took 201 ms p95, rising to 318 ms with inconsistent geometry. Twenty
positive pairs took 404 ms. The scalar WASM matcher prototype was about 6.4×
faster for matching alone, supporting a ten-candidate verification budget.
Its optional cross-check API was incomplete; accelerated timings excluded final
corner projection and quadrilateral checks. Prototype timings must not be
reported as the production identify action's latency or recognition accuracy.
Evidence: [runtime measurements](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/orb-runtime/results/2026-09-09).

## Token Factory models

Kimi K2.6 achieved joint title/artist accuracy of 24/25 labels (96%); MiniCPM
achieved 17/25. No NVIDIA vision endpoint was available on the public catalog
in the September 8 snapshot, so label-reading claims must name Kimi. Nemotron
3 Super was selected for fact sheets and Nemotron 3.5 Lightning for prose and
moderation. Model IDs are in the [recorded production settings](../operations/production.md#recorded-production-configuration).

All 195 main-suite strict JSON-schema calls were schema-valid. Small output
budgets needed thinking disabled. Schema validity and valid citation IDs did
not establish factual support: a reviewed docent sentence invented an exhibition
venue while citing real fact IDs. Lightning also violated the requested
sentence count on 13/60 calls; temperature zero did not ensure identical prose.
Super's five-work sample yielded 46 supported facts, too small to certify
general factuality. Moderation caught 10/10 sensitive fixtures but falsely
flagged two of ten benign cases.
Evidence: [model responses and reviews](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/token-factory/results).

## Data sources

Recorded source admission choices: Met designated Open Access metadata/images;
AIC metadata with separate licenses for description text; Wikidata structured
data with Commons rights evaluated per file. A `P18` image URL alone is not a
public-domain determination. `huggan/wikiart` was excluded for its uncertain,
research-limited license and missing stable artwork identities. Source terms
and admission behavior are summarized in the
[README](../../README.md#data-sources-and-terms).

AIC image access returned 403 in both native and desktop probes. Met thumbnails
used the returned `primaryImageSmall`; Commons used the returned `imageinfo`
thumbnail URL rather than a synthesized host/size. None of the five Bay Area
collection sites was cleared for automatic indexing in the investigation.
Cleveland's official API served as a separate integration fixture. The product
subsequently removed automatic crawling in favor of bounded, user-initiated
museum-page fetches. These records do not imply current permission or access.
Evidence: [source probes](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/data-sources/results),
[Met terms](https://www.metmuseum.org/policies/terms-and-conditions),
[AIC API licenses](https://api.artic.edu/docs/),
[Commons reuse policy](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

## Native modules

The inner-rectangle heuristic selected a painting's sky instead of its canvas;
live rectangle throughput did not establish artwork-boundary quality. The
separate ML Kit barcode package lacked support for the installed arm64 simulator;
the app now uses VisionCamera's built-in iOS object output. ORB byte parity is
meaningful on identical lossless pixels; JPEG re-encoding moves keypoints.

App Attest's environment follows the entitlement, not whether the app was
development-signed. A real assertion verified using
`SHA256(authenticatorData || SHA256(UTF8(clientData)))` as the message supplied
to ECDSA/SHA-256 verification; the unhashed concatenation failed. The public
fixture contains no private key. Museum-only MapKit filtering missed SFMOMA,
which motivated combining category and natural-language candidates.
The maintained [assertion fixture](../../convex/lib/fixtures/app-attest-assertion.json)
is exercised by the backend regression tests.
Evidence: [native observations and assertion fixture](https://github.com/dwjiang/artlog-app/blob/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/native-modules/notes/README.md),
[ORB fixtures](../../shared/orb/fixtures/orb-features-v1.json).

## Tavily and Right now

**Keep `FLAG_RIGHT_NOW=off`.** Recent timestamps and higher retrieval scores
did not prevent unsupported answers: a high-scoring answer contradicted its
source's date, and fabricated artists still received confident answers.
The 0.60 cutoff is provisional retrieval filtering, not a factuality score.
The app's complete-source-sentence and explicit-event-date checks are conservative
guards; the historical evaluation does not certify semantic grounding.

Museum-scoped searches found all ten tested title/artist pairs, but top-level
images were wrong in two cases and canonical pages sometimes ranked fifth.
Search proposes evidence; embedding and homography confirm the image. Filtered
Map/Crawl calls yielded no useful discovery beyond the start page, while a broad
control returned a sibling shop host despite external links being disabled.

The 71 recorded requests reported 65 credits while `/usage` remained unchanged;
billing reconciliation was unresolved. Region-domain filtering reduced coverage;
boosting domains did not constrain event location. Empty outcomes and concurrent
misses need the same cache/coalescing treatment as successful results.
Evidence: [recorded responses](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/tavily/results).

## Batch infrastructure

The index was built locally on Apple M5 Pro/MPS with the phone's recovered
weights. Nebius compute was limited to three L40S probe jobs, approximately
$0.15–0.25 estimated spend. No Nebius job built, enriched, or migrated the
production index; Token Factory is the live Nebius integration.

Recorded operational pitfalls: CPU quota was zero in `eu-north1`; job creation
blocked until terminal state; launch overhead was about two minutes; bucket
lifecycle rules ran nightly and did not replace immediate cleanup. The S3 mount
required exact `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` secret fields; authorized
REST keys required RSA 4096 and permits attached to groups.

The last resource inventory retained `artlog-jobs-sa`, group `artlog-jobs`,
the `artlog-scratch-s3` access key/secrets, `artlog-scratch` bucket, and three
completed jobs. The `artlog-0008-rest-probe` authorized key had a recorded
September 10 expiry. Their current existence was not checked during cleanup.
Evidence: [execution log](https://github.com/dwjiang/artlog-app/blob/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/nebius-jobs/results/log.md).

### Nebius resource inventory

IDs recorded on September 9 for future inspection and cleanup; current existence
and permissions have not been rechecked. The existing project, tenant and subnet
are context, not resources created by the probes:
`project-e00e99pgpr007wyskm60bb` in `eu-north1`,
`tenant-e00zsd0b8gb0g2c66g`, and `vpcsubnet-e00nvse36bxzs46x2m`.

| Probe resource | Recorded ID |
| --- | --- |
| Scratch bucket `artlog-scratch` | `storagebucket-e007391623532510352106` |
| Service account `artlog-jobs-sa` | `serviceaccount-e00bryft11k8ek0qs9` |
| Group `artlog-jobs` | `group-e00a015x4pjexywxcb` |
| Project editor permit for the group | `accesspermit-e00s6vs5wygzxmad6v` |
| Service-account group membership | `groupmembership-e00yt3qwt7m6hmpv07` |
| S3 access key `artlog-scratch-s3` | `accesskey-e00j6txnxsmq2h6w8z` |
| Secret created with the access key | `mbsec-e00gw97dkda15bb9gm` |
| Mount secret `artlog-scratch-s3` | `mbsec-e00xz63wx5x9tnkym8` |
| Mount secret version with the required S3 fields | `mbsecver-e00xt7vcv7fsegscdb` |
| REST probe authorized key (recorded September 10 expiry) | `publickey-e00vh7f19v9m88p9bf` |
| Completed GPU probe | `aijob-e00rf43r04r7k04gs5` |
| Completed bucket-ID mount probe | `aijob-e00qayrgs3n2x2bc8n` |
| Completed S3 mount probe | `aijob-e00r5qetvwz0301ss5` |

## Calibrator v2

The adopted `lr-v2` fit used 5,500 public-domain paintings (2,847 Met and 2,653
Wikidata), four augmentations each, against the verified 10k-painting index.
Canonical AIC objects lacked direct `imageRef` values and were not sampled,
although they remained retrieval candidates. Source-object groups separated
4,400 training objects from 1,100 holdout objects; sampling seed was `20260911`.

On 4,400 holdout queries: 4,369 were confident (4,366 correct, three incorrect),
29 were soft (28 correct), and two were misses. Confident precision was
99.9313%, accepted recall 99.8636%, and candidate AUC 0.999966. TypeScript
reproduced the Python decisions. The holdout also selected thresholds; context
was simulated and queries augmented indexed images. These tuning estimates
do not establish independent museum-camera, outside-index, or full-corpus accuracy.

**All training object penalties were zero, so the fitted penalty coefficient
is zero.** Corpus and rejection penalties are recorded but do not change v2
scores. Learning their effect requires nonzero-penalty training data. Confident
and soft thresholds are equal after the ordering cap; soft winners are blocked
from confidence by hard rules. Keep the actual configuration in
[weights.ts](../../convex/lib/calibrator/weights.ts), not duplicated JSON.

Training commands and context priors are in the
[jobs guide](../../jobs/README.md). Artifacts live under
`/Users/dwjiang/Documents/Artlog Data/jobs/out/02-09-2026-09-12-calibrator/`:
trained JSON, metrics, source manifest, feature rows, import/readback audits,
TypeScript evaluation, and demo results. Feature SHA-256:
`dec07b38a7d04fa361c83d0e51c25641f5415dbe0286e1abe3d9f9483945cf6e`.
