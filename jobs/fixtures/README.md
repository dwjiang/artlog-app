# Test fixtures

- `factsheet-schema.json` and `docent-schema.json` — the response contracts used
  in the September 8 Token Factory evaluation. Enrichment tests compare the
  current Python schemas with these retained contracts.

- `met-sample.csv`, `met-images-sample.json`, `aic-sample.json`, and
  `wikidata-paintings-sample.json` — synthetic corpus metadata using
  the published source field names. Names, accession values, and object/image
  IDs in these four fixtures are invented, not institutional assertions.
  They cover painting filters, missing images, rights revocation and ambiguity,
  owner/location differences, accession qualifiers, duplicate SPARQL bindings,
  and series/version identity. No images are included or fetched by these tests.

- `wikidata-iceland.json` — saved WDQS response on 2026-09-09, with the query
  included. The 35 distinct Icelandic museums/gallery venues have coordinates
  and websites. Wikidata structured data is CC0; this fixture tests parsing,
  Unicode names, coordinates, and duplicate collapse without live requests.

- `test-painting.jpg` — Vincent van Gogh, *Wheat Field with Cypresses* (1889),
  The Metropolitan Museum of Art, accession 1993.132, Met object 436535
  (<https://www.metmuseum.org/art/collection/search/436535>). Open Access,
  CC0 1.0. Re-encoded from the Met's `web-large` rendition (599×477, JPEG
  quality 92) to stay under 200 KB. It seeds `shared/orb/fixtures/orb-features-v1.json`;
  regenerate that file with
  `uv run python -m artlog_jobs.orb fixtures/test-painting.jpg ../shared/orb/fixtures/orb-features-v1.json`
  whenever the letterbox, the ORB parameters or the pinned OpenCV version change.
