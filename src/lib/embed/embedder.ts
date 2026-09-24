import { reportError } from "@/lib/observability";
import model from "../../../shared/model/model-version.json";

import { getCoremlEmbed } from "../../../modules/coreml-embed/src";
import type {
  CoremlEmbed,
  WarmUpResult,
} from "../../../modules/coreml-embed/src";
import type { Embedder } from "@/lib/capture/stages";
import { filePath } from "@/lib/file-uri";

export type ModelEmbedder = Embedder & { warmUp(): Promise<WarmUpResult> };

/**
 * The capture pipeline's `Embedder` over the native module. The bundled model version is checked
 * against `shared/model/model-version.json` on first use, so a stale asset fails loudly instead of
 * producing vectors the index cannot match.
 */
export function createEmbedder(
  native: () => CoremlEmbed = getCoremlEmbed,
): ModelEmbedder {
  let checked: CoremlEmbed | undefined;
  let warming: Promise<WarmUpResult> | undefined;

  function nativeModule(): CoremlEmbed {
    if (checked) return checked;
    const candidate = native();
    if (candidate.modelVersion === null) {
      throw new Error(
        "The CoreML model asset is missing from this build; run `git lfs pull` and rebuild",
      );
    }
    if (candidate.modelVersion !== model.modelVersion) {
      throw new Error(
        `Embedding model version mismatch: bundled "${candidate.modelVersion}", expected "${model.modelVersion}"`,
      );
    }
    checked = candidate;
    return candidate;
  }

  return {
    get modelVersion() {
      nativeModule();
      return model.modelVersion;
    },
    warmUp() {
      warming ??= Promise.resolve()
        .then(() => nativeModule().warmUp())
        .catch((error: unknown) => {
          warming = undefined;
          throw error;
        });
      return warming;
    },
    async embed(cropUri) {
      const values = await nativeModule().embed(filePath(cropUri));
      if (values.length !== model.embeddingDim) {
        throw new Error(
          `The embedding has ${values.length} values, expected ${model.embeddingDim}`,
        );
      }
      return Float32Array.from(values);
    },
  };
}

export const embedder = createEmbedder();

/** Starts loading the model at launch so the first capture does not wait for it. */
export function warmUpEmbedder(): void {
  embedder.warmUp().then(
    (result) => {
      if (__DEV__) console.debug("Embedding model ready", result);
    },
    (error: unknown) => {
      reportError(error, "embedding.warm_up");
      console.warn("Embedding model warm-up failed", error);
    },
  );
}
