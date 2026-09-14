# Calibrator training output

The match calibrator (`convex/lib/calibrator/`) is a logistic regression over the fixed
feature vector produced by `featurize()`. Its weights ship as versioned constants in
`convex/lib/calibrator/weights.ts`; `CALIBRATOR_V2` is the default trained on 5,500
paintings. Its evaluation limits are recorded in
[calibrator findings](../../docs/todos/experiment-findings/README.md#calibrator-v2).

## What the training job must emit

One JSON document shaped exactly like `CalibratorConfig`:

```json
{
  "version": "lr-v2",
  "featureNames": ["similarity", "margin", "logCandidateCount", "atVenue", "gallerySame",
                   "galleryDifferent", "onView", "logKeypointCount", "logInliers",
                   "homographyValid", "objectPenalty"],
  "weights": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "bias": 0,
  "thresholds": { "confident": 0.85, "soft": 0.45 },
  "lowTextureKeypoints": 80,
  "textured": { "minInliers": 15 },
  "lowTexture": { "minSimilarity": 0.93, "minMargin": 0.04, "requireVenueAgreement": true }
}
```

- `featureNames` must equal `FEATURE_NAMES` in `convex/lib/calibrator/features.ts`, in that
  order, and `weights[i]` is the coefficient for `featureNames[i]`. Train on the same
  transforms `featurize()` applies (clamped similarity, `max(0, margin)`, `log1p` counts,
  0/1 booleans, unknown gallery and unknown on-view as 0).
- `thresholds` and the rule constants are part of the artifact: retraining may move them.
- Bump `version` (`lr-vN`) on every retrain.

## How it gets adopted

A human pastes the document into `weights.ts` as `CALIBRATOR_VN` and points
`DEFAULT_CALIBRATOR` at it. `weights.test.ts` fails if `featureNames` drifts from
`FEATURE_NAMES` or the weight count changes. Adding a feature means appending to
`FEATURE_NAMES`, retraining, and bumping the version; stored feedback rows record the
version they were scored with.
