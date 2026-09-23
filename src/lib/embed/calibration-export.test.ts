import { collectCalibrationEmbeddings, parseCalibrationUrls } from "./calibration-export";

function steps(urls: string[]) {
  let clock = 0;
  return {
    urls: jest.fn().mockResolvedValue(urls),
    download: jest.fn(async (url: string, index: number) => `/cache/${index}.jpg`),
    letterbox: jest.fn(async (path: string) => `file://${path}.crop.jpg`),
    embed: jest.fn(async (cropUri: string) => Float32Array.of(cropUri.length, 0.5)),
    now: jest.fn(() => {
      clock += 10;
      return clock;
    }),
  };
}

it("downloads, letterboxes and embeds every URL in order and keys the vectors by URL", async () => {
  const urls = ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"];
  const calibration = steps(urls);
  const progress = jest.fn();
  const result = await collectCalibrationEmbeddings(calibration, progress);
  expect(calibration.download.mock.calls).toEqual([
    [urls[0], 0],
    [urls[1], 1],
    [urls[2], 2],
  ]);
  expect(calibration.letterbox.mock.calls).toEqual([
    ["/cache/0.jpg"],
    ["/cache/1.jpg"],
    ["/cache/2.jpg"],
  ]);
  expect(calibration.embed.mock.calls).toEqual([
    ["file:///cache/0.jpg.crop.jpg"],
    ["file:///cache/1.jpg.crop.jpg"],
    ["file:///cache/2.jpg.crop.jpg"],
  ]);
  expect(Object.keys(result.embeddings)).toEqual(urls);
  expect(result.embeddings[urls[0]]).toEqual([28, 0.5]);
  expect(result.embedMedianMs).toBe(10);
  expect(progress.mock.calls).toEqual([
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});

it("parses the URL list ignoring blank lines and surrounding whitespace", () => {
  expect(parseCalibrationUrls(" https://a/1.jpg \n\nhttps://a/2.jpg\n")).toEqual([
    "https://a/1.jpg",
    "https://a/2.jpg",
  ]);
});

it("rejects an empty or duplicated URL list before downloading anything", async () => {
  const empty = steps([]);
  await expect(collectCalibrationEmbeddings(empty)).rejects.toThrow("empty");
  const duplicated = steps(["https://a/1.jpg", "https://a/1.jpg"]);
  await expect(collectCalibrationEmbeddings(duplicated)).rejects.toThrow("duplicates");
  expect(empty.download).not.toHaveBeenCalled();
  expect(duplicated.download).not.toHaveBeenCalled();
});
