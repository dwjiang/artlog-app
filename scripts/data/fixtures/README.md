# Test fixtures

- `factsheet-schema.json` and `docent-schema.json` — the response contracts the
  enrichment job and the Token Factory evaluations share. Enrichment tests compare
  the current Python schemas with them; the live fact-sheet schema additionally
  limits `source` to the ids of the sources sent.

- `met-sample.csv`, `met-images-sample.json`, `aic-sample.json`, and
  `wikidata-artworks-sample.json` — synthetic corpus metadata using
  the published source field names. Names, accession values, and object/image
  IDs in these four fixtures are invented, not institutional assertions.
  They cover painting filters, missing images, rights revocation and ambiguity,
  owner/location differences, accession qualifiers, duplicate SPARQL bindings,
  and series/version identity. No images are included or fetched by these tests.

- `cma-sample.json` — synthetic Cleveland Open Access page (invented values, live field names); covers type, CC0, image and outdoor-location filters.
- `fng-sample.json` — synthetic Finnish National Gallery dump rows (invented values, live field names); covers organisation, category, CC0 and exhibition-date rules.

- `wikidata-iceland.json` — saved WDQS response on 2026-09-09, with the query
  included. The 35 distinct Icelandic museums/gallery venues have coordinates
  and websites. Wikidata structured data is CC0; this fixture tests parsing,
  Unicode names, coordinates, and duplicate collapse without live requests.

- `test-painting.jpg` — Vincent van Gogh, _Wheat Field with Cypresses_ (1889),
  The Metropolitan Museum of Art, accession 1993.132, Met object 436535
  (<https://www.metmuseum.org/art/collection/search/436535>). Open Access,
  CC0 1.0. Re-encoded from the Met's `web-large` rendition (599×477, JPEG
  quality 92) to stay under 200 KB. It seeds `shared/orb/fixtures/orb-features-v1.json`;
  regenerate that file with
  `uv run python -m pipeline.orb fixtures/test-painting.jpg ../../shared/orb/fixtures/orb-features-v1.json`
  whenever the letterbox, the ORB parameters or the pinned OpenCV version change.
