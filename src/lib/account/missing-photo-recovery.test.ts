import { db } from "@/db/client";
import { findArtworkPhoto } from "@/db/repos/artwork-album";
import * as saved from "@/db/repos/saved-works";
import { artworkPhotos, savedWorks, settings } from "@/db/schema";

import type { Id } from "../../../convex/_generated/dataModel";
import { syncArtworkAlbums } from "./album-sync";
import { syncCollectionPhotos } from "./photo-sync";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const mockFiles = new Set<string>();
const mockMutation = jest.fn();
const mockUpload = jest.fn();
const mockDownload = jest.fn();
const mockRemove = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  File: class {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
  },
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("./photo-transfer", () => ({
  uploadCollectionPhoto: (...args: unknown[]) => mockUpload(...args),
  downloadCollectionPhoto: (...args: unknown[]) => mockDownload(...args),
  removePhotoFile: (...args: unknown[]) => mockRemove(...args),
}));

const owner = "device:test-installation";
const context = { owner, scope: "scope", deviceId: "device" as Id<"devices">, accountId: null };
const deps = { ...saved, upload: mockUpload, download: mockDownload, removeFile: mockRemove };

beforeEach(() => {
  db.delete(savedWorks).run();
  db.delete(settings).run();
  jest.clearAllMocks();
  mockFiles.clear();
  mockMutation.mockResolvedValue({
    photos: [],
    encounters: [],
    saves: [],
    visits: [],
    checkpoint: 0,
    hasMore: false,
  });
  mockDownload.mockImplementation(async () => {
    const path = "collection-photos/recovered.jpg";
    mockFiles.add(`file:///documents/${path}`);
    return path;
  });
});

function savedWork(fields: Partial<typeof savedWorks.$inferInsert> = {}) {
  db.insert(savedWorks)
    .values({ owner, localId: "water-lilies", title: "Water Lilies", artist: "Claude Monet", savedAt: 123, ...fields })
    .run();
}

it("downloads a backed-up crop whose old local path survived but whose file is missing", async () => {
  savedWork({ cropPath: "crops/old.jpg", cropStorageId: "cloud-crop", photoUpdatedAt: 40 });

  await syncCollectionPhotos(deps);
  await syncCollectionPhotos(deps);

  expect(mockDownload.mock.calls).toEqual([["water-lilies", "crop", "cloud-crop"]]);
  expect(await saved.getSavedWork("water-lilies")).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    savedAt: 123,
    cropPath: "collection-photos/recovered.jpg",
    cropStorageId: "cloud-crop",
    photoUpdatedAt: 40,
  });
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it("downloads a backed-up album photo after its file disappears and leaves its identity and caption intact", async () => {
  savedWork();
  db.insert(artworkPhotos)
    .values({
      owner,
      localId: "gallery-detail",
      savedLocalId: "water-lilies",
      kind: "detail",
      capturedAt: 100,
      caption: "Brushwork in the lower corner",
      path: "artwork-photos/missing.jpg",
      storageId: "cloud-detail",
      syncedAt: 200,
      revision: 3,
    })
    .run();

  await syncArtworkAlbums(context, "token", () => true);
  await syncArtworkAlbums(context, "token", () => true);

  expect(mockDownload.mock.calls).toEqual([
    ["token", "scope", "water-lilies", "photo", "cloud-detail", "gallery-detail"],
  ]);
  expect(findArtworkPhoto("gallery-detail", owner)).toMatchObject({
    localId: "gallery-detail",
    kind: "detail",
    capturedAt: 100,
    caption: "Brushwork in the lower corner",
    path: "collection-photos/recovered.jpg",
    storageId: "cloud-detail",
    syncedAt: 200,
    revision: 3,
  });
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it("keeps existing backed-up photos and preserves the only reference when no backup exists", async () => {
  savedWork({ cropPath: "crops/available.jpg", cropStorageId: "cloud-crop" });
  mockFiles.add("file:///documents/crops/available.jpg");
  await syncCollectionPhotos(deps);
  expect(mockDownload).not.toHaveBeenCalled();
  expect((await saved.getSavedWork("water-lilies"))?.cropPath).toBe("crops/available.jpg");

  db.delete(savedWorks).run();
  savedWork({ cropPath: "crops/only-copy.jpg" });
  mockUpload.mockRejectedValueOnce(new Error("File not found"));
  await expect(syncCollectionPhotos(deps)).rejects.toThrow("File not found");
  expect((await saved.getSavedWork("water-lilies"))?.cropPath).toBe("crops/only-copy.jpg");
  expect(mockRemove).not.toHaveBeenCalled();
});

it("retains an unconfirmed cloud original without requesting an empty album, then recovers when confirmed", async () => {
  savedWork();
  db.insert(artworkPhotos)
    .values({
      owner,
      localId: "legacy-photo",
      savedLocalId: "water-lilies",
      kind: "full",
      capturedAt: 100,
      storageId: "legacy-cloud-original",
    })
    .run();
  const remote = {
    _id: "remote-photo",
    _creationTime: 100,
    owner: { kind: "device", deviceId: "device" },
    localId: "legacy-photo",
    savedLocalId: "water-lilies",
    saveId: "remote-save",
    kind: "full",
    capturedAt: 100,
    updatedAt: 200,
    changeVersion: 1,
  };
  mockMutation.mockResolvedValue({
    photos: [remote],
    encounters: [],
    saves: [],
    visits: [],
    checkpoint: 1,
    hasMore: false,
  });
  await syncArtworkAlbums(context, "token", () => true);
  await syncArtworkAlbums(context, "token", () => true);
  expect(mockDownload).not.toHaveBeenCalled();
  expect(findArtworkPhoto("legacy-photo", owner)).toMatchObject({
    path: null,
    storageId: null,
    recoveryStorageId: "legacy-cloud-original",
  });

  mockMutation.mockResolvedValue({
    photos: [{ ...remote, storageId: "confirmed-cloud-original", changeVersion: 2 }],
    encounters: [],
    saves: [],
    visits: [],
    checkpoint: 2,
    hasMore: false,
  });
  await syncArtworkAlbums(context, "token", () => true);
  expect(findArtworkPhoto("legacy-photo", owner)).toMatchObject({
    path: "collection-photos/recovered.jpg",
    storageId: "confirmed-cloud-original",
    recoveryStorageId: null,
  });
  expect(mockUpload).not.toHaveBeenCalled();
});

it.each([null, "photos/missing.jpg"])(
  "transfers healthy photos past a full batch of unconfirmed legacy originals with path %s",
  async (path) => {
    savedWork();
    db.insert(artworkPhotos)
      .values([
        ...Array.from({ length: 25 }, (_, index) => ({
          owner,
          localId: `legacy-${index}`,
          savedLocalId: "water-lilies",
          kind: "full" as const,
          capturedAt: index,
          path,
          recoveryStorageId: `old-cloud-${index}`,
          syncedAt: 200,
        })),
        {
          owner,
          localId: "healthy",
          savedLocalId: "water-lilies",
          kind: "full" as const,
          capturedAt: 100,
          storageId: "confirmed-cloud",
          syncedAt: 200,
        },
      ])
      .run();
    mockDownload.mockImplementation(async (_token, _scope, _save, _kind, storageId) => {
      if (storageId !== "confirmed-cloud") throw new Error("Photo download failed with HTTP 404");
      const downloaded = "collection-photos/healthy.jpg";
      mockFiles.add(`file:///documents/${downloaded}`);
      return downloaded;
    });

    await syncArtworkAlbums(context, "token", () => true);

    expect(mockDownload.mock.calls).toEqual([
      ["token", "scope", "water-lilies", "photo", "confirmed-cloud", "healthy"],
    ]);
    expect(findArtworkPhoto("healthy", owner)?.path).toBe("collection-photos/healthy.jpg");
    expect(findArtworkPhoto("legacy-0", owner)).toMatchObject({ path, recoveryStorageId: "old-cloud-0" });
    expect(mockUpload).not.toHaveBeenCalled();
  },
);

it.each(["local-original", "cloud-crop"])(
  "backs up a migrated %s when the album server has no file yet",
  async (source) => {
    const localPath = source === "local-original" ? "photos/original.jpg" : null;
    savedWork({ cropStorageId: source === "cloud-crop" ? "legacy-cloud" : null });
    if (localPath) mockFiles.add(`file:///documents/${localPath}`);
    db.insert(artworkPhotos)
      .values({
        owner,
        localId: "legacy",
        savedLocalId: "water-lilies",
        kind: "full",
        capturedAt: 100,
        path: localPath,
        storageId: "legacy-cloud",
      })
      .run();
    let storageId: string | undefined;
    mockMutation.mockImplementation(async () => ({
      photos: [
        {
          _id: "remote-photo",
          _creationTime: 100,
          owner: { kind: "device", deviceId: "device" },
          localId: "legacy",
          savedLocalId: "water-lilies",
          saveId: "remote-save",
          kind: "full",
          capturedAt: 100,
          updatedAt: 200,
          changeVersion: 1,
          storageId,
        },
      ],
      encounters: [],
      saves: [],
      visits: [],
      checkpoint: 1,
      hasMore: false,
    }));
    mockUpload.mockImplementation(async () => {
      storageId = "confirmed-album-file";
      return { storageId, photoUpdatedAt: 0 };
    });

    await syncArtworkAlbums(context, "token", () => true);
    await syncArtworkAlbums(context, "token", () => true);

    expect(findArtworkPhoto("legacy", owner)).toMatchObject({
      path: localPath ?? "collection-photos/recovered.jpg",
      storageId: "confirmed-album-file",
      recoveryStorageId: null,
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const expectedDownloads =
      source === "cloud-crop" ? [["token", "scope", "water-lilies", "crop", "legacy-cloud", undefined]] : [];
    expect(mockDownload.mock.calls).toEqual(expectedDownloads);
  },
);
