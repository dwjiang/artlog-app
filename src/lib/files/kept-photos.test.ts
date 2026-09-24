import { keepPhotos, shrinkLibraryPhoto } from "./kept-photos";

const mockExisting = new Set<string>();
const mockEvents: string[] = [];
const mockSizes = new Map<string, { width: number; height: number }>();
const mockResize = jest.fn();
const mockSave = jest.fn();
const mockCreateAsset = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSaveToPhotos = jest.fn();
const mockReportError = jest.fn();
const mockSettings = new Map<string, string>();
let mockMoveFailure = false;
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
}));

jest.mock("./photos", () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock("@/lib/settings/save-to-photos", () => ({ getSaveToPhotos: () => mockSaveToPhotos() }));
jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));
jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  Asset: { create: (uri: string) => mockCreateAsset(uri) },
}));
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockExisting.has(this.uri);
    }
    get size() {
      return 1000;
    }
    get modificationTime() {
      return 123;
    }
    async move(target: { uri: string }, options: unknown) {
      if (mockMoveFailure && options) {
        mockExisting.delete(target.uri);
        throw new Error("Move failed after removing destination");
      }
      mockEvents.push(`move ${this.uri} -> ${target.uri} ${JSON.stringify(options)}`);
      mockExisting.delete(this.uri);
      mockExisting.add(target.uri);
      if (this.uri === shrunk) mockSizes.set(target.uri, { width: 1920, height: 2560 });
      this.uri = target.uri;
    }
    async copy(target: { uri: string }) {
      mockExisting.add(target.uri);
      mockSizes.set(target.uri, mockSizes.get(this.uri)!);
    }
    delete() {
      if (!this.uri.endsWith(".original")) mockEvents.push(`delete ${this.uri}`);
      mockExisting.delete(this.uri);
    }
  },
}));
jest.mock("expo-image-manipulator", () => {
  const image = (size: { width: number; height: number }) => ({ ...size, release: jest.fn(), saveAsync: mockSave });
  return {
    SaveFormat: { JPEG: "jpeg" },
    ImageManipulator: {
      manipulate: (input: string | object) => ({
        renderAsync: async () => {
          if (typeof input === "string" && !mockExisting.has(input)) throw new Error("missing file");
          return image(mockSizes.get(input as string) ?? { width: 0, height: 0 });
        },
        resize: (size: object) => {
          mockResize(size);
          return { renderAsync: async () => image({ width: 1, height: 1 }) };
        },
        release: jest.fn(),
      }),
    },
  };
});

const original = "file:///documents/photos/scan.jpeg";
const shrunk = "file:///cache/ImageManipulator/small.jpg";

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockEvents.length = 0;
  mockSizes.clear();
  mockSettings.clear();
  mockMoveFailure = false;
  mockExisting.add(original);
  mockSizes.set(original, { width: 6048, height: 8064 });
  mockSaveToPhotos.mockResolvedValue(true);
  mockRequestPermissions.mockResolvedValue({ granted: true });
  mockCreateAsset.mockImplementation(async (uri: string) => {
    mockEvents.push(`photos ${uri}`);
  });
  mockSave.mockImplementation(async () => {
    mockExisting.add(shrunk);
    return { uri: shrunk };
  });
});

it("adds a saved camera original to Photos before replacing it with a copy at the upload size", async () => {
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);

  expect(mockRequestPermissions).toHaveBeenCalledWith(true);
  expect(mockResize).toHaveBeenCalledWith({ height: 2560 });
  expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85 });
  expect(mockEvents).toEqual([`photos ${original}`, `move ${shrunk} -> ${original} {"overwrite":true}`]);
  expect(mockReportError).not.toHaveBeenCalled();
});

it.each([
  ["a wall-label photo", "label", true, true],
  ["the setting is off", "full", false, true],
  ["Photos access is declined", "detail", true, false],
] as const)("shrinks without adding to Photos when %s", async (_, kind, enabled, granted) => {
  mockSaveToPhotos.mockResolvedValue(enabled);
  mockRequestPermissions.mockResolvedValue({ granted });

  await keepPhotos([{ path: "photos/scan.jpeg", kind }]);

  expect(mockCreateAsset).not.toHaveBeenCalled();
  expect(mockEvents).toEqual([`move ${shrunk} -> ${original} {"overwrite":true}`]);
});

it("keeps the full original when Photos fails for a reason other than permission", async () => {
  const failure = new Error("Photos unavailable");
  mockCreateAsset.mockRejectedValue(failure);

  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);

  expect(mockSave).not.toHaveBeenCalled();
  expect(mockEvents).toEqual([]);
  expect(mockExisting.has(original)).toBe(true);
  expect(mockReportError).toHaveBeenCalledWith(failure, "photos.save_original");
});

it("leaves photos already at the kept size alone", async () => {
  mockSizes.set(original, { width: 2560, height: 1920 });

  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);

  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockEvents).toEqual([]);
});

it("skips a photo deleted before or while it is resized, and still keeps the rest", async () => {
  const other = "file:///documents/photos/other.jpeg";
  mockExisting.add(other);
  mockSizes.set(other, { width: 8064, height: 6048 });
  mockCreateAsset.mockImplementation(async (uri: string) => {
    mockEvents.push(`photos ${uri}`);
    if (uri === other) mockExisting.delete(other);
  });

  await keepPhotos([
    { path: "photos/missing.jpeg", kind: "full" },
    { path: "photos/other.jpeg", kind: "full" },
    { path: "photos/scan.jpeg", kind: "full" },
  ]);

  expect(mockEvents).toEqual([
    `photos ${other}`,
    `delete ${shrunk}`,
    `photos ${original}`,
    `move ${shrunk} -> ${original} {"overwrite":true}`,
  ]);
  expect(mockReportError).not.toHaveBeenCalled();
});

it("shrinks a large library pick and removes the picker's copy, but returns a small pick as is", async () => {
  const pick = "file:///cache/ImagePicker/pick.jpeg";
  mockExisting.add(pick);
  mockSizes.set(pick, { width: 4032, height: 3024 });

  await expect(shrinkLibraryPhoto(pick)).resolves.toBe(shrunk);
  expect(mockResize).toHaveBeenCalledWith({ width: 2560 });
  expect(mockEvents).toEqual([`delete ${pick}`]);
  expect(mockCreateAsset).not.toHaveBeenCalled();

  const small = "file:///cache/ImagePicker/small.jpeg";
  mockExisting.add(small);
  mockSizes.set(small, { width: 1200, height: 900 });
  await expect(shrinkLibraryPhoto(small)).resolves.toBe(small);
});

it("retries a failed resize without adding the original to Photos twice", async () => {
  mockSave.mockRejectedValueOnce(new Error("Resize failed"));
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);
  expect(mockExisting.has(original)).toBe(true);
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);
  expect(mockCreateAsset).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(2);
  expect(mockSizes.get(original)).toEqual({ width: 1920, height: 2560 });
});

it("serializes startup and save requests for the same photo", async () => {
  await Promise.all([
    keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]),
    keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]),
  ]);
  expect(mockCreateAsset).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it("restores the original if replacing the app copy fails after removing its destination", async () => {
  mockMoveFailure = true;
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);
  expect(mockExisting.has(original)).toBe(true);
  expect(mockExisting.has(shrunk)).toBe(false);
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), "photos.keep");
  mockMoveFailure = false;
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);
  expect(mockCreateAsset).toHaveBeenCalledTimes(1);
  expect(mockSizes.get(original)).toEqual({ width: 1920, height: 2560 });
  expect(mockExisting.has(`${original}.original`)).toBe(false);
});

it("recovers an interrupted file replacement on the next pass", async () => {
  mockExisting.delete(original);
  mockExisting.add(`${original}.original`);
  mockSettings.set("kept-photo:photos/scan.jpeg", "exported");
  await keepPhotos([{ path: "photos/scan.jpeg", kind: "full" }]);
  expect(mockExisting.has(original)).toBe(true);
  expect(mockCreateAsset).not.toHaveBeenCalled();
  expect(mockSizes.get(original)).toEqual({ width: 1920, height: 2560 });
});
