import { ConvexError } from "convex/values";

import model from "../../shared/model/model-version.json";
import { env } from "../_generated/server";

export function supportedModelVersions(): string[] {
  const configured: string | undefined = env.SUPPORTED_MODEL_VERSIONS;
  return configured === undefined
    ? [model.modelVersion]
    : [
        ...new Set(
          configured
            .split(",")
            .map((version) => version.trim())
            .filter(Boolean),
        ),
      ];
}

export function isSupported(version: string): boolean {
  return supportedModelVersions().includes(version);
}

export function expectedDim(): number {
  return model.embeddingDim;
}

export function validateVector(vector: number[]): void {
  if (vector.length !== expectedDim() || !vector.every(Number.isFinite) || !vector.some((value) => value !== 0)) {
    throw new ConvexError({ code: "bad_vector" });
  }
}
