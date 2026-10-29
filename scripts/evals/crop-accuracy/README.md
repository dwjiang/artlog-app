# Crop accuracy evaluation

Scores the app's scan crops against where each painting really is in the photo, for each capture path, with and
without snapping a recognized crop to its catalogue image. See the
[findings](../../../docs/experiments/README.md#crop-accuracy).

## Inputs

A photo set directory holding `photos.jsonl` and `photos/`: camera photos of catalogued paintings, each row naming its
`photo` file and the Commons `referenceFiles` the corpus indexed. The real-photo calibrator set in Artlog Data
(`jobs/out/real-photo-eval-2026-10-03/`) has this layout. Outputs go to an eval directory outside the repository.

## Run

Compile the [vision-rect Mac harness](../../../modules/vision-rect/scripts/mac-harness.swift) with the command in its
header, then from this directory, with `uv` and the repository's `node_modules` installed:

```sh
PHOTOS="$HOME/Documents/Artlog Data/jobs/out/real-photo-eval-2026-10-03"
OUT="$HOME/Documents/Artlog Data/jobs/out/crop-accuracy-eval"
uv run python fetch_references.py --photos "$PHOTOS" --out "$OUT"
uv run python ground_truth.py --photos "$PHOTOS" --out "$OUT"
uv run python crops.py --photos "$PHOTOS" --out "$OUT" --harness /tmp/vision-rect-harness
uv run python score.py --out "$OUT"
uv run pytest -q
```

`fetch_references.py` and `ground_truth.py` resume where they stopped. Rerun `crops.py` and `score.py` after changing
crop selection or snapping; they load the app's code through `app-crops.mts`.

## Method

- **Ground truth:** SIFT matches between the photo and its full-resolution reference, a MAGSAC homography, and the
  reference's corners projected into the photo. A photo counts only with at least 60 inliers spanning 30% of the
  reference; it is scored only when the whole painting is in the photo.
- **Crops:** Vision's still analysis from the harness, then the app's own choice. `unguided` is the shutter without a
  tracked outline, steady capture and photo imports: `cropQuads` with no tracked quad. `auto` approximates
  auto-capture's outermost rectangle around the photo center. Nested crops that server ranking might pick are not
  scored.
- **Snap:** each crop is warped and letterboxed by the harness, ORB features are extracted as the phone and corpus do,
  then the production `verifyOrb` and `snapToReference` run against the reference's letterboxed features.
- **Verdicts:** `accurate` keeps at least 90% of the painting and is at least 90% painting. `too loose` keeps the
  painting but adds frame, mat or wall; `too tight` cuts the painting; `off` does both.

The reference defines the painting, so a reference photographed with its frame scores frame-inclusive crops as
accurate. Snapping uses the true reference here; in the app it uses whichever match the server verified.
