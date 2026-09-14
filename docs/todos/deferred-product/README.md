# Deferred product work

These items are retained for future prioritization; none is scheduled or required
for the current release. [Hub scoring](../hub-scoring/README.md) and the
[full corpus upload](../production-upload/README.md) have separate todos.

1. **Evaluate recognition on real museum photos.** Build a golden set across
   venues, including difficult captures and unknown works. Replay it against new
   indexes, embedding models, and calibrators; report precision, recall, false
   confident matches, and latency. Add shadow comparisons for calibrator changes.
   The existing [calibrator tooling](../../../scripts/data/pipeline/calibrator/) covers
   augmented corpus evaluation; it does not replace a real-photo evaluation set.
   Keep retrains manual and reviewed until the evaluation can support a release
   gate. Preserve resolved wrong/right matches as possible hard negatives.
2. **Define retention and deletion.** Decide how long scans, feedback,
   venue-derived data, and consented contribution crops should persist; specify
   user deletion and withdrawal effects on shared and derived data. Existing
   withdrawal, takedown, and opt-out code does not by itself define a retention
   policy. Align the eventual product copy and cleanup behavior with the decision.
3. **Prepare for embedding-model changes.** When a new model is chosen, rebuild
   the index with the same numerical behavior as the phone and measure drift.
   Use original source image references or consented contribution crops to
   re-embed; report unavailable images instead of inventing replacement vectors.
   Decide how feedback-derived alternate views are regenerated. A dedicated
   re-embedding job is not implemented. For this pre-release app, replace the
   model, index, and callers directly; overlapping versions, adoption thresholds,
   and compatibility migrations are not requirements. Compatibility-loss training
   and downloading model assets at runtime remain separate research options if
   a future product need justifies them. The current asset is fetched during
   development/build setup and bundled in the app; see the
   [model workflow](../../../scripts/model/README.md).
4. **Recompute contribution features on the server before promotion.** The
   current promotion flow uses phone-supplied vectors and descriptors. Derive
   trusted replacements from the consented crop before making a contribution
   public; retain the existing evidence, agreement, and abuse checks. Measure
   whether the stored crop has enough detail to reproduce useful features before
   choosing the execution service or changing the capture contract. A particular
   cloud job platform is not required.
5. **Improve trust scoring when there is evidence to use.** Explore richer device
   reputation beyond the current new-device/confirmed-device weights. Define
   measurable abuse cases, recovery, and bounded influence before introducing
   more scoring complexity; independent-device agreement must remain meaningful.

## Stretch ideas

- **Offline venue bundles:** download a venue's vectors and descriptors and match
  locally, extending the existing on-device embedding and reconnect queue.
- **Confusion pairs:** for recurring visually similar wrong/right pairs, offer a
  focused “Which of these two?” choice and evaluate whether it reduces mistakes.
