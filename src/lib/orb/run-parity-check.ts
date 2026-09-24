import { Asset } from "expo-asset";
import * as Device from "expo-device";

import { measureCrop, type TriageMetrics } from "@/lib/capture/triage";
import fixture from "@/shared/orb/fixtures/orb-features-v1.json";

import { extractOrb } from "./extract";
import { compareDescriptors, decodeBase64, type OrbParity } from "./parity";

export type OrbParityReport = OrbParity & TriageMetrics & { extractMs: number; triageMs: number; device: string };

/**
 * Dev-only tripwire for the phone ↔ Python ORB contract: extracts from the Python letterbox fixture
 * PNG and compares descriptor rows with `shared/orb/fixtures/orb-features-v1.json`, which
 * `scripts/data/pipeline/orb.py` wrote from the same pixels. Triage metrics on the same crop calibrate
 * the thresholds against Python's numbers.
 */
export async function runOrbParityCheck(): Promise<OrbParityReport> {
  const asset = await Asset.fromModule(
    require("../../../shared/model/fixtures/letterbox/test-painting-512.png"),
  ).downloadAsync();
  if (!asset.localUri) throw new Error("The ORB parity fixture is not bundled");
  const extractStarted = performance.now();
  const features = await extractOrb(asset.localUri);
  const extractMs = performance.now() - extractStarted;
  const triageStarted = performance.now();
  const metrics = await measureCrop(asset.localUri);
  const triageMs = performance.now() - triageStarted;
  const report: OrbParityReport = {
    ...compareDescriptors(features.descriptors, decodeBase64(fixture.descriptorsBase64)),
    ...metrics,
    extractMs,
    triageMs,
    device: Device.modelId ?? Device.modelName ?? "unknown",
  };
  console.debug("ORB parity", report);
  return report;
}
