import { downloadCollectionPhoto, uploadCollectionPhoto } from "./photo-transfer";

const mockUpload = jest.fn();
const mockDownload = jest.fn();
const mockDelete = jest.fn();
const mockResize = jest.fn();
const mockSave = jest.fn();
const mockRelease = jest.fn();
let mockWidth = 4000;
let mockHeight = 3000;
let mockSize = 1000;
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("expo-file-system", () => {
  class Node {
    uri: string;
    constructor(...parts: (string | Node)[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
    }
    create() {}
  }
  class File extends Node {
    get size() {
      return mockSize;
    }
    get exists() {
      return true;
    }
    upload(url: string, options: unknown) {
      return mockUpload(this.uri, url, options);
    }
    delete() {
      mockDelete(this.uri);
    }
    static downloadFileAsync(url: string, destination: File, options: unknown) {
      return mockDownload(url, destination.uri, options);
    }
  }
  return {
    Directory: Node,
    File,
    Paths: { document: new Node("file:///documents") },
    UploadType: { BINARY_CONTENT: 0 },
  };
});
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: (size: { width?: number; height?: number }) => {
          mockResize(size);
          const scale = size.width ? size.width / mockWidth : size.height! / mockHeight;
          mockWidth = Math.round(mockWidth * scale);
          mockHeight = Math.round(mockHeight * scale);
          return context;
        },
        release: mockRelease,
        renderAsync: async () => ({
          width: mockWidth,
          height: mockHeight,
          saveAsync: mockSave,
          release: mockRelease,
        }),
      };
      return context;
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockWidth = 4000;
  mockHeight = 3000;
  mockSize = 1000;
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
  mockSave.mockResolvedValue({ uri: "file:///cache/encoded.jpg" });
  mockUpload.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ storageId: "photo-id", photoUpdatedAt: 1 }),
  });
  mockDownload.mockResolvedValue({});
});

it("uploads a bounded JPEG copy with authentication while leaving the original file intact", async () => {
  expect(await uploadCollectionPhoto("private-token", "scope", "save-1", "photo", "original.heic")).toEqual({
    storageId: "photo-id",
    photoUpdatedAt: 1,
  });
  expect(mockResize).toHaveBeenCalledWith({ width: 1080 });
  expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85 });
  expect(mockUpload).toHaveBeenCalledWith(
    "file:///cache/encoded.jpg",
    "https://test.convex.site/collection-photo?scope=scope&localId=save-1&kind=photo",
    expect.objectContaining({
      httpMethod: "POST",
      headers: {
        Authorization: "Bearer private-token",
        "Content-Type": "image/jpeg",
        "X-Photo-Height": "810",
        "X-Photo-Width": "1080",
      },
    }),
  );
  expect(mockDelete.mock.calls).toEqual([["file:///cache/encoded.jpg"]]);
});

it.each([
  [3024, 4032, 1080, 1440],
  [3000, 3000, 1080, 1080],
  [4032, 3024, 1080, 810],
  [2160, 6000, 1080, 3000],
])("uploads a %i × %i photo at %i × %i without cropping", async (width, height, expectedWidth, expectedHeight) => {
  mockWidth = width;
  mockHeight = height;
  await uploadCollectionPhoto("token", "scope", "a", "photo", "original.jpg");
  expect(mockResize).toHaveBeenCalledWith({ width: 1080 });
  expect(mockUpload).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({
        "X-Photo-Width": String(expectedWidth),
        "X-Photo-Height": String(expectedHeight),
      }),
    }),
  );
});

it.each([
  [200, 300],
  [1080, 1440],
  [900, 3000],
])("preserves a %i × %i photo's dimensions while encoding it as JPEG", async (width, height) => {
  mockWidth = width;
  mockHeight = height;
  await uploadCollectionPhoto("token", "scope", "b", "photo", "small.png");
  expect(mockResize).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85 });
  expect(mockUpload).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({
        "X-Photo-Width": String(width),
        "X-Photo-Height": String(height),
      }),
    }),
  );
});

it("keeps the existing 512-pixel longest-edge limit for crop thumbnails", async () => {
  mockWidth = 1000;
  mockHeight = 2000;
  await uploadCollectionPhoto("token", "scope", "a", "crop", "crop.jpg");
  expect(mockResize).toHaveBeenCalledWith({ height: 512 });
});

it("cleans up a failed upload and reports the HTTP failure for retry", async () => {
  mockUpload.mockResolvedValue({ status: 503, body: "{}" });
  await expect(uploadCollectionPhoto("token", "scope", "a", "photo", "original.jpg")).rejects.toThrow("503");
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/encoded.jpg");
});

it("does not upload after the account changes during encoding", async () => {
  await expect(uploadCollectionPhoto("token", "scope", "a", "photo", "original.jpg", () => false)).rejects.toThrow(
    "cancelled",
  );
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/encoded.jpg");
});

it("downloads through the authenticated endpoint into the document directory", async () => {
  expect(await downloadCollectionPhoto("token", "scope", "save-1", "photo", "photo-id" as string)).toBe(
    "collection-photos/scope-save-1-photo-photo-id.jpg",
  );
  expect(mockDownload).toHaveBeenCalledWith(
    "https://test.convex.site/collection-photo?scope=scope&localId=save-1&kind=photo",
    "file:///documents/collection-photos/scope-save-1-photo-photo-id.jpg",
    { headers: { Authorization: "Bearer token" }, idempotent: true },
  );
});
