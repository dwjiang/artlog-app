import { requireOptionalNativeModule } from "expo";

export type WarmUpResult = {
  loadMs: number;
  predictMs: number;
  alreadyLoaded: boolean;
};

export interface CoremlEmbed {
  /** `null` when the model asset was not bundled: run `git lfs pull` before building. */
  readonly modelVersion: string | null;
  readonly inputSize: number | null;
  readonly embeddingDim: number | null;
  readonly weightsSha256: string | null;
  /** Loads the model if needed and runs one prediction on a black image. */
  warmUp(): Promise<WarmUpResult>;
  /** Embeds an upright `inputSize`×`inputSize` crop file (a path, not a URI); L2-normalized. */
  embed(path: string): Promise<number[]>;
}

let instance: CoremlEmbed | null | undefined;

export function getCoremlEmbed(): CoremlEmbed {
  instance ??= requireOptionalNativeModule<CoremlEmbed>("CoremlEmbed");
  if (!instance) {
    throw new Error(
      "The CoremlEmbed native module is unavailable; rebuild the dev client",
    );
  }
  return instance;
}
