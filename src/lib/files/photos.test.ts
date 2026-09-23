import {
  captureFileUri,
  deleteCapture,
  persistCapture,
  persistLabelPhoto,
  scanPreviewPath,
} from "./photos";

const mockCreate = jest.fn();
const mockMove = jest.fn();
const mockDelete = jest.fn();
const mockExisting = new Set<string>();
const mockCrop = jest.fn();
const mockSave = jest.fn();
const mockReleaseImage = jest.fn();
const mockReleaseContext = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: { manipulate: () => ({ crop: mockCrop, release: mockReleaseContext }) },
}));
const contentBounds = { x: 0, y: 85, width: 512, height: 341 };
let mockDocumentsUri = "file:///documents";
let mockUuid = 0;

jest.mock("expo-crypto", () => ({ randomUUID: () => String(++mockUuid) }));

jest.mock("expo-file-system", () => {
  class Node {
    uri: string;
    constructor(...parts: (string | Node)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get exists() {
      return mockExisting.has(this.uri);
    }
  }
  class Directory extends Node {
    create(options: unknown) {
      mockCreate(this.uri, options);
    }
  }
  class File extends Node {
    async move(destination: Node) {
      mockMove(this.uri, destination.uri);
      this.uri = destination.uri;
    }
    delete() {
      mockDelete(this.uri);
      mockExisting.delete(this.uri);
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return new Directory(mockDocumentsUri);
      },
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockDocumentsUri = "file:///documents";
  mockUuid = 0;
  mockCrop.mockReturnValue({
    renderAsync: async () => ({ saveAsync: mockSave, release: mockReleaseImage }),
  });
  mockSave.mockResolvedValue({ uri: "file:///tmp/preview.jpg" });
});

it("moves the photo and crop into documents named by the capture, keeping extensions", async () => {
  const files = await persistCapture({
    photoUri: "file:///tmp/IMG_1.PNG",
    cropUri: "file:///caches/crops/abc.jpg",
    localId: "cap-1",
    contentBounds,
  });
  expect(files).toEqual({ photoPath: "photos/cap-1.png", cropPath: "crops/cap-1.jpg" });
  expect(mockCreate.mock.calls).toEqual([
    ["file:///documents/photos", { intermediates: true, idempotent: true }],
    ["file:///documents/crops", { intermediates: true, idempotent: true }],
  ]);
  expect(mockMove.mock.calls).toEqual([
    ["file:///tmp/IMG_1.PNG", "file:///documents/photos/cap-1.png"],
    ["file:///caches/crops/abc.jpg", "file:///documents/crops/cap-1.jpg"],
    ["file:///tmp/preview.jpg", "file:///documents/crops/cap-1.preview.jpg"],
  ]);
});

it.each([
  { x: 0, y: 85, width: 512, height: 341 },
  { x: 85, y: 0, width: 341, height: 512 },
  { x: 0, y: 0, width: 512, height: 512 },
])(
  "stores only the artwork in the preview while retaining the original model file: %j",
  async (bounds) => {
    const files = await persistCapture({
      photoUri: "file:///tmp/photo.jpg",
      cropUri: "file:///tmp/model.jpg",
      localId: "scan",
      contentBounds: bounds,
    });
    expect(mockCrop).toHaveBeenCalledWith({
      originX: bounds.x,
      originY: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    expect(mockMove).toHaveBeenCalledWith("file:///tmp/model.jpg", captureFileUri(files.cropPath));
    expect(mockMove).toHaveBeenCalledWith(
      "file:///tmp/preview.jpg",
      captureFileUri(scanPreviewPath(files.cropPath)),
    );
    expect(mockReleaseImage).toHaveBeenCalledTimes(1);
    expect(mockReleaseContext).toHaveBeenCalledTimes(1);
  },
);

it("releases decoded images and leaves capture files in place when preview encoding fails", async () => {
  mockSave.mockRejectedValueOnce(new Error("Encoding failed"));
  await expect(
    persistCapture({
      photoUri: "file:///tmp/photo.jpg",
      cropUri: "file:///tmp/model.jpg",
      localId: "scan",
      contentBounds,
    }),
  ).rejects.toThrow("Encoding failed");
  expect(mockMove).not.toHaveBeenCalled();
  expect(mockReleaseImage).toHaveBeenCalledTimes(1);
  expect(mockReleaseContext).toHaveBeenCalledTimes(1);
});

it("keeps each offline label photo at a distinct path so a completed read cannot delete a newer shot", async () => {
  await expect(
    persistLabelPhoto({ photoUri: "file:///tmp/label.jpg", localId: "cap-3" }),
  ).resolves.toBe("labels/cap-3-1.jpg");
  await expect(
    persistLabelPhoto({ photoUri: "file:///tmp/retake.jpg", localId: "cap-3" }),
  ).resolves.toBe("labels/cap-3-2.jpg");
  expect(mockCreate).toHaveBeenCalledWith("file:///documents/labels", {
    intermediates: true,
    idempotent: true,
  });
  expect(mockMove).toHaveBeenCalledWith(
    "file:///tmp/label.jpg",
    "file:///documents/labels/cap-3-1.jpg",
  );
});

it("falls back to .jpg when the source has no extension", async () => {
  const files = await persistCapture({
    photoUri: "file:///tmp/photo",
    cropUri: "file:///tmp/crop",
    localId: "cap-2",
    contentBounds,
  });
  expect(files).toEqual({ photoPath: "photos/cap-2.jpg", cropPath: "crops/cap-2.jpg" });
});

it("deletes only the files that still exist", () => {
  mockExisting.add("file:///documents/photos/cap-1.jpg");
  mockExisting.add("file:///documents/labels/cap-1.jpg");
  mockExisting.add("file:///documents/crops/cap-1.preview.jpg");
  deleteCapture({
    photoPath: "photos/cap-1.jpg",
    cropPath: "crops/cap-1.jpg",
    labelPhotoPath: "labels/cap-1.jpg",
  });
  expect(mockDelete.mock.calls).toEqual([
    ["file:///documents/photos/cap-1.jpg"],
    ["file:///documents/crops/cap-1.preview.jpg"],
    ["file:///documents/labels/cap-1.jpg"],
  ]);
  expect(() => deleteCapture({ photoPath: null, cropPath: undefined })).not.toThrow();
});

it("finds persisted files after the app data container moves", async () => {
  const files = await persistCapture({
    photoUri: "file:///tmp/photo.jpg",
    cropUri: "file:///tmp/crop.jpg",
    localId: "cap-1",
    contentBounds,
  });
  mockDocumentsUri = "file:///new-container/documents";
  expect(captureFileUri(files.cropPath)).toBe("file:///new-container/documents/crops/cap-1.jpg");
  mockExisting.add("file:///new-container/documents/photos/cap-1.jpg");
  mockExisting.add("file:///new-container/documents/crops/cap-1.jpg");
  deleteCapture(files);
  expect(mockDelete.mock.calls).toEqual([
    ["file:///new-container/documents/photos/cap-1.jpg"],
    ["file:///new-container/documents/crops/cap-1.jpg"],
  ]);
});
