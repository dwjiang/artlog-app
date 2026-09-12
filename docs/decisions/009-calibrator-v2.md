# 009 — Calibrator v2 training

Date: 2026-09-11. Status: **pipeline implemented; real fit and adoption pending**.
Implements [plan 02.09](../plans/02-index-build/09-calibrator-training.md).

The sampler, Python feature/ORB pipeline, balanced logistic fit, threshold gates,
report and internal Convex exports are implemented. The ten-row Python-generated
fixture passes the TypeScript feature test. The job follows the current runtime
budgets (32 vector hits → at most 20 canonical objects → 10 ORB verifications),
rather than training with verification signals unavailable to the app.
Commands, simulated context priors and artifact formats are in
[jobs/README.md](../../jobs/README.md#calibrator-training-0209).

The real run is blocked by the 02.05 import. Live checks against dev
`usable-owl-256` on 2026-09-11 returned **0 vectors and 0 descriptors**.
The sampler exited nonzero with:

```text
no indexed vectors for c-radiov3-b-int8-512-dinov2-v1; finish plan 02.05 first
```

No real held-out precision, recall or AUC is available. There is no
corpus-trained `calibrator-lr-v2.json` to attach to this record.
`CALIBRATOR_V1` remains the default; human adoption is pending.

As a software check only, the CLI fit 480 synthetic candidate rows from 60
source objects, holding out 12 objects / 48 queries / 96 rows. AUC was 1.0;
all 48 held-out winners were correct and confident, giving precision and
recall 1.0. Its JSON and report are gitignored under `jobs/out/synthetic/`.
Those coefficients are test output and must not be adopted. Twenty real-image
augmentation previews were visually checked under `jobs/out/augment-samples/`.

The fit uses train-only standardization folded into plain dot-product weights.
Threshold selection counts tied probabilities together, uses only each query's
winner, applies hard rules, and includes retrieval failures in the recall
denominator. AUC < 0.9 or unreachable precision/recall targets write diagnostics
without an installable artifact. The v1 rule constants remain unchanged; the
report includes the requested nine-way sweep. Thresholds are selected on the
holdout, so reported figures are tuning estimates. Museum-photo evaluation
remains deferred by the plan.

After the full import: run the default 5,000-object sampler and trainer, inspect
the report, then replace this pending record with real dataset counts, metrics
and the emitted JSON code block before proposing adoption.

Verification: all 395 Python tests pass (43 new calibrator tests); Ruff and
format checks pass. The focused TypeScript export/parity run passes all 29 tests.
The full backend run had 841 passes, 3 skips and one unrelated 20-second timeout
in the large promotion stress test; that test passed on an isolated rerun in
10.68 seconds. Root TypeScript, ESLint, Convex codegen and the dev push pass;
generated output was already current. Live vector/descriptor exports were
exercised with the configured Python admin client. No iOS walkthrough was run
because this task adds offline training and admin exports, with no app behavior
change.
