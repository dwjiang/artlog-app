# Plan 03.03: The CoreML embedding module — ship C-RADIOv3-B in the app and embed every crop on the Neural Engine

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- modules/coreml-embed scripts/model src/lib/embed package.json .gitignore`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (native + a 90 MB asset in the build pipeline)
- **Depends on**: 03.01, `docs/decisions/001-embedding-model-export.md` (export recipe, sizes, latency), `docs/decisions/006-native-modules.md` (`.mlmodelc` bundling confirmed)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.1: "The embedding model ships in the app… ~90 MB in the binary (whole app under 200 MB)"; §4.1 step 2: embed on the phone with the DINOv2-adaptor summary; the phone's `modelVersion` travels with every request (§5.4). Without this module nothing can be identified.

## Current state

- Spike 00.01 produced `spikes/coreml-export/export.py` and the decision (`inputSize`, int8 per-channel weights, fp16 compute, `modelVersion`, output name). `shared/model-version.json` matches it.
- `src/lib/capture/stages.ts` defines `Embedder { embed(cropUri): Promise<Float32Array>; modelVersion }`; `default-stages.ts` has a throwing stub.
- Verified facts: CocoaPods resources are not compiled by Xcode → precompile with `xcrun coremlcompiler compile Model.mlpackage <dir>` and ship the `.mlmodelc` directory via the module podspec `s.resources`; load with `Bundle(for: EmbedModule.self).url(forResource: "CRadioV3B", withExtension: "mlmodelc")`, `MLModelConfiguration().computeUnits = .all`; input `CVPixelBuffer` (BGRA/RGB at `S×S`) named per the export's `ImageType`; output `MLMultiArray` of 1536 floats. EAS: archives up to 2 GB; Git LFS files are not fetched by GitHub-triggered builds → **do not commit the model**; fetch it at build time.
- Expo local module scaffolding: `npx create-expo-module@latest coreml-embed --local --platform apple --features AsyncFunction Constant`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Export | `cd scripts/model && uv run python export_coreml.py --out out/` | `out/CRadioV3B.mlpackage`, `out/fakequant_state.pt`, `out/model-manifest.json` |
| Compile | `xcrun coremlcompiler compile out/CRadioV3B.mlpackage out/compiled/` | `out/compiled/CRadioV3B.mlmodelc/` |
| Fetch (build time) | `npm run model:fetch` | `modules/coreml-embed/ios/Models/CRadioV3B.mlmodelc/` present |
| Rebuild | `npx expo prebuild --platform ios --clean && npx expo run:ios --device` | app runs |
| Tests | `npm run test:app` | pass |

## Scope

**In scope**: `scripts/model/{export_coreml.py,pyproject.toml,README.md}` (productionized from the spike), `scripts/model/fetch-model.sh`, `package.json` (`model:fetch`, `eas-build-pre-install` hook), `.gitignore` (`modules/coreml-embed/ios/Models/`), `modules/coreml-embed/**`, `src/lib/embed/embedder.ts` (+ test), `src/lib/capture/default-stages.ts` (real `embedder`), `src/components/settings/dev-tools.tsx` (dev-only calibration export), `jobs/calibration/` (regenerate the iPhone reference JSON from this module's output).

**Out of scope**: the index build's use of `fakequant_state.pt` (02.04 consumes the artifact), model download-on-demand (§3 deferred).

## Steps

### Step 1: Reproducible export and manifest

`export_coreml.py` (from the spike, cleaned): loads via torch.hub with `adaptor_names=['dino_v2']`, wraps to return the 1536 summary, traces at `inputSize`, converts (ML Program, fp16 compute, `ImageType(scale=1/255)`), quantizes int8 per-channel, saves `.mlpackage`, writes `fakequant_state.pt` and `model-manifest.json` `{ modelVersion, inputSize, embeddingDim, outputName, sha256 of the mlpackage, exportedAt, coremltoolsVersion }`. Assert `modelVersion === shared/model-version.json.modelVersion`.

**Verify**: run produces the three artifacts; the manifest's `modelVersion` matches.

### Step 2: Asset distribution

`fetch-model.sh`: downloads `${MODEL_ASSET_URL:-<GitHub release asset URL>}` (a zip of the compiled `.mlmodelc` + manifest, published by the operator as a GitHub Release asset or an object-storage URL), verifies the manifest sha256, unzips into `modules/coreml-embed/ios/Models/`. `package.json`: `"model:fetch": "bash scripts/model/fetch-model.sh"`, `"eas-build-pre-install": "npm run model:fetch"`. Document the release step in `scripts/model/README.md`.

**Verify**: `npm run model:fetch` on a clean checkout populates the folder; `git status` shows it ignored.

### Step 3: The Expo module

`modules/coreml-embed/ios/CoremlEmbedModule.swift` (DSL): `Name("CoremlEmbed")`; `Constant("modelVersion") { manifest.modelVersion }` (read `model-manifest.json` bundled alongside); `AsyncFunction("warmUp")` loads the model once (thread-safe lazy) and runs one prediction on a black image; `AsyncFunction("embed") { (path: String) -> [Float] }` → `UIImage(contentsOfFile:)` → `CVPixelBuffer` at `S×S` (the crop is already `S×S`; assert or resize) → `model.prediction(from:)` → `MLMultiArray` → `[Float]` (1536) L2-normalized; `AsyncFunction("embedBatch")` optional. Podspec: `s.resources = ['Models/*.mlmodelc', 'Models/model-manifest.json']`. Errors map to `Exceptions` with codes `model_missing`, `bad_input`.

**Verify**: device: `warmUp` ≤ 1.5 s, `embed` median ≤ the 00.01 latency + 30%, result length 1536, norm ≈ 1.

### Step 4: JS wrapper and stage

`src/lib/embed/embedder.ts`: `createEmbedder()` returning `Embedder` that asserts `CoremlEmbed.modelVersion === modelVersion.modelVersion` at startup (throw with both strings otherwise), calls `warmUp()` on app start (from `_layout`), and `embed(cropUri)` → `Float32Array`. `default-stages.ts` uses it.

**Verify**: `embedder.test.ts` with a mocked native module: version mismatch throws; output typed array; warm-up called once.

### Step 5: Calibration export (dev-only)

`dev-tools.tsx` (rendered in Settings only when `__DEV__`): "Export calibration embeddings" downloads `jobs/calibration/urls.txt` (bundled copy), letterboxes each via `VisionRect.warpAndLetterbox(uri, null, S)`, embeds, and shares a JSON `{ url: number[] }` via the share sheet; commit the result as `jobs/calibration/iphone-embeddings.json` (regenerated whenever the export changes).

**Verify**: a fresh reference file is produced and `uv run python -m artlog_jobs.drift_check --reference …` (02.04) passes ≥ 0.99.

## Test plan

`embedder.test.ts` (jest, mocked module); on-device latency and the drift check are the real verification.

## Done criteria

- [ ] Export reproducible; asset fetched by script; model not in git (`git ls-files modules/coreml-embed/ios/Models | wc -l` → 0)
- [ ] Device embed works; latency recorded in the PR; app size after a local archive < 200 MB (note the number)
- [ ] Drift check passes against a fresh reference
- [ ] Tests, tsc, lint pass; `docs/plans/README.md` updated

## STOP conditions

- The compiled `.mlmodelc` does not load from the pod bundle (folder flattened) — try `s.resource_bundles`; if still failing, report.
- App archive exceeds 200 MB — report; options (4-bit palettization, downloadable asset) are the operator's.

## Maintenance notes

- Any new export = new `modelVersion` = index migration (02.08). The version assertion in `embedder.ts` is what prevents a silent mismatch.
