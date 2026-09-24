import { extractOrb } from "@/lib/orb/extract";

import { extractFeatures, orb } from "./features";

jest.mock("@/lib/orb/extract", () => ({ extractOrb: jest.fn() }));

it("regenerates a stored crop with the current embedding and ORB extractor", async () => {
  const cropUri = "file:///stored/crop.jpg";
  const embedding = new Float32Array([0.1234567, -0.7654321]);
  const descriptors = new ArrayBuffer(32);
  const keypoints = new ArrayBuffer(16);
  const embedder = {
    modelVersion: "current",
    embed: jest.fn().mockResolvedValue(embedding),
  };
  jest.mocked(extractOrb).mockResolvedValue({ count: 1, descriptors, keypoints });

  await expect(extractFeatures(cropUri, { embedder, orb })).resolves.toEqual({
    vector: [0.12346, -0.76543],
    descriptors,
    keypoints,
  });
  expect(embedder.embed).toHaveBeenCalledWith(cropUri);
  expect(extractOrb).toHaveBeenCalledWith(cropUri);
});
