# Data-source spike 00.05

Findings and downstream decisions: [005-data-sources.md](../../docs/decisions/005-data-sources.md).
This directory contains bounded, read-only probes; none writes to Convex.
Python source names use kebab case per the project guide, replacing the
snake-case script names suggested in the plan.

## Reproduce

From this directory, with `uv` installed:

```sh
uv sync --locked
uv run pytest -q
uv run python wikidata-counts.py
uv run python met-counts.py
uv run python aic-counts.py
uv run python venues-probe.py
uv run python replacement-probe.py
uv run python thumbnails.py
uv run python ios-thumbnails.py
```

The last command requires Xcode and exactly one booted iOS simulator; it builds
and installs `app.artlog.spike005`, a disposable native probe, then copies its
JSON result here. It makes sequential image GETs with URLSession, an identified
app User-Agent, no Referer, and an ephemeral cache. It does not edit the Expo app.
Its screenshot and build products go in `.context/data-sources/` at the repo root.
Physical-device and other-network behavior remain unverified.

Run the commands sequentially so separate processes do not accidentally share
a host's rate budget. Defaults are one request every 1.1 seconds per host
(2 seconds for SPARQL), with longer robots delays honored. A 429 stops further
requests to that host for the run. There are no automatic HTTP retries or
automatic redirects in the policy probe. Only the two robots requests compare
the bot and browser UAs; a browser response never unlocks content access.

`ARTLOG_PROBE_USER_AGENT` optionally overrides the identified Python UA. Its
default points to the project's GitHub URL; configure a maintained public
contact before a full build. No credentials or `.env` entries are required.

The Met probe downloads a ~318 MB CSV to `.context/data-sources/`, records its
source URL and SHA-256, and samples at most 100 API objects (default 30, seed 5).
The CSV stays outside Git. To use a fresh snapshot, pass a new path via `--csv`;
an existing path intentionally reuses that exact local CSV. The live API sample
is a separate observation and may differ from the CSV snapshot.

`wikidata-counts.py --venues-only` preserves painting observations and retries
the two venue class queries. The result records the original global timeout
and the deduplicated union of the successful class slices. Painting counts
use `COUNT(DISTINCT ?item)` so images, creators, and collection statements do not
multiply works. A failed full painting count is followed by two bounded creator
slices; if both fail, the script stops painting queries and reports unknown.
It never invents a dump estimate or downloads the whole Wikidata dump.

`venues-probe.py` fetches policy metadata only, with **zero object pages**.
Terms decisions were reviewed separately and are documented with links in the
decision record. Disallowed/unknown sites stay disabled. The replacement probe
checks two Cleveland sitemap children, one object page, and one API listing
limited to one artwork. Its exact observed counts are in `results/replacement.json`.

## Evidence and limits

Results contain request URLs/queries, UTC timestamps, selected response
headers, status codes, counts, and body hashes. Failed checks are preserved.
A 404 policy endpoint is not a permission grant; HTML returned with 200 is
not accepted as robots, TDM JSON, or a sitemap. Absence of a TDM signal on a
policy endpoint does not prove absence on unvisited object pages.

Tests cover count boundaries, robots errors and path matching, sitemap
classification, interrupted rate-limit responses, cached CSV reuse, and failed
type discovery without network access. Both venue probes share robots-response
validation. The source
score configuration is in `jobs/config/source-scores.json`; plan 02.06 creates
`jobs/config/venues.seed.json` from the decision table after rechecking policy.

The Met email is [drafted](met-inquiry.md), not sent. The contact log is
`results/contacts.json`; do not describe it as an unanswered sent inquiry.
