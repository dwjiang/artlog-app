import model from '../../../shared/model/model-version.json';

import type { CoremlEmbed } from '../../../modules/coreml-embed/src';
import { createEmbedder } from './embedder';

function fakeNative(overrides: Partial<CoremlEmbed> = {}) {
  return {
    modelVersion: model.modelVersion,
    inputSize: model.inputSize,
    embeddingDim: model.embeddingDim,
    weightsSha256: 'weights',
    warmUp: jest.fn().mockResolvedValue({ loadMs: 4100, predictMs: 66, alreadyLoaded: false }),
    embed: jest.fn().mockResolvedValue(Array.from({ length: model.embeddingDim }, (_, i) => (i === 0 ? 1 : 0))),
    ...overrides,
  };
}

it('embeds the crop file path and returns a typed array of the model dimension', async () => {
  const native = fakeNative();
  const embedder = createEmbedder(() => native);
  const vector = await embedder.embed('file:///tmp/crops/a%20b.jpg');
  expect(native.embed).toHaveBeenCalledWith('/tmp/crops/a b.jpg');
  expect(vector).toBeInstanceOf(Float32Array);
  expect(vector).toHaveLength(model.embeddingDim);
  expect(vector[0]).toBe(1);
  expect(embedder.modelVersion).toBe(model.modelVersion);
  expect(native.warmUp).not.toHaveBeenCalled();
});

it('rejects a bundled model whose version differs from shared/model/model-version.json, naming both', () => {
  const embedder = createEmbedder(() => fakeNative({ modelVersion: 'c-radiov3-b-int8-512-dinov2-v2' }));
  expect(() => embedder.modelVersion).toThrow(
    `Embedding model version mismatch: bundled "c-radiov3-b-int8-512-dinov2-v2", expected "${model.modelVersion}"`,
  );
});

it('explains a build without the model asset', async () => {
  const embedder = createEmbedder(() => fakeNative({ modelVersion: null }));
  await expect(embedder.embed('file:///tmp/crop.jpg')).rejects.toThrow('npm run model:fetch');
});

it('rejects warm-up without throwing synchronously when the model asset is missing', async () => {
  const embedder = createEmbedder(() => fakeNative({ modelVersion: null }));
  await expect(embedder.warmUp()).rejects.toThrow('npm run model:fetch');
});

it('rejects warm-up when the native module is missing and allows a later retry', async () => {
  const native = fakeNative();
  const loadNative = jest.fn()
    .mockImplementationOnce(() => { throw new Error('Native module unavailable'); })
    .mockReturnValue(native);
  const embedder = createEmbedder(loadNative);
  await expect(embedder.warmUp()).rejects.toThrow('Native module unavailable');
  await expect(embedder.warmUp()).resolves.toEqual({ loadMs: 4100, predictMs: 66, alreadyLoaded: false });
  expect(native.warmUp).toHaveBeenCalledTimes(1);
});

it('rejects warm-up for a mismatched model version before calling the native model', async () => {
  const native = fakeNative({ modelVersion: 'wrong-version' });
  const embedder = createEmbedder(() => native);
  await expect(embedder.warmUp()).rejects.toThrow('Embedding model version mismatch');
  expect(native.warmUp).not.toHaveBeenCalled();
});

it('warms up once for concurrent callers and again after a failure', async () => {
  const warmUp = jest.fn()
    .mockRejectedValueOnce(new Error('Neural Engine unavailable'))
    .mockResolvedValue({ loadMs: 4100, predictMs: 66, alreadyLoaded: false });
  const embedder = createEmbedder(() => fakeNative({ warmUp }));
  await expect(embedder.warmUp()).rejects.toThrow('Neural Engine unavailable');
  const [first, second] = await Promise.all([embedder.warmUp(), embedder.warmUp()]);
  expect(first).toBe(second);
  await embedder.warmUp();
  expect(warmUp).toHaveBeenCalledTimes(2);
});

it('rejects an embedding of the wrong length', async () => {
  const embedder = createEmbedder(() => fakeNative({ embed: jest.fn().mockResolvedValue([1, 2, 3]) }));
  await expect(embedder.embed('file:///tmp/crop.jpg')).rejects.toThrow(`3 values, expected ${model.embeddingDim}`);
});
