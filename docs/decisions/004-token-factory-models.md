# 004 — Token Factory model evaluation

Date: 2026-09-08. Status: **accepted for downstream implementation; spike complete**.
Implements the investigation in [plan 00.04](../plans/00-kickoff-spikes/04-token-factory-models.md).
The [reproducible spike](../../spikes/token-factory/README.md) contains the
prompts, schemas, licensed images, frozen fixtures, raw responses and scores.

## Decision

| Future Convex variable | Value | Decision |
|---|---|---|
| `LABEL_VL_MODEL` | `moonshotai/Kimi-K2.6` | 24/25 (96%) joint title-and-artist accuracy; all 25 responses satisfy the schema. |
| `DOCENT_MODEL` | `nvidia/Nemotron-3_5-Lightning` | Prefer over Nano for latency, cost and sentence-count compliance; citation validation alone does not establish grounding. |
| `FACT_SHEET_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | All 46 generated facts cited supplied, supporting sources in this small sample. |
| `MODERATION_MODEL` | `nvidia/Nemotron-3_5-Lightning` | Caught all ten sensitive fixtures but falsely flagged two benign cases. |

These are configuration decisions for downstream plans, not deployed settings
or production certification. Use `json_schema` with `strict: true` for all four
uses. Retain local schema validation and reject malformed output without
repair. The tested calls use temperature 0 and disable thinking with
`chat_template_kwargs: {"thinking": false}` for Kimi and
`chat_template_kwargs: {"enable_thinking": false}` for the NVIDIA text models.
Kimi's template parameter follows the [model author's third-party serving guidance](https://huggingface.co/moonshotai/Kimi-K2.6).
Reuse the exact
[prompts](../../spikes/token-factory/prompts) and
[schemas](../../spikes/token-factory/schemas) when reproducing these results.

The plan's “70% on title+artist” does not define joint versus average field
accuracy. MiniCPM achieved **17/25 = 68% joint accuracy**, **18/25 = 72% title
accuracy**, **24/25 = 96% artist accuracy**, and **42/50 = 84% average field
accuracy**. This decision uses the conservative joint interpretation because
the identification path needs both fields. This is not a claim that every
candidate scored below 70%: GLM could not be measured at all. At the user's
request, Kimi was then evaluated on the same frozen fixtures and reached
**24/25 = 96% joint accuracy**, **25/25 = 100% artist accuracy**, and **49/50 =
98% average field accuracy**. It passes either interpretation of the gate.
This resolves the model-selection blocker for plan 04.06. No OCR-plus-text
architecture or app integration was implemented, and GLM need not recover to
proceed with the selected model.

## Availability and API behavior

The authenticated [catalog snapshot](../../spikes/token-factory/results/models.json)
contains 22 models, including these four NVIDIA IDs:

```text
nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
nvidia/Nemotron-3_5-Lightning
nvidia/Nemotron-3-Ultra-550b-a55b
nvidia/nemotron-3-super-120b-a12b
```

The Nano spelling in the original plan is stale; the exact ID above completed
all 60 docent requests. Model IDs are case-sensitive configuration. Both
`zai-org/GLM-5.3-Flash` and `openbmb/MiniCPM-V-4_5` are listed.

The `/v1/models` response has no modality tags. A later
[public metadata snapshot](../../spikes/token-factory/results/public-models-info.json),
discovered through alternate links in the pricing page's HTML, supplies model
types, use cases, context limits and prices. All four NVIDIA entries are
`text2text`; Kimi K2.6 is explicitly `image2text` with an image use case. Qwen
3.5's description is multimodal, but its served type is `text2text` and its use
cases omit images, so Kimi was the clearer candidate to test. No NVIDIA vision
endpoint was identified. [Public model metadata](https://tokenfactory.nebius.com/api/public/models_info).

Nebius confirms that Nano Omni and Cosmos 3 Super Reasoner
public endpoints were removed on August 31, 2026; dedicated deployments are
unaffected. Private or dedicated endpoints were not inspected or provisioned.
[Nebius deprecation notice](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice.md).

The authenticated base URL is `https://api.tokenfactory.nebius.com/v1/`, using
the Token Factory key in `NEBIUS_API_KEY`. The key is stored only in gitignored
local environment files in the workspace and primary checkout. Images were
sent as JPEG data URLs. The schema was included in the user prompt as well as
`response_format`, following the provider's structured-output guidance.
[Quickstart](https://docs.tokenfactory.nebius.com/quickstart),
[vision examples](https://docs.tokenfactory.nebius.com/api-reference/examples/vision-capabilities),
[JSON guidance](https://docs.tokenfactory.nebius.com/ai-models-inference/json).

All 195 successful main-suite requests returned JSON satisfying the local
schema. That demonstrates observed compliance, not a guarantee of constrained
decoding. There were no truncations in those runs. A setup probe with default
Lightning thinking and a 128-token ceiling exhausted its output on reasoning;
disabling thinking returned the requested JSON. Thinking control is documented
by [NVIDIA](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16).
The main suites use larger, recorded ceilings. GLM failed in both `json_schema`
and `json_object` modes, so neither mode's compliance could be assessed for it.

Requests were sequential, with SDK retries disabled and a one-second pause
between requests. No 429 occurred; this is not a throughput test. Nebius rate
limits are dynamic, so the illustrative 60 RPM / 400k TPM values are not an
account entitlement. [Rate-limit documentation](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits).

## Label results

Ground truth was transcribed by the executing agent before evaluation, without
independent human review. The 25 Creative Commons photographs cover six
painting labels and nineteen other objects, including English, Spanish and
bilingual labels. This convenience sample is not representative of the final
painting-only product. Each image's license, attribution, original URL and
SHA-256 are in the [manifest](../../spikes/token-factory/labels/manifest.json).

Both evaluated models used the plan's exact system prompt, strict JSON schema,
the same images, and the same accepted values. Kimi results:

| Field | Correct / all labels | Accuracy | Correct / printed fields | Correct null / absent fields |
|---|---:|---:|---:|---:|
| Title | 24/25 | 96% | 24/25 | — |
| Artist | 25/25 | 100% | 22/22 | 3/3 |
| Artist dates | 21/25 | 84% | 18/21 | 3/4 |
| Work date | 25/25 | 100% | 25/25 | — |
| Medium | 25/25 | 100% | 22/22 | 3/3 |
| Accession | 25/25 | 100% | 10/10 | 15/15 |
| Credit line | 25/25 | 100% | 25/25 | — |

Kimi got title and artist correct together on 24/25 labels, or 21/22 labels
printing an artist. It completed 25/25 requests without parse/schema failures,
API errors or truncation: p50 **2.373 s**, p95 **3.304 s**, estimated
**$0.002037 per call**, **$0.050918 for all 25**. The first successful pilot
was resumed as part of the 25-case main run, without duplicating that request.
[Raw responses and scores](../../spikes/token-factory/results/label-kimi-json_schema-main.json).

The title mismatch was `Rio` instead of the label's `Río` in “Border Crossing /
Cruzando el Río Bravo.” Four artist-date mismatches came from nationality or
century text mixed into the field, and one strict spacing difference around a
date-range dash. The frozen scorer counts these differences; accepted values
were not broadened after the run. The incorrect title still had confidence 1,
so confidence remains uncalibrated and the label-confirmation flow is still
necessary. This small sample establishes the spike's selection gate, not
production-wide 96% accuracy.

MiniCPM results for comparison:

| Field | Correct / all labels | Accuracy | Correct / printed fields | Correct null / absent fields |
|---|---:|---:|---:|---:|
| Title | 18/25 | 72% | 18/25 | — |
| Artist | 24/25 | 96% | 21/22 | 3/3 |
| Artist dates | 3/25 | 12% | 0/21 | 3/4 |
| Work date | 24/25 | 96% | 24/25 | — |
| Medium | 25/25 | 100% | 22/22 | 3/3 |
| Accession | 14/25 | 56% | 9/10 | 5/15 |
| Credit line | 17/25 | 68% | 17/25 | — |

Title and artist were both correct for 17/25 labels, or 14/22 when restricted
to labels printing an artist. Strict field boundaries matter: several titles
included the work date, artist dates included nationality or extra parentheses,
and accessions were invented from gift years or confused with credit lines.
The artist-date result is a field-extraction failure under the frozen accepted
values, not evidence that the underlying date characters were always unreadable.
High reported confidence sometimes accompanied wrong values; confidence is
not calibrated. No post-hoc accepted variants or output repair improved scores.

MiniCPM completed 25/25 requests: zero parse/schema failures, p50 **1.305 s**,
p95 **1.616 s**, estimated **$0.000637 per call**.
[Raw responses and scores](../../spikes/token-factory/results/label-minicpm-json_schema-main.json).

GLM produced no usable output in four attempts on the first fixture: a
55.9-second timeout, then three HTTP 500 responses around 3 seconds. The
`json_object` attempt omitted the optional thinking override and reported CUDA
out-of-memory. At the user's request, a further `json_schema` retry at 11:48 UTC
on September 8 failed after 3.244 seconds with the same GPU out-of-memory error.
Availability failed before
quality could be evaluated. Its field accuracy and successful-call cost are
**N/A**, even though the generic scorer records failed requests as incorrect.
[Timeout](../../spikes/token-factory/results/label-glm-json_schema-pilot.json),
[schema attempt](../../spikes/token-factory/results/label-glm-json_schema-main.json),
[provider OOM](../../spikes/token-factory/results/label-glm-json_object-pilot.json),
[requested retry](../../spikes/token-factory/results/label-glm-json_schema-retry-1.json).

## Docent results

Each candidate received 20 hand-written fictional fact sheets, eight facts
each, three times at temperature 0. Fictional works separate adherence to the
input from memorized art knowledge. Determinism means all three parsed outputs
match, including sentence order and wording.

| Metric | Lightning | Nano |
|---|---:|---:|
| Valid JSON / requests | 60/60 | 60/60 |
| Sentences rejected for empty/unknown fact IDs | 0/222 (0%) | 0/320 (0%) |
| Identical outputs across all three repeats | 8/20 (40%) | 7/20 (35%) |
| Outputs violating requested 3–4 sentences | 13/60 (21.7%) | 38/60 (63.3%) |
| p50 / p95 latency | 0.742 / 0.950 s | 0.903 / 1.122 s |
| Estimated cost per call | $0.0000699 | $0.0000808 |

The JSON contract permits an array of sentences; the 3–4 sentence instruction
was evaluated separately. Downstream validation must enforce that cardinality.
Temperature 0 did not produce identical outputs reliably. Caching remains
useful for latency, cost and review, not because generation is deterministic.
[Lightning results](../../spikes/token-factory/results/docent-lightning-json_schema-main.json),
[Nano results](../../spikes/token-factory/results/docent-nano-json_schema-main.json).

Review of the first Lightning repeat for all 20 fixtures (70 sentences) found
an unsupported claim despite valid citation IDs: `docent-08` attributes a 1959
first exhibition to the museum that acquired the work in 1987, although the
facts do not name the first exhibition venue. The planned ID validator accepts
this claim. Do not describe it as preventing invented provenance. Semantic
review or an additional grounding check remains necessary before accepting
the design's factuality guarantee; other repeats and Nano were not semantically
certified. [Review evidence](../../spikes/token-factory/results/docent-semantic-review.json).

## Fact sheets and moderation

Super received five real Met paintings, each with owner metadata from the Met
API, a Wikidata snapshot and five search snippets. The Tavily connector failed
authentication; built-in web search supplied owner-domain snippets instead.
This does not evaluate Tavily behavior or full owner-page extraction. Source
inputs, URLs and trust scores are frozen in the
[fixture](../../spikes/token-factory/fixtures/factsheet.json).

All five requests produced valid JSON, containing **46 facts with zero invented
URLs**. The executing agent checked all 46 against their cited supplied text;
all had supporting sources and matched a supplied URL/label/score tuple.
Duplicate URLs can represent both owner metadata and search excerpts. Eight
Degas facts were bare values rather than standalone claims, and some title
facts were redundant. The test does not cover complex provenance disputes or
diverse institutions. p50 **2.582 s**, p95 **3.326 s**, estimated **$0.001166 per
call**. [Results](../../spikes/token-factory/results/factsheet-super-json_schema-main.json),
[semantic review](../../spikes/token-factory/results/factsheet-semantic-review.json).

Lightning moderation returned valid boolean JSON for all 20 synthetic cases.
It caught **10/10 sensitive cases** and accepted **8/10 benign cases**: 100%
sample recall, 80% specificity, 90% overall accuracy. It falsely flagged an
explicitly labeled phone-shaped accession number and a public museum email.
This is a provisional choice with known false positives, not a reliability
claim for arbitrary museum labels. p50 **0.318 s**, p95 **0.387 s**, estimated
**$0.0000127 per call**. [Results](../../spikes/token-factory/results/moderation-lightning-json_schema-main.json).

## Cost and daily cap

Dollar figures use provider usage counts and public rates, without cache
discounts. Initially the rates came from the original plan because the browser
was unavailable. The later public metadata lookup verified all those rates
and supplied Kimi's rate directly from Nebius on September 8. They remain
**usage-based estimates, not invoice totals**.
[Configuration](../../spikes/token-factory/config.json),
[provider price snapshot](../../spikes/token-factory/results/public-models-info.json).

| Model | Input / output dollars per million tokens |
|---|---:|
| GLM 5.3 Flash | $0.15 / $0.50 |
| MiniCPM V 4.5 | $0.658 / $1.11 |
| Kimi K2.6 | $0.95 / $4.00 |
| Lightning / Nano | $0.06 / $0.24 |
| Super | $0.30 / $0.90 |

There were 195 successful main requests, seven successful pilot requests,
four failed GLM requests and three setup probes. Known token usage estimates
total **$0.082922** including setup. Unknown billing for each failed GLM request
retains a $1 reservation, and setup retains a $0.01 allowance. The conservative
[ledger](../../spikes/token-factory/results/budget.json) is **$4.092883**, below
the $4.50 local ceiling and the plan's $5 budget. That is not a $4.09 invoice.

The original flat $1 reservation prevented another request after the GLM retry.
For Kimi, verified metadata supports a tighter reservation: 262,144 maximum
context tokens at $0.95/M input plus the 2,048-token output ceiling at $4/M
costs **$0.257229** at those rates, conservatively counting the full context as
input. Its **$0.30 reservation** covers that bound. The runner checks this
calculation before accepting a model-specific reservation. All four GLM
reservations remain intact; neither the ledger nor the overall ceiling changed.

Recommend **`DAILY_TOKEN_FACTORY_CALL_CAP=500`** initially, counting every model
request, including retries and background enrichment. This is a proposed
configuration for the downstream limiter, not installed here. At observed
fixture sizes, 500 Kimi reads would estimate $1.018, or 500 Super fact sheets
$0.583. A request-count cap is not
a dollar cap: retain bounded inputs/output tokens and usage-based spend
accounting. Recheck current rates and the catalog before release.

## Design corrections

These are exact editing targets in [the design](../design/art-identifier.md),
provided for the downstream documentation pass; this spike does not silently
rewrite the product architecture.

1. **§2, NVIDIA requirement table:** replace “Nemotron Nano 2 VL or Nano Omni
   (vision), Nemotron 3 Super / Nano (text) on Token Factory” with “Nemotron
   Super and Lightning (text), plus Moonshot Kimi K2.6 for label reading, on
   Token Factory.” Keep the separate C-RADIO and Serverless Jobs
   claims subject to their own implementation spikes.
2. **§4.4, step 3:** replace the first sentence naming Nano 2 VL/Nano Omni with
   “Read the label with Kimi K2.6 on Token Factory, configured as
   `LABEL_VL_MODEL` (decision 004).” Keep the one-call extraction contract and
   the existing user-confirmation step. Do not call the
   saved VL extraction “raw OCR” without defining an actual OCR output.
3. **§5.2, item 3:** replace the model assignment sentence with “Token Factory
   serves Super for fact sheets and Lightning for docent prose and text
   moderation, and Kimi K2.6 for label reading, over its OpenAI-compatible API.”
4. **§5.7, ‘Where each NVIDIA component is used’:** remove the label-reading
   NVIDIA row and document Moonshot Kimi separately as the label reader.
   Change the docent/moderation row from Nano to Lightning; split
   cached docent generation from live moderation in its ‘where’ description.
   Add first uncached identification to the Super row. No multi-image
   verification model was evaluated or selected in this spike.
5. **§10, opening Token Factory pricing sentence and two Nano rows:** remove
   Nano Omni's retired public-endpoint pricing, rename Nano text to Lightning,
   and reference the September 8 public pricing snapshot. Replace the label
   cost row with “Kimi K2.6: $0.95/M input, $4/M output; measured approximately
   $0.002037/read ($20.37/10,000 comparable reads).” Recalculate monthly totals
   from actual traffic mix; this spike did
   not measure a full month or a multi-image verifier.
6. **§4.8, caching paragraph:** replace “at temperature 0 with a fixed fact
   sheet the output is the same every time” with “temperature 0 did not ensure
   identical output in decision 004.” Replace “the model still cannot invent
   a provenance and have it reach the screen” with “valid fact IDs establish
   citation membership, not semantic support; unsupported claims can pass.”
   Remove label reads from the sentence enumerating live Nemotron calls.
7. **Remaining model references:** change Nano docent/moderation references
   to the selected variables/Lightning in §4.8, §5.3 (`docent`, `readLabel`,
   ‘Model calls’), §5.7 enrichment, §7 cache-miss enrichment, §8 moderation and
   rate limits, and §9 docent latency. Remove Nano VL assumptions in §5.3 and
   §12. Update §11's docent-risk mitigation to acknowledge the observed
   citation-valid error. §9's 2–3 s end-to-end uncached enrichment claim remains
   unverified: this spike's timings exclude search, Convex and client delivery.

Honest README wording **at this repository's current implementation stage**:

> The architecture plans C-RADIO on the phone and in the index build. The
> Token Factory spike exercised NVIDIA Nemotron Super for fact sheets and
> Lightning for docent prose and text moderation. It selected Moonshot Kimi
> K2.6 for label reading, with 96% joint title-and-artist accuracy on 25 test
> labels. These calls are not yet integrated into the app. No NVIDIA vision
> endpoint was identified in the public catalog on September 8, 2026.

Once the app integrations exist, describe their actual call paths and caching.
Do not claim NVIDIA vision runs on each label capture or that this spike alone
proves the complete hackathon integration.

## Verification and remaining limits

Nine focused Python tests pass, covering strict JSON, extraction scoring,
citation rejection, exact source URLs, spend reservations and determinism
denominators, including full-context bounds for model-specific reservations.
Fixture hashes and saved score recomputation are checked offline.
The SDK dependency graph is locked with `uv.lock`.

`npx tsc --noEmit` fails on existing CSS import/type errors in
`src/components/animated-icon.web.tsx` and `src/constants/theme.ts`. ESLint is
not configured. No app, backend or iOS behavior changed, so an iOS runtime
check is not applicable to this Python spike. The key was authenticated; no
credential is included in the committed artifacts.
