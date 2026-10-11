import * as Sentry from "@sentry/react-native";

import { db } from "@/db/client";
import { editArtworkPhoto, findArtworkPhoto, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { insertSavedWork } from "@/db/repos/saved-works";
import { artworkPhotos, artworkEncounters, savedWorks, settings } from "@/db/schema";

import type { Id } from "../../../convex/_generated/dataModel";
import { syncArtworkAlbums } from "./album-sync";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-file-system", () => ({
  Paths: { document: "file:///documents" },
  File: class {
    exists = true;
  },
}));
const mockMutation = jest.fn();
const mockUpload = jest.fn();
const mockDownload = jest.fn();
const mockRemove = jest.fn();
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("./photo-transfer", () => ({
  uploadCollectionPhoto: (...args: unknown[]) => mockUpload(...args),
  downloadCollectionPhoto: (...args: unknown[]) => mockDownload(...args),
  removePhotoFile: (path: string) => mockRemove(path),
}));

const owner = "device:test-installation";
const context = {
  scope: "device:scope",
  deviceId: "device" as Id<"devices">,
  accountId: null,
  owner,
};
const photo = (localId: string, fields: Partial<typeof artworkPhotos.$inferInsert> = {}) => ({
  owner,
  localId,
  savedLocalId: "work",
  kind: "full" as const,
  capturedAt: 1,
  syncedAt: 1,
  ...fields,
});

beforeEach(async () => {
  for (const table of [artworkPhotos, artworkEncounters, savedWorks, settings]) {
    db.delete(table).run();
  }
  jest.clearAllMocks();
  mockUpload.mockReset().mockResolvedValue({ storageId: "uploaded", photoUpdatedAt: 0 });
  mockDownload.mockReset();
  mockMutation.mockResolvedValue({
    photos: [],
    encounters: [],
    saves: [],
    visits: [],
    checkpoint: 0,
    hasMore: false,
  });
  await insertSavedWork({
    localId: "work",
    title: "Lilies",
    artist: "Monet",
    savedAt: 1,
    syncedAt: 1,
  });
});

it("finishes the batch when one photo transfer fails, then rethrows so the queue retries", async () => {
  db.insert(artworkPhotos)
    .values([
      photo("broken", { path: "gone.jpg" }),
      photo("fine", { path: "fine.jpg" }),
      photo("remote", { storageId: "cloud" as string }),
    ])
    .run();
  mockUpload.mockImplementation(async (_token, _scope, _saveId, _kind, path) => {
    if (path === "gone.jpg") throw new Error("missing file");
    return { storageId: "uploaded", photoUpdatedAt: 0 };
  });
  mockDownload.mockResolvedValue("collection-photos/remote.jpg");
  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow("missing file");
  const rows = Object.fromEntries(
    selectArtworkPhotos("work")
      .all()
      .map((row) => [row.localId, row]),
  );
  expect(rows.fine).toMatchObject({ storageId: "uploaded" });
  expect(rows.remote).toMatchObject({ path: "collection-photos/remote.jpg" });
  expect(rows.broken).toMatchObject({ storageId: null });
});

it("reaches healthy album photos beyond a full batch of failures on every retry", async () => {
  db.insert(artworkPhotos)
    .values(Array.from({ length: 21 }, (_, index) => photo(String(index).padStart(2, "0"), { path: `${index}.jpg` })))
    .run();
  mockUpload.mockImplementation(async (_token, _scope, _saveId, _kind, path) => {
    if (path !== "20.jpg") throw new Error("missing image");
    return { storageId: "uploaded", photoUpdatedAt: 0 };
  });

  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow("missing image");
  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow("missing image");

  expect(
    selectArtworkPhotos("work")
      .all()
      .find((row) => row.localId === "20"),
  ).toMatchObject({
    storageId: "uploaded",
  });
  expect(mockUpload.mock.calls.filter(([, , , , path]) => path === "20.jpg")).toHaveLength(1);
});

it.each(["Network request failed", "Photo upload failed with HTTP 429"])(
  "stops the album sweep after %s before attempting the remaining backlog",
  async (message) => {
    db.insert(artworkPhotos)
      .values(Array.from({ length: 21 }, (_, index) => photo(String(index).padStart(2, "0"), { path: `${index}.jpg` })))
      .run();
    mockUpload.mockRejectedValue(new Error(message));

    await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow(message);

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(findArtworkPhoto("20")).toMatchObject({ storageId: null });
  },
);

it("removes the files of deleted album photos unless a live row still uses them", async () => {
  await insertSavedWork({
    localId: "kept",
    title: "Kept",
    artist: "",
    savedAt: 1,
    syncedAt: 1,
    photoPath: "artwork-photos/seed.jpg",
  });
  db.insert(artworkPhotos)
    .values([
      photo("orphan", { path: "artwork-photos/orphan.jpg", deletedAt: 5 }),
      photo("seed", { path: "artwork-photos/seed.jpg", deletedAt: 5 }),
      photo("live", {
        path: "artwork-photos/live.jpg",
        storageId: "cloud" as string,
      }),
    ])
    .run();
  await syncArtworkAlbums(context, "token", () => true);
  expect(mockRemove.mock.calls).toEqual([["artwork-photos/orphan.jpg"]]);
  const paths = db.select({ localId: artworkPhotos.localId, path: artworkPhotos.path }).from(artworkPhotos).all();
  expect(paths).toEqual(
    expect.arrayContaining([
      { localId: "orphan", path: null },
      { localId: "seed", path: null },
      { localId: "live", path: "artwork-photos/live.jpg" },
    ]),
  );
});

it("discards a download completed after the account changes", async () => {
  let active = true;
  db.insert(artworkPhotos)
    .values(photo("remote", { storageId: "cloud" }))
    .run();
  mockDownload.mockImplementationOnce(async () => {
    active = false;
    return "collection-photos/old-account.jpg";
  });

  await syncArtworkAlbums(context, "token", () => active);

  expect(findArtworkPhoto("remote")).toMatchObject({ path: null, storageId: "cloud" });
  expect(mockRemove).toHaveBeenCalledWith("collection-photos/old-account.jpg");
});

it("does not acknowledge an upload completed after the account changes", async () => {
  let active = true;
  db.insert(artworkPhotos)
    .values(photo("local", { path: "original.jpg" }))
    .run();
  mockUpload.mockImplementationOnce(async () => {
    active = false;
    return { storageId: "cloud", photoUpdatedAt: 0 };
  });

  await syncArtworkAlbums(context, "token", () => active);

  expect(findArtworkPhoto("local")).toMatchObject({ path: "original.jpg", storageId: null });
});

it("discards a download when its album photo is deleted during transfer", async () => {
  db.insert(artworkPhotos)
    .values(photo("remote", { storageId: "cloud" }))
    .run();
  mockDownload.mockImplementationOnce(async () => {
    editArtworkPhoto("remote", { deletedAt: 2 });
    return "collection-photos/deleted.jpg";
  });

  await syncArtworkAlbums(context, "token", () => true);

  expect(findArtworkPhoto("remote")).toMatchObject({ path: null, deletedAt: 2, syncedAt: null });
  expect(mockRemove).toHaveBeenCalledWith("collection-photos/deleted.jpg");
});

it("reports an album transfer failure before a later offline error while preserving the batch retry", async () => {
  db.insert(artworkPhotos)
    .values([photo("first", { path: "first.jpg" }), photo("second", { path: "second.jpg" })])
    .run();
  const corrupt = new Error("Album decoder could not read the saved image");
  const offline = new Error("Network request failed");
  mockUpload.mockRejectedValueOnce(corrupt).mockRejectedValueOnce(offline);
  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toBe(offline);
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: corrupt.message }),
    expect.objectContaining({
      tags: { operation: "sync.photos" },
      contexts: { operation: { kind: "album", direction: "upload" } },
    }),
  );
  expect(
    selectArtworkPhotos("work")
      .all()
      .every((row) => row.storageId === null),
  ).toBe(true);
});
