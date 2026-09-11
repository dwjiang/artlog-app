import { encodeOrbFeatures } from '@/shared/orb';
import { makeSyntheticPair } from '@/shared/orb/test-fixtures';
import { candidate } from './__fixtures__/search';
import { checkCandidates } from './candidate-check';

const pair = makeSyntheticPair({ count: 120 });
const scan = { vector: [1, 0], ...encodeOrbFeatures(pair.query) };
const options = { inputSize: 512, canContinue: async () => true };
function deps() {
  return {
    download: jest.fn(async (url: string) => `file:///cache/${url.split('/').pop()}`),
    letterbox: jest.fn(async (uri: string) => `${uri}.box.jpg`),
    embed: jest.fn(async () => Float32Array.from([1, 0])),
    extractOrb: jest.fn(async () => encodeOrbFeatures(pair.ref)),
    remove: jest.fn(),
  };
}
beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('stops at the first passing image and removes its downloaded and letterboxed files', async () => {
  const images = deps();
  expect(await checkCandidates([candidate, candidate], scan, images, options)).toMatchObject({
    sourceUrl: candidate.sourceUrl, imageCheck: { url: candidate.imageUrls[0], cosine: 1, homographyValid: true },
  });
  expect(images.download).toHaveBeenCalledTimes(1);
  expect(images.remove.mock.calls.flat()).toEqual(['file:///cache/blue.jpg', 'file:///cache/blue.jpg.box.jpg']);
});

it('requires cosine ≥ 0.85 before extracting ORB', async () => {
  const images = deps();
  images.embed.mockResolvedValue(Float32Array.from([0.84, Math.sqrt(1 - 0.84 ** 2)]));
  expect(await checkCandidates([candidate], scan, images, options)).toBeNull();
  expect(images.extractOrb).not.toHaveBeenCalled();
  expect(images.remove).toHaveBeenCalledTimes(4);
});

it('rejects a high-cosine image whose homography fails, then checks the next image', async () => {
  const images = deps();
  images.extractOrb.mockResolvedValueOnce(encodeOrbFeatures(makeSyntheticPair({ seed: 8, count: 120 }).ref));
  expect(await checkCandidates([candidate], scan, images, options)).toMatchObject({ imageCheck: { url: candidate.imageUrls[1] } });
  expect(images.download).toHaveBeenCalledTimes(2);
  expect(images.remove).toHaveBeenCalledTimes(4);
});

it('checks at most three candidates and two images each', async () => {
  const images = deps();
  images.embed.mockResolvedValue(Float32Array.from([0, 1]));
  const many = Array.from({ length: 4 }, () => ({ ...candidate, imageUrls: [...candidate.imageUrls, 'https://museum.example/extra.jpg'] }));
  expect(await checkCandidates(many, scan, images, options)).toBeNull();
  expect(images.download).toHaveBeenCalledTimes(6);
  expect(images.remove).toHaveBeenCalledTimes(12);
});

it('cleans a download when letterboxing fails and continues with the next image', async () => {
  const images = deps();
  images.letterbox.mockRejectedValueOnce(new Error('bad image'));
  expect(await checkCandidates([candidate], scan, images, options)).toMatchObject({ imageCheck: { url: candidate.imageUrls[1] } });
  expect(images.remove.mock.calls.flat()).toContain('file:///cache/blue.jpg');
});

it('stops downloading when consent or connectivity is withdrawn', async () => {
  const images = deps();
  expect(await checkCandidates([candidate], scan, images, { ...options, canContinue: async () => false })).toBeNull();
  expect(images.download).not.toHaveBeenCalled();
});

it('cleans downloaded files when native ORB extraction fails', async () => {
  const images = deps();
  images.extractOrb.mockRejectedValue(new Error('native extraction failed'));
  await expect(checkCandidates([candidate], scan, images, options)).rejects.toThrow('native extraction failed');
  expect(images.remove.mock.calls.flat()).toEqual(['file:///cache/blue.jpg', 'file:///cache/blue.jpg.box.jpg']);
});
