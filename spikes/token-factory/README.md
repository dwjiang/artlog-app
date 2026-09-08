# Token Factory model evaluation — plan 00.04

The [decision record](../../docs/decisions/004-token-factory-models.md) interprets the
measurements. This directory contains the exact prompts, JSON Schemas, fixtures,
licensed label photographs, model catalog, raw responses, and scores.

## Run

Requires `uv` and Python 3.11 or newer. The lockfile was generated with Python
3.13.15 and OpenAI Python SDK 2.54.0. The SDK talks to Nebius Token Factory.

Set `NEBIUS_API_KEY` in the root workspace's gitignored `.env.local` or export it
in the environment. `NEBIUS_BASE_URL` optionally overrides
`https://api.tokenfactory.nebius.com/v1/`. No script embeds a credential.

```sh
cd spikes/token-factory
uv sync --locked
uv run pytest -q
uv run --env-file ../../.env.local python list-models.py
uv run --env-file ../../.env.local python label-eval.py
uv run --env-file ../../.env.local python docent-eval.py
uv run --env-file ../../.env.local python factsheet-eval.py
uv run --env-file ../../.env.local python moderation-eval.py
```

The evaluation scripts print one row per request and a JSON summary, and write
`results/*.json` after each call. Source filenames use kebab case per the root
agent guide; these correspond to the underscore names proposed by the plan.

Each script supports `--limit 1` for a pilot, `--model <alias>` for one candidate,
`--mode json_schema|json_object`, and `--tag <name>` for a separate experiment.
The default is `json_schema`, with thinking disabled. `--default-thinking`
omits that optional chat-template override; it was used for the final GLM
availability probe. Rerunning an unchanged protocol resumes the
remaining fixtures without duplicating recorded requests. Recorded failures
remain in the result; use a new tag for a deliberate retry. Protocol or fixture
changes require a new tag. A tag does not reset the shared spend ledger.

Recompute saved scores without a credential or network request:

```sh
uv run python label-eval.py --score-only
uv run python docent-eval.py --score-only
uv run python factsheet-eval.py --score-only
uv run python moderation-eval.py --score-only
```

The scripts serialize requests with a local lock, disable SDK retries, and stop
on an API error. The timeout is 180 seconds; the first GLM pilot used 55 seconds.
`results/budget.json` reserves $1 before every call against a $4.50 ceiling,
then replaces it with the usage-based estimate on success. Unknown billing
after a timeout keeps the full reservation. An initial $0.01 allowance covers
three setup probes. Rates are recorded in `config.json`; token counts include
reasoning tokens in the provider's completion count and assume uncached input.
The ledger is a conservative local estimate, not the provider's invoice or a
cap on other clients using the same account. Do not delete it to resume this
spike. The $0.50 margin and per-call reservation protect the plan's $5 budget
at the recorded rates and bounded fixture sizes.

## Evaluation contracts

- **Labels:** 25 distinct photos, one request per model per photo. The system
  prompt is verbatim from the plan. Input is a JPEG data URL and the schema.
  `labels/manifest.json` records every accepted field value, attribution,
  license link, source URL, download URL and SHA-256. Ground truth was manually
  transcribed by the executing agent before the candidate runs; it has not
  received independent human review. Case, whitespace, curly apostrophes and
  dash style are normalized. Explicit variants cover birth prefixes, some
  abbreviated date ranges and printed subtitles. Other differences count as
  errors, including added dates in titles and acquisition years as accessions.
  Report both field accuracy and the stricter rate of getting title and artist
  correct together. Also separate printed-field accuracy from null handling.
- **Docent:** 20 hand-authored fictional fact sheets with eight facts each,
  three identical requests per model at temperature 0. These fictional works
  test adherence to the input independently of memorized art knowledge.
  A sentence is dropped if any citation ID is missing or unknown. Determinism
  requires all three valid JSON responses to be equal after canonicalizing
  object keys; sentence order and wording remain significant. Sentence-count
  compliance (three or four) is measured separately from JSON validity.
- **Fact sheets:** five real Met paintings, each with owner metadata fetched
  through the Met API, a Wikidata snapshot, and five live web-search snippets.
  The Tavily connector could not authenticate; the built-in web search supplied
  the snippets. This spike does not measure Tavily behavior. Search was limited
  to the owner's domain, with some thin or off-topic snippets retained to test
  source selection. Scores are explicit trust inputs, not search relevance.
  Automated scoring checks exact URL membership. Semantic support and correct
  source assignment require the separate review recorded with the results.
- **Moderation:** 20 synthetic cases, ten flagged and ten benign, under the
  explicit policy in `prompts/moderation.txt`. Contact details, identifiers and
  credentials in this fixture are fictional. Report sensitive-case recall and
  benign-case specificity separately.

All suites reject malformed or schema-invalid JSON without stripping markdown,
extracting a substring, coercing fields or repairing output. Confidence numbers
are model claims; this spike does not calibrate them. Valid citations and valid
JSON do not establish factual correctness.

## Label image licensing and sample limits

The 25 photographs retain the individual Creative Commons licenses linked in
`labels/manifest.json`; the repository's MIT license does not relicense them.
Attribution is to Marshall Astor (11), Jim.henderson (2), Another Believer (9),
and Elliott Brown (3). Files are original downloads or Wikimedia-generated
thumbnails up to 1280 pixels wide, with no local editing.

This is a convenience sample of six painting labels and nineteen labels for
other objects (sculpture, prints, a photograph, furniture and costume). It
includes English, Spanish and bilingual labels, small text and perspective,
but is not a representative painting-only museum benchmark. Excluded photos
were exhibition introductions or named multiple works. These are evaluation
assets; none are imported into the app or its index.
