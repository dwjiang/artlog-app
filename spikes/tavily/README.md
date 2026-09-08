# Tavily behavior spike (00.07)

Decision and all six findings: [007-tavily.md](../../docs/decisions/007-tavily.md).
The checked-in run contains 71 requests and **65 response-reported credits**.
The usage endpoint did not reflect that spend; preserve both forms of evidence.

From the repository root, run local checks without any key or network calls:

```sh
uv run --locked --project spikes/tavily pytest spikes/tavily -q
uv run --locked --project spikes/tavily ruff check spikes/tavily
uv run --locked --project spikes/tavily ruff format --check spikes/tavily
uv run --locked --project spikes/tavily python spikes/tavily/summarize.py
```

The scripts read `TAVILY_API_KEY` only from the process environment. The user
may set it in the gitignored repository `.env.local`; `uv --env-file` imports
it without putting the value in a command or generated result. Dependencies
are isolated here with `uv.lock`; the Expo application's packages are unchanged.

```sh
uv run --locked --project spikes/tavily --env-file .env.local python spikes/tavily/right-now-eval.py
uv run --locked --project spikes/tavily --env-file .env.local python spikes/tavily/verify-eval.py
uv run --locked --project spikes/tavily --env-file .env.local python spikes/tavily/map-eval.py
```

These commands **reuse the committed responses**, making no repeat Tavily calls.
The final Map case intentionally exits with the recorded strict-host STOP:
`shop.clevelandart.org` was returned from a `www.clevelandart.org` starting URL.
No additional mapping is permitted in this run. A future independent study
needs a fresh, explicitly budgeted results directory and its own usage snapshot;
do not delete this evidence to reset the counter.

For the original run, `usage-before.json` was captured by a read-only authenticated
`GET https://api.tavily.com/usage` before the harness was created. The equivalent
command, when starting a fresh run, is:

```sh
uv run --locked --project spikes/tavily --env-file .env.local python spikes/tavily/usage-snapshot.py before
```

Use `after` once after the run; `recheck` permits one separately preserved
follow-up. Existing snapshots are never overwritten. Calls are sequential;
an exclusive process lock protects the shared 300-credit budget. Each request
reserves its maximum cost on disk before dispatch. Timeouts/errors keep that
reservation and stop, with no automatic retry or SDK exception body recorded.
Unexpected credit reports preserve possible spend and remain unresolved on
replay until usage is reconciled.
Search explicitly disables auto parameters and uses basic depth. Map caps at
2,000 pages, Crawl at 20. Console output shows the cumulative budget total.

`results/*-*.json` contain request context and raw API responses; `reviews.json`
contains qualitative agent ratings, not independent human or model-judge scores.
`summary.json` is derived and can be regenerated without a key. Exact names,
title/artist/museum triples, and domain lists are in the scripts/config.

`image-probes.json` records the first top-level image URL from each verification
response. The spot-check used sequential `requests.get` calls (15-second
timeout, one-second spacing, `artlog-tavily-spike/0.1` identified User-Agent),
recorded HTTP/MIME/hash information, and visually inspected each downloaded
image in `.context/tavily-images/`. Tate required checking the JPEG signature
because its MIME type was `application/octet-stream`. Image bitmaps and
tracking URLs were not added to the repository or followed indiscriminately.
