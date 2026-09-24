export type CalibrationSteps = {
  urls(): Promise<string[]>;
  /** Fetches `url` once and returns its local file path. */
  download(url: string, index: number): Promise<string>;
  /** Letterboxes the whole image to the model input size and returns the crop URI. */
  letterbox(path: string): Promise<string>;
  embed(cropUri: string): Promise<Float32Array>;
  now(): number;
};

export type CalibrationEmbeddings = {
  /** Keyed by source URL: the shape of `scripts/data/calibration/iphone-embeddings.json` the drift check reads. */
  embeddings: Record<string, number[]>;
  embedMedianMs: number;
};

export function parseCalibrationUrls(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function collectCalibrationEmbeddings(
  steps: CalibrationSteps,
  onProgress?: (done: number, total: number) => void,
): Promise<CalibrationEmbeddings> {
  const urls = await steps.urls();
  if (urls.length === 0) throw new Error("The calibration URL list is empty");
  if (new Set(urls).size !== urls.length) {
    throw new Error("The calibration URL list contains duplicates");
  }
  const embeddings: Record<string, number[]> = {};
  const timings: number[] = [];
  for (const [index, url] of urls.entries()) {
    const path = await steps.download(url, index);
    const cropUri = await steps.letterbox(path);
    const started = steps.now();
    const vector = await steps.embed(cropUri);
    timings.push(steps.now() - started);
    embeddings[url] = Array.from(vector);
    onProgress?.(index + 1, urls.length);
  }
  return { embeddings, embedMedianMs: median(timings) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
