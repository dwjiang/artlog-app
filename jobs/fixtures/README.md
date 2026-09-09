# Test fixtures

- `test-painting.jpg` — Vincent van Gogh, *Wheat Field with Cypresses* (1889),
  The Metropolitan Museum of Art, accession 1993.132, Met object 436535
  (<https://www.metmuseum.org/art/collection/search/436535>). Open Access,
  CC0 1.0. Re-encoded from the Met's `web-large` rendition (599×477, JPEG
  quality 92) to stay under 200 KB. It seeds `shared/fixtures/orb-features-v1.json`;
  regenerate that file with
  `uv run python -m artlog_jobs.orb fixtures/test-painting.jpg ../shared/fixtures/orb-features-v1.json`
  whenever the letterbox, the ORB parameters or the pinned OpenCV version change.
