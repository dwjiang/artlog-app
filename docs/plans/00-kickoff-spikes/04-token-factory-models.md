# Spike 00.04: Pick the Token Factory models — and resolve the missing NVIDIA vision model

> **Executor instructions**: Time-boxed investigation (1 day). Deliverable is a
> decision record plus a short list of design-doc corrections. Update the
> status row in `docs/plans/README.md` when done. Never paste API keys into
> files; read them from `NEBIUS_API_KEY` in the environment.
>
> **Drift check**: `ls docs/decisions/004-token-factory-models.md` must not exist.

## Status

- **Priority**: P0 (gates 04.06 label flow, 04.09 docent, 02.07 enrichment, and the README's NVIDIA claims)
- **Effort**: S–M (1 day)
- **Risk**: MED (the design's vision-model assumption is currently false)
- **Depends on**: none (a Token Factory account with credits)
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.4 reads wall labels with "Nemotron Nano 2 VL (or Nano Omni; pick the newest VL model live on Token Factory at kickoff)", §4.8 writes docent prose with Nemotron 3 Nano and fact sheets with Nemotron 3 Super, and §2 claims the hackathon's "uses ≥1 NVIDIA open model" requirement is met partly by those live calls. Research on 2026-09-08 found:

- Base URL confirmed: `https://api.tokenfactory.nebius.com/v1/` (OpenAI-compatible; `Authorization: Bearer`).
- Text: `nvidia/nemotron-3-super-120b-a12b` at $0.30/$0.90 per 1M tokens (matches §10); `nvidia/Nemotron-3_5-Lightning` (the Nano-3 successor, 30B-A3B) at $0.06/$0.24; `nvidia/nemotron-3-nano-30b-a3b` listed at the same price but its availability is uncertain (playground showed "Model is not selected"); `nvidia/Nemotron-3-Ultra-550b-a55b` at $1.00/$3.00.
- **Vision: `nvidia/Nemotron-3-Nano-Omni` was deprecated and its public endpoint removed on 2026-08-31; `nvidia/nemotron_nano_v2_12b` (Nano 2 VL) was retired 2026-04-13.** As of today there is **no NVIDIA vision-language model on Token Factory's public endpoints.** Vision-capable public models seen: `zai-org/GLM-5.3-Flash` ($0.15/$0.50), `openbmb/MiniCPM-V-4_5` ($0.658/$1.11), `moonshotai/Kimi-K2.6`, `Qwen/Qwen3.5-397B-A17B`. Options to keep an NVIDIA model on the image path: a Token Factory dedicated endpoint / Custom Weights Hub (paid, idle), or self-hosting Nano Omni with vLLM on a Serverless AI endpoint (also idle-billed). Otherwise: an NVIDIA text model for docent/fact sheets/moderation (satisfies the requirement) plus a non-NVIDIA VL model for labels.
- Structured output: `response_format: { type: "json_schema", json_schema: { name, schema, strict } }` and `json_object` are supported per model (look for the "JSON mode" tag); not documented for vision models. Image input: OpenAI-style `image_url` content parts with https or base64 data URLs; no documented size limit. Rate limits are dynamic (illustrative 60 RPM / 400k TPM; 429 with `Retry-After`).

The label flow is the product's out-of-corpus path; which VL model reads labels reliably into structured JSON is the single most consequential unknown left.

## Questions to answer

1. `GET /v1/models`: which `nvidia/*` IDs are served right now; is any vision-tagged NVIDIA model available (public or otherwise)?
2. Label reading quality: on 25 wall-label photos (take them at a local museum or use CC-licensed photos of labels; keep them under `spikes/token-factory/labels/` only if the license allows, else list URLs), for each candidate VL model (`zai-org/GLM-5.3-Flash`, `openbmb/MiniCPM-V-4_5`, plus any NVIDIA VL model found): field-level accuracy for title / artist / dates / medium / accession / credit line with the exact prompt and JSON schema below; latency; cost per call; whether `json_schema` is honored (parse-failure rate).
3. Docent prose: for 20 hand-written fact sheets (8–12 facts each), `nvidia/Nemotron-3_5-Lightning` and (if available) `nvidia/nemotron-3-nano-30b-a3b` at temperature 0 with the `[{sentence, fact_ids}]` schema — validator drop rate (sentence with empty or unknown `fact_ids`), determinism across 3 repeats, latency, cost.
4. Fact sheets: `nvidia/nemotron-3-super-120b-a12b` on 5 artworks with owner page + Wikidata + 5 search snippets as context — do facts carry the right source URL; hallucinated-URL rate.
5. Moderation: does Lightning reliably flag slurs/PII in extracted fields with a yes/no JSON schema (20 crafted cases)?
6. Cost of the label read at the chosen model, per call, and the daily cap value for `DAILY_TOKEN_FACTORY_CALL_CAP`.

Label-read prompt and schema (plan 04.06 will use the winner verbatim):

```
System: You read museum wall labels. Return only JSON matching the schema. Use null for fields not printed on the label. Do not guess.
Schema: { title: string|null, artist: string|null, artist_dates: string|null, work_date: string|null, medium: string|null, accession: string|null, credit_line: string|null, confidence: { title: number, artist: number, work_date: number, medium: number, accession: number } }
```

## Method

`spikes/token-factory/` with `uv` + `openai` SDK; `list_models.py`, `label_eval.py` (reads `labels/manifest.json` with ground truth), `docent_eval.py`, `factsheet_eval.py`, `moderation_eval.py`; each prints a table and writes `results/*.json`. Base URL and key from env. Keep total spend under $5.

## Deliverable

`docs/decisions/004-token-factory-models.md` with: the four model IDs to set as Convex env vars (`LABEL_VL_MODEL`, `DOCENT_MODEL`, `FACT_SHEET_MODEL`, `MODERATION_MODEL`), the per-field accuracy table, drop rates, costs, the chosen structured-output mode per model, and a **"Design corrections"** section listing exactly which sentences in `docs/design/art-identifier.md` (§2 table, §4.4 step 3, §5.2 item 3, §5.7 "Where each NVIDIA component is used", §10) must change and the honest README wording for the NVIDIA-model requirement (e.g. "C-RADIO on every scan; Nemotron Super/Lightning for every fact sheet, docent sentence and moderation check; labels are read by <model> because no NVIDIA VL model is served on Token Factory as of <date>").

## Done criteria

- [ ] Decision record exists with model IDs and the corrections section
- [x] `spikes/token-factory/` committed (scripts, manifest, results; no keys, no non-licensed images)
- [x] `docs/plans/README.md` status row updated

## Execution — 2026-09-08

[Decision 004](../../decisions/004-token-factory-models.md) records the completed
text evaluations, 25 MiniCPM label reads, three failed GLM attempts, costs and
exact design corrections. The first done criterion remains open because only
three of four model choices could be accepted. GLM returned no usable output
(timeout and HTTP 500, including provider GPU out-of-memory); MiniCPM reached
68% joint title-and-artist accuracy, versus 84% average field accuracy. The
decision explains this threshold ambiguity and conservatively leaves label
selection blocked. Reevaluate GLM when service recovers, or obtain the
operator's choice of an alternate label approach under the STOP condition.

## STOP conditions

- No credits / key — report.
- Every candidate VL model scores below 70% on title+artist — report; the design's label flow needs a different approach (e.g. OCR + text model) and that is the operator's call.

## Maintenance notes

- Model IDs are config, never code (§11 "Newer Nemotron VL model changes the API"). Plans 04.06/04.09/02.07 read them from env.
- Re-check `/v1/models` before submission day; deprecations have hit twice this year.
