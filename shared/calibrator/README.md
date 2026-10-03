# Calibrator training output

The match calibrator (`convex/lib/calibrator/`) is a logistic regression over the fixed
feature vector produced by `featurize()`. Its weights ship as `DEFAULT_CALIBRATOR` in
`convex/lib/calibrator/weights.ts`, currently `lr-v4`, trained on 3,643 paintings against the
full corpus package and checked on real gallery photos. Its evaluation is recorded in
[calibrator findings](../../docs/experiments/README.md#calibrator-v2).

## What the training job must emit

One JSON document shaped exactly like `CalibratorConfig`:

```json
{
  "version": "lr-v4",
  "featureNames": [
    "similarity",
    "margin",
    "atVenue",
    "gallerySame",
    "galleryDifferent",
    "onView",
    "logKeypointCount",
    "logInliers",
    "homographyValid",
    "objectPenalty",
    "venueKnown",
    "inlierLead"
  ],
  "weights": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "bias": 0,
  "thresholds": { "confident": 0.85, "soft": 0.45 },
  "lowTextureKeypoints": 80,
  "textured": { "minInliers": 15 },
  "lowTexture": {
    "minSimilarity": 0.8,
    "minMargin": 0.08,
    "requireVenueAgreement": true
  }
}
```

- `featureNames` must equal `FEATURE_NAMES` in `convex/lib/calibrator/features.ts`, in that
  order, and `weights[i]` is the coefficient for `featureNames[i]`. Train on the same
  transforms `featurize()` applies (clamped similarity, `max(0, margin)`, `log1p` counts,
  0/1 booleans, unknown gallery and unknown on-view as 0, and `inlierLead` as the signed
  `log1p(inliers) - log1p(runnerUpInliers)`).
- `thresholds` and the rule constants are part of the artifact: retraining may move them.
- Bump `version` (`lr-vN`) on every retrain.

## How it gets adopted

A human replaces the `DEFAULT_CALIBRATOR` literal in `weights.ts` with the document.
`weights.test.ts` fails if `featureNames` drifts from `FEATURE_NAMES` or the weight count
changes. Adding a feature means appending to
`FEATURE_NAMES`, retraining, and bumping the version; stored feedback rows record the
version they were scored with.
