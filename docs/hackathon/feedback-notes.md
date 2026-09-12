# Feedback notes — Token Factory, Serverless AI Jobs, NVIDIA models, Tavily

A dated running log for the hackathon's written-feedback deliverable (Most Valuable Feedback
prize). **Every executor appends here** when a plan touches a Nebius, NVIDIA or Tavily surface:
one dated bullet per finding, what was expected, what happened, and where the evidence is
(a decision record, a spike result file or a runbook section). Keep entries factual; the
submission copy is distilled from this file, so an entry that only says "worked fine" is not
worth adding, and one that names a deprecation, a surprise or a missing document is.

Seeded 2026-09-11 from decisions [001](../decisions/001-embedding-model-export.md),
[004](../decisions/004-token-factory-models.md), [007](../decisions/007-tavily.md) and
[008](../decisions/008-jobs-and-release-logistics.md).

## Token Factory

- **2026-09-08 — Deprecations found the hard way.** The plan named Nemotron Nano 2 VL and Nano
  Omni for label reading. Nano 2 VL's public endpoint was retired 2026-04-13 and Nano Omni's on
  2026-08-31 (the August deprecation notice); dedicated deployments are unaffected. There was no
  NVIDIA vision endpoint on the public catalog on 2026-09-08. Deprecation notices are easy to miss
  from the model page; a "replaced by" pointer on the retired model's card would have saved a
  spike. Evidence: decision 004, `spikes/token-factory/results/models.json`.
- **2026-09-08 — `/v1/models` carries no modality tags.** The list response cannot tell a
  text-only model from a vision one. Modalities, use cases, context limits and prices exist in
  the public `models_info` endpoint, which we found only through alternate links in the pricing
  page's HTML. Exposing that metadata on `/v1/models` (or documenting `models_info`) would remove
  the guesswork. Evidence: `spikes/token-factory/results/public-models-info.json`.
- **2026-09-08 — Structured output behaves, with a thinking caveat.** All 195 main-suite requests
  with `response_format: json_schema` (`strict: true`) returned schema-valid JSON across Kimi,
  Lightning, Nano and Super. But Lightning with default thinking and a 128-token ceiling spent the
  whole budget on reasoning and returned nothing; `chat_template_kwargs: {"enable_thinking":
  false}` (Kimi: `{"thinking": false}`) fixed it. The JSON guide should say that thinking must be
  disabled, or the output ceiling raised, for small structured responses.
- **2026-09-08 — Rate limits are undocumented as entitlements.** The docs describe dynamic limits
  with illustrative 60 RPM / 400k TPM figures; there is no per-account view of the current limit.
  We never hit a 429 at one request per second, so the sequential harness was not a throughput
  test. A `/usage` or limits endpoint would make budgeting possible.
- **2026-09-08 — Pricing clarity.** Rates had to be assembled from the pricing page and the
  `models_info` snapshot; the billing view gives no per-request cost. Our ledger is therefore an
  estimate from token counts (Kimi $0.95 / $4.00, Lightning and Nano $0.06 / $0.24, Super $0.30 /
  $0.90 per 1M input / output tokens on 2026-09-08). Returning cost per response next to `usage`
  would let a spend cap be a dollar cap instead of a call-count cap.
- **2026-09-08 — GLM 5.3 Flash was unusable during the spike.** A 56 s timeout, then three
  HTTP 500s reporting CUDA out-of-memory on a single-image request, in both `json_schema` and
  `json_object` modes. Availability failed before quality could be judged; a status page per
  model would have told us not to retry. Evidence: `spikes/token-factory/results/label-glm-*`.
- **2026-09-10 — Live label read in the app.** Kimi read a de Young Thiebaud label in 4.2 s with
  all seven fields correct (plan 04.06 live check). The read is the slowest step of the label
  flow; a smaller vision model on the public catalog would matter more than a smarter one.

## Serverless AI Jobs

- **2026-09-08 — The tenant started out suspended.** The project reported `suspension_state`
  until about 06:56 UTC on 2026-09-09, which blocked the spike for a day and was the immediate
  reason the index build moved to a local Mac. The console gave no reason or ETA.
- **2026-09-09 — CLI ergonomics.** `nebius ai job create` blocks until the job reaches a terminal
  state and prints plain text (`Job ID: aijob-…` first) even with `--format json`; scripts must
  parse the first line and then poll `job get --format json`. A non-blocking create with a JSON
  body would be the expected shape. Federation sessions expire within a day and the CLI is only
  on PATH in interactive shells.
- **2026-09-09 — Quotas.** Non-GPU vCPU quota is 0 in `eu-north1` while the L40S quota is 32, so
  the cheapest CPU job (`cpu-d3 4vcpu-16gb`) was rejected at create and every probe ran on an
  L40S at about $1.55/h. Quotas live on the tenant; project-level allowances carry no numbers.
  A default of a few vCPUs in the region that holds the GPUs would let small jobs run cheaply.
- **2026-09-09 — Job overhead and logs.** About two minutes from create to `RUNNING` (`STARTING`
  at ~75 s, then image pull: ~30 s for the 3 GB CUDA image, ~2 s for `python:3.12-slim`); `job
  logs --timestamps` works after completion. Fine for batch work, too slow for anything
  interactive. The billing CLI offers only calculator estimates and one-time exports, so the
  console is the only authority on what a job cost.
- **2026-09-09 — Scratch storage.** Bucket lifecycle rules are native to the CLI (no AWS CLI
  needed) and evaluate nightly, so they are an orphan backstop, not end-of-run cleanup. The
  bucket-ID mount form needs no credentials; the `s3://` mount form requires a SecretStash secret
  whose payload keys are exactly `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (the server names
  them only in its error) plus a local AWS shared-config profile for endpoint and region. The
  `mystery_box` access-key delivery stores the secret under one `secret` key, which the mount
  does not accept, so a second secret had to be created. Document the required key names.
- **2026-09-09 — Service-account REST launch.** Authorized keys must be RSA 4096-bit (2048 is
  rejected without saying why); access permits attach to groups, never to accounts. The token
  exchange and job listing over REST worked on the first try once those two were known.

## NVIDIA models

- **2026-09-08 — C-RADIOv3-B export.** Two repository traps: the unversioned `nvidia/C-RADIO` is
  the 0.7B H-class model, and the half-precision `C-RADIOv3-B` checkpoint is ~550 MB because it
  carries every teacher's adaptor head. The DINOv2 adaptor summary is 1,536-wide, not the
  backbone's 768 (the backbone summary is 2,304), which doubled our storage math. Model-card
  fields for output widths per head would have avoided a spike day.
- **2026-09-08 — Conversion and quantization.** `torch.jit.trace` converts the backbone plus one
  summary head to an iOS 17 ML Program with no unsupported ops. Per-channel symmetric int8 on the
  53 Linear weights keeps minimum cosine ≥ 0.99 against fp32 on 200 paintings; the 4-bit palette
  collapses to a mean cosine of 0.74 and is no faster. The int8 package is 119 MB, above the
  design's ~90 MB estimate, and loads in about 4 s on an iPhone 16 Pro before the first 67 ms
  prediction. Full CPU fp16 in PyTorch produced NaNs (block 1's attention projection); MPS fp16
  did not. Evidence: decision 001, `spikes/coreml-export/`.
- **2026-09-08 — Nemotron JSON reliability.** Lightning and Nano returned valid JSON on 60/60
  docent requests with zero invalid citations, but violated the requested 3–4 sentence count on
  21.7% (Lightning) and 63.3% (Nano) of outputs, so cardinality must be enforced downstream.
  Temperature 0 gave identical outputs across three repeats for only 8/20 (Lightning) and 7/20
  (Nano) fixtures. A semantic review found a claim with valid fact IDs that the facts did not
  support (`docent-08`), so citation validation is not grounding. Super produced 46 facts with
  zero invented URLs on five real Met paintings.
- **2026-09-08 — Lightning as a moderator.** Caught 10/10 sensitive fixtures and falsely flagged
  2/10 benign ones (a phone-shaped accession number and a museum email). Usable with a blocklist
  fallback; a purpose-built safety model on the catalog would be better.

## Tavily

- **2026-09-08 — Search behaves; billing reconciliation does not.** 71 requests reported 65
  credits in their responses, yet the `/usage` endpoint reported the same 14 before and after.
  We budget against response-reported credits and treat the dashboard as separate evidence; the
  cause is unknown. Evidence: decision 007 §5, `spikes/tavily/results/usage-*.json`.
- **2026-09-08 — `published_date` was present on every news result** (52/52 artist calls, all
  within the 31-day window, none in the future), so the planned date guard rejected nothing. The
  problem is the opposite of gaps: an empty topic still returns a confident answer with recent
  dates (both synthetic-artist controls did), so relevance score and source-sentence matching,
  not dates, carry the acceptance decision. `include_answer` answers blended sources (an August 9
  death date against a source saying August 14) and a higher score did not fix attribution.
- **2026-09-08 — Map cost predictability.** Filtered Map and Crawl requests from a homepage or
  collection-search page returned zero URLs and zero credits; an object-page start returned only
  the supplied URL; a broad `.*` control returned ten URLs for one credit and included a sibling
  `shop.` host despite `allow_external: false`. Documented costs (200 credits per 2,000 mapped
  pages, extraction on top for Crawl) could not be checked at scale. We use API, IIIF and sitemap
  discovery before Map, and an exact host check on every URL.
- **2026-09-08 — Label verification fallback.** Museum-scoped search found the title/artist pair
  in the top five for 10/10 known works, but the canonical object page ranked fifth twice behind
  audio, video and study pages, and `images[0]` showed a different painting or cast in 2/10 cases.
  Per-result `images` also carried unrelated works and tracking endpoints. We never trust an
  image URL as evidence; the phone confirms it by embedding and homography.
- **2026-09-08 — Regional domain filtering.** `include_domains_mode: filter` with a regional
  publisher list suppressed most lesser-known artists to abstentions, while `boost` mode returned
  the same Australian Hockney and Atlanta Banksy stories in every region. A per-result "matched
  because" field, or a documented way to filter by event location rather than publisher, would
  make "what's on near me" answerable.
