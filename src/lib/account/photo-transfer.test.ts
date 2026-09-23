import { downloadCollectionPhoto, uploadCollectionPhoto } from "./photo-transfer";
import type { Id } from "../../../convex/_generated/dataModel";

const mockUpload = jest.fn(),
  mockDownload = jest.fn(),
  mockDelete = jest.fn(),
  mockResize = jest.fn();
const mockSave = jest.fn(),
  mockRelease = jest.fn();
let mockWidth = 4000,
  mockHeight = 3000,
  mockSize = 1000;
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
        resize: (size: unknown) => {
          mockResize(size);
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
  expect(
    await uploadCollectionPhoto("private-token", "scope", "save-1", "photo", "original.heic"),
  ).toEqual({ storageId: "photo-id", photoUpdatedAt: 1 });
  expect(mockResize).toHaveBeenCalledWith({ width: 2560 });
  expect(mockSave).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85 });
  expect(mockUpload).toHaveBeenCalledWith(
    "file:///cache/encoded.jpg",
    "https://test.convex.site/collection-photo?scope=scope&localId=save-1&kind=photo",
    expect.objectContaining({
      httpMethod: "POST",
      headers: {
        Authorization: "Bearer private-token",
        "Content-Type": "image/jpeg",
        "X-Photo-Height": "3000",
        "X-Photo-Width": "4000",
      },
    }),
  );
  expect(mockDelete.mock.calls).toEqual([["file:///cache/encoded.jpg"]]);
});

it("limits portrait crops by height and never upscales a small image", async () => {
  mockWidth = 1000;
  mockHeight = 2000;
  await uploadCollectionPhoto("token", "scope", "a", "crop", "crop.jpg");
  expect(mockResize).toHaveBeenCalledWith({ height: 512 });
  mockResize.mockClear();
  mockWidth = 200;
  mockHeight = 300;
  await uploadCollectionPhoto("token", "scope", "b", "photo", "small.jpg");
  expect(mockResize).not.toHaveBeenCalled();
});

it("cleans up a failed upload and reports the HTTP failure for retry", async () => {
  mockUpload.mockResolvedValue({ status: 503, body: "{}" });
  await expect(
    uploadCollectionPhoto("token", "scope", "a", "photo", "original.jpg"),
  ).rejects.toThrow("503");
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/encoded.jpg");
});

it("does not upload after the account changes during encoding", async () => {
  await expect(
    uploadCollectionPhoto("token", "scope", "a", "photo", "original.jpg", () => false),
  ).rejects.toThrow("cancelled");
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/encoded.jpg");
});

it("downloads through the authenticated endpoint into the document directory", async () => {
  expect(
    await downloadCollectionPhoto(
      "token",
      "scope",
      "save-1",
      "photo",
      "photo-id" as Id<"_storage">,
    ),
  ).toBe("collection-photos/scope-save-1-photo-photo-id.jpg");
  expect(mockDownload).toHaveBeenCalledWith(
    "https://test.convex.site/collection-photo?scope=scope&localId=save-1&kind=photo",
    "file:///documents/collection-photos/scope-save-1-photo-photo-id.jpg",
    { headers: { Authorization: "Bearer token" }, idempotent: true },
  );
});
