import {
  CONTRIBUTION_CROP_QUALITY, decodedBytes, LABEL_PHOTO_QUALITY, prepareLabelPhoto, prepareMuseumSearchCrop, removeFile, resizeCropForContribution,
} from './crop';

const mockManipulate = jest.fn();
const mockResize = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockExisting = new Set<string>();
const sizes: Record<string, [number, number]> = {};

type FakeImage = { width: number; height: number; saveAsync: (options: unknown) => Promise<unknown> };

function image(width: number, height: number): FakeImage {
  return { width, height, saveAsync: (options) => mockSave(width, height, options) };
}

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: (source: unknown) => mockManipulate(source) },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockExisting.has(this.uri); }
    delete() { mockDelete(this.uri); mockExisting.delete(this.uri); }
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockManipulate.mockImplementation((source: string | FakeImage) => {
    let requested: { width?: number; height?: number } | undefined;
    const context = {
      resize(size: { width?: number; height?: number }) { mockResize(size); requested = size; return context; },
      async renderAsync(): Promise<FakeImage> {
        const base = typeof source === 'string' ? image(...sizes[source]) : source;
        if (requested?.width) return image(requested.width, Math.round((base.height * requested.width) / base.width));
        if (requested?.height) return image(Math.round((base.width * requested.height) / base.height), requested.height);
        return base;
      },
    };
    return context;
  });
  mockSave.mockImplementation(async (width: number, height: number, options: { base64?: boolean }) => {
    mockExisting.add('file:///cache/out.jpg');
    return { uri: 'file:///cache/out.jpg', width, height, base64: options.base64 ? 'QUJDRA==' : undefined };
  });
});

it('scales a landscape photo to 1600 px wide as JPEG 0.8 with base64 and drops the temporary file', async () => {
  sizes['file:///tmp/label.jpg'] = [4000, 3000];
  const result = await prepareLabelPhoto('file:///tmp/label.jpg');
  expect(mockResize).toHaveBeenCalledWith({ width: 1600 });
  expect(mockSave).toHaveBeenCalledWith(1600, 1200, { format: 'jpeg', compress: LABEL_PHOTO_QUALITY, base64: true });
  expect(result).toEqual({ base64: 'QUJDRA==', width: 1600, height: 1200 });
  expect(mockDelete).toHaveBeenCalledWith('file:///cache/out.jpg');
});

it('scales a portrait photo by its height and leaves a small photo unresized', async () => {
  sizes['file:///tmp/portrait.jpg'] = [3000, 4000];
  await prepareLabelPhoto('file:///tmp/portrait.jpg');
  expect(mockResize).toHaveBeenCalledWith({ height: 1600 });
  expect(mockSave).toHaveBeenLastCalledWith(1200, 1600, expect.anything());
  sizes['file:///tmp/small.jpg'] = [1200, 800];
  mockResize.mockClear();
  await prepareLabelPhoto('file:///tmp/small.jpg');
  expect(mockResize).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenLastCalledWith(1200, 800, expect.anything());
});

it('falls back to 1280 px when the 1600 px encoding exceeds the server limit', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  sizes['file:///tmp/dense.jpg'] = [4000, 3000];
  const huge = 'A'.repeat(2_100_000);
  mockSave.mockImplementationOnce(async (width: number, height: number) => ({ uri: 'file:///cache/big.jpg', width, height, base64: huge }));
  const result = await prepareLabelPhoto('file:///tmp/dense.jpg');
  expect(decodedBytes(huge)).toBeGreaterThan(1_500_000);
  expect(mockResize.mock.calls).toEqual([[{ width: 1600 }], [{ width: 1280 }]]);
  expect(result).toEqual({ base64: 'QUJDRA==', width: 1280, height: 960 });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1280'));
});

it('resizes the letterboxed crop to 256 px JPEG 0.85 without base64', async () => {
  sizes['file:///documents/crops/c1.jpg'] = [512, 512];
  const result = await resizeCropForContribution('file:///documents/crops/c1.jpg');
  expect(mockResize).toHaveBeenCalledWith({ width: 256 });
  expect(mockSave).toHaveBeenCalledWith(256, 256, { format: 'jpeg', compress: CONTRIBUTION_CROP_QUALITY });
  expect(result).toMatchObject({ uri: 'file:///cache/out.jpg', width: 256, height: 256 });
  expect(mockDelete).not.toHaveBeenCalled();
});

it('computes decoded sizes from base64 padding and removes only existing files', () => {
  expect(decodedBytes('QUJD')).toBe(3);
  expect(decodedBytes('QUJDRA==')).toBe(4);
  expect(decodedBytes('QUJDREU=')).toBe(5);
  removeFile('file:///missing.jpg');
  expect(mockDelete).not.toHaveBeenCalled();
  mockExisting.add('file:///present.jpg');
  removeFile('file:///present.jpg');
  expect(mockDelete).toHaveBeenCalledWith('file:///present.jpg');
});

it('prepares the museum crop as JPEG 0.8 at no more than 1024 px and deletes the encoded file', async () => {
  sizes['file:///crop.jpg'] = [2048, 2048];
  expect(await prepareMuseumSearchCrop('file:///crop.jpg')).toBe('QUJDRA==');
  expect(mockSave).toHaveBeenCalledWith(1024, 1024, { format: 'jpeg', compress: 0.8, base64: true });
  expect(mockDelete).toHaveBeenCalledWith('file:///cache/out.jpg');
});

it('retries the museum crop at 800 px and rejects it if it still exceeds 1.5 MB', async () => {
  sizes['file:///crop.jpg'] = [2048, 2048];
  mockSave.mockResolvedValueOnce({ uri: 'file:///big.jpg', base64: 'A'.repeat(2_000_004) });
  expect(await prepareMuseumSearchCrop('file:///crop.jpg')).toBe('QUJDRA==');
  expect(mockResize.mock.calls).toEqual([[{ width: 1024 }], [{ width: 800 }]]);
  mockSave.mockResolvedValue({ uri: 'file:///big.jpg', base64: 'A'.repeat(2_000_004) });
  await expect(prepareMuseumSearchCrop('file:///crop.jpg')).rejects.toThrow('image_too_large');
});
