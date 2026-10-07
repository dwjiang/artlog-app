# Token Factory model evaluations

Reusable label, fact-sheet, docent and moderation comparisons. The prompts,
fixtures and `config.json` define the evaluation protocol independently of
production prompts. See the
[findings](../../../docs/experiments/README.md#token-factory-models).
Check model availability, rates and context limits before live comparisons.

## Local checks

From this directory, with `uv` and Python 3.11 or newer:

```sh
uv sync --locked
uv run pytest -q
```

Tests make no provider calls. Fact-sheet and docent schemas reuse the retained
contracts in `scripts/data/fixtures/`; label and moderation schemas are under `schemas/`.
The pinned OpenAI SDK talks to Token Factory's OpenAI-compatible endpoint.

## Run a comparison

Set `NEBIUS_API_KEY` in the repository's gitignored `.env.local` or process
environment. `NEBIUS_BASE_URL` optionally overrides
`https://api.tokenfactory.nebius.com/v1/`. Review `config.json`'s model choices,
rates, token bounds and dollar budget before starting a new live run.

From this directory:

```sh
uv run --env-file ../../../.env.local python list-models.py --results-dir results/run-001
uv run --env-file ../../../.env.local python label-eval.py --results-dir results/run-001 --model kimi --limit 1
uv run --env-file ../../../.env.local python label-ocr-eval.py --results-dir results/run-001 --model super
uv run --env-file ../../../.env.local python factsheet-eval.py --results-dir results/run-001 --model super
uv run --env-file ../../../.env.local python docent-eval.py --results-dir results/run-001 --model lightning
uv run --env-file ../../../.env.local python moderation-eval.py --results-dir results/run-001 --model lightning
```

`--results-dir` is required and holds the reports and shared `budget.json` for
one evaluation run. Reuse it to resume; use a new directory for a separately
budgeted comparison. Output directories under `results/` are gitignored.
Removing `--limit 1` resumes the remaining fixtures. `--model` selects a configured
candidate; omitting it runs all candidates configured for that suite.

Each evaluator supports `--mode json_schema|json_object` and `--tag <name>`.
The default is strict JSON schema with thinking disabled through each model's
chat-template parameter. `--default-thinking` omits that override. Changed
protocols or fixtures require a new tag; tags share the directory's budget.
Recorded failures remain in the report. A deliberate retry uses a new tag.

Requests are serialized with a directory lock, have a 180-second timeout,
and disable SDK retries. The runner saves a cost reservation before dispatch,
then reconciles it with reported token usage. Unknown spend remains reserved;
API failures stop the run. Budget totals are local estimates at the configured
rates, not invoice totals or a cap on other clients. Keep the same ledger when
resuming a run. Each directory's ledger accounts only for that evaluation.

## Rescore saved responses

Rescoring requires no key and makes no provider calls:

```sh
uv run python label-eval.py --results-dir results/run-001 --model kimi --score-only
uv run python factsheet-eval.py --results-dir results/run-001 --model super --score-only
uv run python docent-eval.py --results-dir results/run-001 --model lightning --score-only
uv run python moderation-eval.py --results-dir results/run-001 --model lightning --score-only
```

The report must already exist and its protocol must match the configuration,
prompts and fixtures. Use the original `--mode`, `--tag` and thinking setting
when rescoring a saved run. The protocol check rejects mismatched configurations,
prompts or fixture manifests.

## Evaluation contracts

- **Labels:** 25 distinct photos, one request per model per photo. The system
  prompt is fixed in `prompts/label.txt`. Input is a JPEG data URL and the schema.
  `labels/manifest.json` records every accepted field value, attribution,
  license link, source URL, download URL and SHA-256. Ground truth is agent-transcribed;
  field scores measure agreement with that fixture. Case, whitespace, curly
  apostrophes and dash style are normalized. Explicit variants cover birth prefixes, some
  abbreviated date ranges and printed subtitles. Other differences count as
  errors, including added dates in titles and acquisition years as accessions.
  Report both field accuracy and the stricter rate of getting title and artist
  correct together. Also separate printed-field accuracy from null handling.
- **Labels from OCR (`label-ocr`):** the same 25 labels and scorer, but the input
  is the phone's reading of each photo: `labels/ocr-lines.jsonl`, one JSON line per
  file from the vision-rect Mac harness (`recognize-text`, the recognizer the app
  runs on device; regenerate after an OS update, its hash is part of the protocol).
  The user message is `{"lines": [{text, confidence}…], "schema"}` and the system
  prompt in `prompts/label-ocr.txt` is a copy of `LABEL_SYSTEM_PROMPT` in
  `convex/lib/labelPrompt.ts`; keep them identical. Scores are the model's raw
  output; the server additionally strips a trailing work date from the title.
- **Docent:** 20 hand-authored fictional fact sheets with eight facts each,
  three identical requests per model at temperature 0. These fictional works
  test adherence to the input independently of memorized art knowledge.
  A sentence is dropped if any citation ID is missing or unknown. Determinism
  requires all three valid JSON responses to be equal after canonicalizing
  object keys; sentence order and wording remain significant. Sentence-count
  compliance (three or four) is measured separately from JSON validity.
- **Fact sheets:** five real Met paintings, each with owner metadata from
  the Met API, a Wikidata snapshot, and five built-in web-search snippets.
  This evaluation does not measure Tavily behavior. Snippets use
  the owner's domain, with some thin or off-topic passages retained to test
  source selection. Scores are explicit trust inputs, not search relevance.
  Automated scoring checks exact URL membership. Semantic support and correct
  source assignment require the separate review recorded with the results.
- **Moderation:** 20 synthetic cases, ten flagged and ten benign, under the
  explicit policy in `prompts/moderation.txt`. Contact details, identifiers and
  credentials in this fixture are fictional. Report sensitive-case recall and
  benign-case specificity separately.

All suites reject malformed or schema-invalid JSON without stripping markdown,
extracting a substring, coercing fields or repairing output. Confidence numbers
are model claims; these tests do not calibrate them. Valid citations and valid
JSON do not establish factual correctness.

## Label image licensing and sample limits

The 25 photographs retain the individual Creative Commons licenses linked in
`labels/manifest.json`; the repository's license does not relicense them.
Attribution is to Marshall Astor (11), Jim.henderson (2), Another Believer (9),
and Elliott Brown (3). Files are original downloads or Wikimedia-generated
thumbnails up to 1280 pixels wide, with no local editing.

This is a convenience sample of six painting labels and nineteen labels for
other objects (sculpture, prints, a photograph, furniture and costume). It
includes English, Spanish and bilingual labels, small text and perspective,
but is not a representative painting-only museum benchmark. Excluded photos
were exhibition introductions or named multiple works. These are evaluation
assets; none are imported into the app or its index.
