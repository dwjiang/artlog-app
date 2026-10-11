import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkPhotos, pendingScans, savedWorks } from "@/db/schema";
import { syncArtworkAlbums } from "@/lib/account/album-sync";
import { syncCollectionPhotos } from "@/lib/account/photo-sync";

import type { Id } from "../../../convex/_generated/dataModel";
import { saveArtworkSession } from "./artwork-album";
import { enqueuePendingScan, getPendingScan, pendingScansQuery } from "./pending-scans";
import { pendingSavedRecognition } from "./saved-recognition";
import * as repository from "./saved-works";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const mockRemove = jest.fn();
jest.mock("@/lib/account/photo-transfer", () => ({
  removePhotoFile: (path: string) => mockRemove(path),
  uploadCollectionPhoto: jest.fn(),
  downloadCollectionPhoto: jest.fn(),
}));
jest.mock("@/lib/convex-client", () => ({
  convex: {
    mutation: async () => ({ photos: [], encounters: [], saves: [], visits: [], checkpoint: 0, hasMore: false }),
  },
}));

const owner = "device:test-installation";
const context = { owner, scope: "device:scope", accountId: null, deviceId: "device" as Id<"devices"> };

beforeEach(() => {
  db.delete(artworkPhotos).run();
  db.delete(savedWorks).run();
  db.delete(pendingScans).run();
  mockRemove.mockReset();
});

async function savedCapture() {
  await enqueuePendingScan({
    localId: "capture",
    photoPath: "photos/original.jpg",
    cropPath: "crops/model.jpg",
    labelPhotoPath: "labels/label.jpg",
    vector: [1],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "model",
    attemptModelVersion: "model",
    capturedAt: 1,
    createdAt: 1,
  });
  saveArtworkSession(
    "work",
    {
      localId: "work",
      title: "Water Lilies",
      artist: "Monet",
      savedAt: 1,
      photoPath: "photos/original.jpg",
      cropPath: "crops/model.preview.jpg",
    },
    [{ localId: "capture", savedLocalId: "work", kind: "full", capturedAt: 1, path: "photos/original.jpg" }],
    undefined,
    owner,
  );
}

it("removes a deleted artwork's original even when its saved scan still retains the recognition fingerprint", async () => {
  await savedCapture();
  await repository.softDeleteSavedWork("work", 2, owner);
  expect(pendingScansQuery(owner).all()).toEqual([]);
  const removeFile = jest.fn();

  await syncCollectionPhotos({
    ...repository,
    upload: jest.fn(),
    download: jest.fn(),
    removeFile,
  });

  expect(removeFile).toHaveBeenCalledWith("photos/original.jpg");
  expect(removeFile).toHaveBeenCalledWith("crops/model.preview.jpg");
});

it("removes the original, model crop, preview and label before retiring a deleted saved capture", async () => {
  await savedCapture();
  await repository.softDeleteSavedWork("work", 2, owner);

  await syncArtworkAlbums(context, "token", () => true);

  for (const path of ["photos/original.jpg", "crops/model.jpg", "crops/model.preview.jpg", "labels/label.jpg"]) {
    expect(mockRemove).toHaveBeenCalledWith(path);
  }
  expect(await getPendingScan("capture", owner)).toBeUndefined();
  expect(db.select().from(artworkPhotos).get()).toMatchObject({ path: null });
});

it("retries all capture cleanup after a file deletion fails, including an already-cleared album path", async () => {
  await savedCapture();
  await repository.softDeleteSavedWork("work", 2, owner);
  db.update(artworkPhotos).set({ path: null }).where(eq(artworkPhotos.localId, "capture")).run();
  mockRemove.mockImplementationOnce(() => {
    throw new Error("File could not be deleted");
  });

  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow("File could not be deleted");
  expect(await getPendingScan("capture", owner)).toBeDefined();
  mockRemove.mockReset();

  await syncArtworkAlbums(context, "token", () => true);

  expect(mockRemove).toHaveBeenCalledWith("crops/model.jpg");
  expect(mockRemove).toHaveBeenCalledWith("labels/label.jpg");
  expect(await getPendingScan("capture", owner)).toBeUndefined();
});

it("keeps a label file referenced by another live scan while retiring the deleted capture", async () => {
  await savedCapture();
  const capture = (await getPendingScan("capture", owner))!;
  await enqueuePendingScan({ ...capture, localId: "unsaved", photoPath: "other.jpg", cropPath: "other-crop.jpg" });
  await repository.softDeleteSavedWork("work", 2, owner);

  await syncArtworkAlbums(context, "token", () => true);

  expect(mockRemove).not.toHaveBeenCalledWith("labels/label.jpg");
  expect(await getPendingScan("capture", owner)).toBeUndefined();
  expect(await getPendingScan("unsaved", owner)).toBeDefined();
});

it("preserves a live artwork's shared recognition source and retires it after the last artwork is deleted", async () => {
  await savedCapture();
  saveArtworkSession(
    "other-work",
    { localId: "other-work", title: "Painting", artist: "", savedAt: 1 },
    [{ localId: "other-photo", savedLocalId: "other-work", kind: "full", capturedAt: 1, path: "photos/original.jpg" }],
    undefined,
    owner,
  );
  db.update(artworkPhotos).set({ storageId: "cloud" }).where(eq(artworkPhotos.localId, "other-photo")).run();
  await repository.softDeleteSavedWork("work", 2, owner);

  await syncArtworkAlbums(context, "token", () => true);

  expect(mockRemove).not.toHaveBeenCalled();
  expect(pendingSavedRecognition(owner)).toEqual([{ localId: "other-work", sourceLocalId: "capture" }]);
  expect(await getPendingScan("capture", owner)).toBeDefined();

  await repository.softDeleteSavedWork("other-work", 3, owner);
  await syncArtworkAlbums(context, "token", () => true);

  expect(mockRemove).toHaveBeenCalledWith("crops/model.jpg");
  expect(await getPendingScan("capture", owner)).toBeUndefined();
});

it("retires only the selected owner's capture and preserves files referenced by another account", async () => {
  await savedCapture();
  const capture = (await getPendingScan("capture", owner))!;
  const otherOwner = "account:other";
  await enqueuePendingScan({ ...capture, cropPath: "crops/other-model.jpg" }, otherOwner);
  const otherCapture = await getPendingScan("capture", otherOwner);
  await repository.softDeleteSavedWork("work", 2, owner);

  await syncArtworkAlbums(context, "token", () => true);

  expect(await getPendingScan("capture", owner)).toBeUndefined();
  expect(await getPendingScan("capture", otherOwner)).toEqual(otherCapture);
  expect(mockRemove).not.toHaveBeenCalledWith("photos/original.jpg");
  expect(mockRemove).not.toHaveBeenCalledWith("labels/label.jpg");
  expect(mockRemove).not.toHaveBeenCalledWith("crops/other-model.jpg");
  expect(mockRemove).toHaveBeenCalledWith("crops/model.jpg");
});
