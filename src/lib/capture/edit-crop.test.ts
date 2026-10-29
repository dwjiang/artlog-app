import { db } from "@/db/client";
import { addArtworkPhoto } from "@/db/repos/artwork-album";
import { enqueuePendingScan, getPendingScan, markIdentified, recordAttemptFailure } from "@/db/repos/pending-scans";
import { getSavedWork, insertSavedWork } from "@/db/repos/saved-works";
import { artworkPhotos, savedWorks, pendingScans, settings } from "@/db/schema";
import { recognizeOfflineCapture } from "@/lib/museum-downloads/recognize-capture";

import type { Id } from "../../../convex/_generated/dataModel";
import { getVisionRect } from "../../../modules/vision-rect/src";
import { saveEditedArtworkCrop, saveEditedScanCrop, snapScanCrop, type EditedCrop } from "./edit-crop";
import { readPhotoSession, updatePhotoSession } from "./photo-draft";
import type { IdentifyResponse, Quad } from "./stages";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("../../../modules/vision-rect/src", () => ({
  getVisionRect: jest.fn(),
}));
jest.mock("@/lib/embed/embedder", () => ({ embedder: {} }));
jest.mock("@/lib/museum-downloads/recognize-capture", () => ({
  recognizeOfflineCapture: jest.fn(async () => {}),
}));
let mockReachable: boolean | undefined = true;
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isInternetReachable: mockReachable }),
}));
const mockFeatures = jest.fn();
jest.mock("./features", () => ({
  extractFeatures: (...args: unknown[]) => mockFeatures(...args),
  orb: {},
}));
const mockFiles = new Set<string>();
let mockFailCopy = false;
jest.mock("expo-file-system", () => {
  class Node {
    uri: string;
    constructor(...parts: (string | Node)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    create() {}
    get exists() {
      return mockFiles.has(this.uri);
    }
    copy(target: Node) {
      if (mockFailCopy || !mockFiles.has(this.uri)) {
        throw new Error("copy failed");
      }
      mockFiles.add(target.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  return {
    File: Node,
    Directory: Node,
    Paths: { document: "file:///documents" },
  };
});
jest.mock("expo-crypto", () => ({ randomUUID: () => "new-crop-id" }));
jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: () => ({
      crop: () => ({
        renderAsync: async () => ({
          saveAsync: async () => {
            mockFiles.add("file:///tmp/snapped-preview.jpg");
            return { uri: "file:///tmp/snapped-preview.jpg" };
          },
          release() {},
        }),
      }),
      release() {},
    }),
  },
  SaveFormat: {},
}));
const mockThumbnail = jest.fn();
jest.mock("expo-image", () => ({ Image: { loadAsync: (uri: string) => mockThumbnail(uri) } }));
const owner = "device:test-installation";
const crop: EditedCrop = {
  modelUri: "file:///tmp/model.jpg",
  previewUri: "file:///tmp/preview.jpg",
  width: 512,
  height: 400,
  photoPath: "full.jpg",
  corners: [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ],
};
const features = {
  vector: [0.5],
  descriptors: new ArrayBuffer(4),
  keypoints: new ArrayBuffer(4),
};
beforeEach(() => {
  for (const table of [artworkPhotos, savedWorks, pendingScans, settings]) {
    db.delete(table).run();
  }
  mockFiles.clear();
  mockFailCopy = false;
  mockReachable = true;
  jest.mocked(recognizeOfflineCapture).mockClear();
  for (const path of [
    crop.modelUri,
    crop.previewUri,
    "file:///documents/full.jpg",
    "file:///documents/old.jpg",
    "file:///documents/old.preview.jpg",
  ]) {
    mockFiles.add(path);
  }
  mockFeatures.mockReset().mockResolvedValue(features);
});
async function seedScan(savedPhotoLocalId?: string) {
  await enqueuePendingScan({
    localId: "scan",
    savedPhotoLocalId,
    photoPath: "full.jpg",
    cropPath: "old.jpg",
    capturedAt: 1,
    createdAt: 1,
    ...features,
    modelVersion: "old-model",
    attemptModelVersion: "old-model",
    status: "identified",
    scanId: "old-scan" as Id<"scans">,
  });
}

it("keeps an edited legacy capture in the unsaved queue instead of inheriting its album link", async () => {
  await seedScan("legacy-photo");
  const nextId = await saveEditedScanCrop("scan", crop, owner);
  expect(await getPendingScan(nextId)).toMatchObject({ savedPhotoLocalId: null, status: "queued" });
});

it("updates only the collection crop and its corners, preserves the original album photo, and queues an upload", async () => {
  await insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    photoPath: "full.jpg",
    cropPath: "old.preview.jpg",
    cropStorageId: "cloud" as string,
  });
  await saveEditedArtworkCrop("work", crop, owner);
  const work = await getSavedWork("work");
  expect(work).toMatchObject({
    photoPath: "full.jpg",
    cropPhotoLocalId: "work",
    cropCorners: crop.corners,
    cropStorageId: null,
  });
  expect(work?.cropPath).not.toBe("old.preview.jpg");
  expect(mockFiles.has(`file:///documents/${work?.cropPath}`)).toBe(true);
  expect(mockFiles.has("file:///documents/full.jpg")).toBe(true);
  expect(db.select().from(artworkPhotos).all()[0].path).toBe("full.jpg");
});

it("keeps a crop linked to its source when it is cut from another album photo", async () => {
  await insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    photoPath: "full.jpg",
    cropPath: "old.preview.jpg",
    cropCorners: crop.corners,
  });
  addArtworkPhoto(
    { localId: "detail-photo", savedLocalId: "work", path: "detail.jpg", kind: "detail", capturedAt: 2 },
    owner,
  );
  await saveEditedArtworkCrop("work", { ...crop, photoPath: "detail.jpg" }, owner);
  expect(await getSavedWork("work")).toMatchObject({
    photoPath: "detail.jpg",
    cropPhotoLocalId: "detail-photo",
    cropCorners: crop.corners,
  });
});

it("keeps the previous saved crop if writing the new file fails, and can retry the same preview", async () => {
  await insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    cropPath: "old.preview.jpg",
  });
  mockFailCopy = true;
  await expect(saveEditedArtworkCrop("work", crop, owner)).rejects.toThrow("copy failed");
  expect((await getSavedWork("work"))?.cropPath).toBe("old.preview.jpg");
  mockFailCopy = false;
  await saveEditedArtworkCrop("work", crop, owner);
  expect(mockFiles.has(crop.previewUri)).toBe(true);
});

it("refuses a crop save for another owner or a dismissed editor", async () => {
  await insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    cropPath: "old.preview.jpg",
  });
  await expect(saveEditedArtworkCrop("work", crop, "someone-else")).rejects.toThrow("Artwork unavailable");
  await expect(saveEditedArtworkCrop("work", crop, owner, () => false)).rejects.toThrow("Crop edit cancelled");
  expect((await getSavedWork("work"))?.cropPath).toBe("old.preview.jpg");
});

it("recomputes scan features, preserves draft photos and context, and isolates late results for the old crop", async () => {
  await seedScan();
  updatePhotoSession(owner, "full.jpg", {
    photos: [{ localId: "detail", kind: "detail", path: "detail.jpg", capturedAt: 2 }],
    visit: { kind: "none" },
  });
  const nextId = await saveEditedScanCrop("scan", crop, owner);
  const next = await getPendingScan(nextId);
  expect(next).toMatchObject({
    ...features,
    cropCorners: crop.corners,
    status: "queued",
    scanId: null,
    attempts: 0,
    capturedAt: 1,
  });
  expect(next?.photoPath).not.toBe("full.jpg");
  expect(mockFiles.has(`file:///documents/${next?.photoPath}`)).toBe(true);
  expect(readPhotoSession(owner, next!.photoPath)).toMatchObject({
    photos: [{ localId: "detail" }],
    visit: { kind: "none" },
  });
  expect(await getPendingScan("scan")).toBeUndefined();
  await markIdentified("scan", "late-old-result" as Id<"scans">);
  expect((await getPendingScan(nextId))?.scanId).toBeNull();
  await expect(recordAttemptFailure("scan", "late network error", { countAttempt: true })).resolves.toEqual({
    status: "failed",
    attempts: 0,
  });
});

it("matches the new crop against downloaded museums only when the queue cannot send it", async () => {
  await seedScan();
  expect(await saveEditedScanCrop("scan", crop, owner)).toBe("new-crop-id");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(recognizeOfflineCapture).not.toHaveBeenCalled();
});

it("matches the new crop against downloaded museums while offline, after the editor has its new scan id", async () => {
  mockReachable = false;
  await seedScan();
  await saveEditedScanCrop("scan", crop, owner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(recognizeOfflineCapture).toHaveBeenCalledWith(
    expect.objectContaining({ ...features, owner, localId: "new-crop-id" }),
  );
});

it("leaves the old scan intact when extraction fails or the editor closes during extraction", async () => {
  await seedScan();
  mockFeatures.mockRejectedValueOnce(new Error("Model failed"));
  await expect(saveEditedScanCrop("scan", crop, owner)).rejects.toThrow("Model failed");
  let active = true;
  mockFeatures.mockImplementationOnce(async () => {
    active = false;
    return features;
  });
  await expect(saveEditedScanCrop("scan", crop, owner, () => active)).rejects.toThrow("Journal owner changed");
  expect((await getPendingScan("scan"))?.cropPath).toBe("old.jpg");
  expect(mockFiles.has("file:///documents/full.jpg")).toBe(true);
});

describe("snapping a recognized scan's crop to the painting", () => {
  // The identified crop kept the frame: the whole photo, where the catalogue image covers the middle three quarters.
  const identified: Quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const canvas: Quad = [
    [0.125, 0.125],
    [0.875, 0.125],
    [0.875, 0.875],
    [0.125, 0.875],
  ];
  const geometry = {
    corners: identified,
    contentBounds: { x: 0, y: 0, width: 512, height: 512 },
  };
  const match = {
    thumbnailUrl: "https://images.example/work.jpg?width=330",
    thumbnailCorners: [
      [64, 64],
      [448, 64],
      [448, 448],
      [64, 448],
    ],
  } as IdentifyResponse["best"];
  const warpAndLetterbox = jest.fn();

  beforeEach(async () => {
    await seedScan();
    db.update(pendingScans).set({ cropCorners: identified, modelCropGeometry: geometry }).run();
    mockThumbnail.mockReset().mockResolvedValue({ width: 330, height: 330, release() {} });
    warpAndLetterbox.mockReset().mockImplementation(async (_path: string, corners: { x: number; y: number }[]) => {
      mockFiles.add("file:///tmp/snapped-model.png");
      return {
        cropPath: "/tmp/snapped-model.png",
        contentBounds: { x: 0, y: 0, width: 512, height: 512 },
        usedQuad: corners,
      };
    });
    jest.mocked(getVisionRect).mockReturnValue({ warpAndLetterbox } as unknown as ReturnType<typeof getVisionRect>);
  });

  it("shows the painting's own edges, keeping the identified crop's features for the model", async () => {
    await snapScanCrop("scan", match, owner);
    expect(warpAndLetterbox).toHaveBeenCalledWith(
      "/documents/full.jpg",
      canvas.map(([x, y]) => ({ x: expect.closeTo(x, 6), y: expect.closeTo(y, 6) })),
      512,
    );
    const scan = await getPendingScan("scan");
    expect(scan).toMatchObject({ ...features, status: "identified", scanId: "old-scan", modelCropGeometry: geometry });
    scan!.cropCorners!.flat().forEach((value, index) => expect(value).toBeCloseTo(canvas.flat()[index], 6));
    expect(scan?.cropPath).not.toBe("old.jpg");
    const preview = scan!.cropPath.replace(/\.[^.]+$/, ".preview.jpg");
    expect(mockFiles.has(`file:///documents/${preview}`)).toBe(true);
    expect(mockFiles.has("file:///documents/old.jpg")).toBe(false);
    expect(mockFiles.has("file:///documents/old.preview.jpg")).toBe(false);
    expect(mockFiles.has("file:///tmp/snapped-model.png")).toBe(false);
  });

  it("keeps the crop when the painting runs off the photo or nothing places it", async () => {
    const offPhoto = {
      ...match,
      thumbnailCorners: [
        [-80, 64],
        [448, 64],
        [448, 448],
        [-80, 448],
      ],
    } as typeof match;
    for (const unplaced of [offPhoto, { ...match!, thumbnailCorners: undefined }, undefined]) {
      await snapScanCrop("scan", unplaced, owner);
    }
    expect(warpAndLetterbox).not.toHaveBeenCalled();
    expect((await getPendingScan("scan"))?.cropPath).toBe("old.jpg");
  });

  it("does not apply the same snap twice to the unchanged model crop", async () => {
    await snapScanCrop("scan", match, owner);
    await snapScanCrop("scan", match, owner);
    expect(warpAndLetterbox).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy crops without model geometry", async () => {
    db.update(pendingScans).set({ modelCropGeometry: null }).run();
    await snapScanCrop("scan", match, owner);
    expect(mockThumbnail).not.toHaveBeenCalled();
    expect(warpAndLetterbox).not.toHaveBeenCalled();
  });

  it("keeps the boundary chosen in the crop editor after queued recognition", async () => {
    const editedId = await saveEditedScanCrop("scan", crop, owner);
    expect((await getPendingScan(editedId))?.modelCropGeometry).toBeNull();
    await snapScanCrop(editedId, match, owner);
    expect(warpAndLetterbox).not.toHaveBeenCalled();
  });

  it.each(["old.preview.jpg", "manually-edited.jpg"])(
    "updates an offline save only while it still uses the original preview: %s",
    async (savedCrop) => {
      await insertSavedWork({
        localId: "saved",
        title: "Work",
        artist: "Artist",
        savedAt: 1,
        photoPath: "full.jpg",
        cropPath: savedCrop,
        cropCorners: identified,
      });
      await snapScanCrop("scan", match, owner);
      const saved = await getSavedWork("saved", owner);
      const scan = (await getPendingScan("scan", owner))!;
      const expected =
        savedCrop === "old.preview.jpg"
          ? { cropPath: scan.cropPath.replace(/\.[^.]+$/, ".preview.jpg"), cropCorners: scan.cropCorners }
          : { cropPath: savedCrop, cropCorners: identified };
      expect(saved).toMatchObject(expected);
    },
  );

  it("leaves a crop the owner edited while the snap was cutting", async () => {
    warpAndLetterbox.mockImplementationOnce(async (_path: string, corners: { x: number; y: number }[]) => {
      db.update(pendingScans).set({ cropPath: "edited.jpg" }).run();
      return { cropPath: "/tmp/snapped-model.png", contentBounds: geometry.contentBounds, usedQuad: corners };
    });
    await snapScanCrop("scan", match, owner);
    expect((await getPendingScan("scan"))?.cropPath).toBe("edited.jpg");
    expect([...mockFiles].filter((uri) => uri.includes("new-crop-id"))).toEqual([]);
    expect(mockFiles.has("file:///documents/old.jpg")).toBe(true);
  });
});
