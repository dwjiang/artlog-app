import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";

import { migrateDatabase } from "@/db/migrate-database";
import migrations from "@/db/migrations/migrations";
import { albumMediaPending, pendingAlbum, selectArtworkPhotos } from "@/db/repos/artwork-album";
import * as schema from "@/db/schema";

import type { Id } from "../../../convex/_generated/dataModel";
import { syncArtworkAlbums } from "./album-sync";

let mockDb: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/db/client", () => ({
  get db() {
    return mockDb;
  },
}));
const mockMutation = jest.fn();
const mockDownload = jest.fn();
const mockUpload = jest.fn();
const mockFiles = new Set<string>();
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock("./photo-transfer", () => ({
  downloadCollectionPhoto: (...args: unknown[]) => mockDownload(...args),
  uploadCollectionPhoto: (...args: unknown[]) => mockUpload(...args),
  removePhotoFile: jest.fn(),
}));
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

const owner = "account:person";
const context = { owner, scope: "scope", accountId: "person" as Id<"accounts">, deviceId: "device" as Id<"devices"> };
const workId = "11111111-1111-4111-8111-111111111111";
const photoId = "22222222-2222-4222-8222-222222222222";
const empty = { photos: [], encounters: [], saves: [], visits: [], checkpoint: 0, hasMore: false };
const original = {
  _id: "remote-photo",
  _creationTime: 100,
  owner: { kind: "account", accountId: "person" },
  localId: photoId,
  savedLocalId: workId,
  saveId: "remote-save",
  kind: "full",
  capturedAt: 100,
  updatedAt: 200,
  changeVersion: 2,
  storageId: "original-file",
};
let sqlite: Database.Database;

beforeEach(async () => {
  jest.clearAllMocks();
  mockFiles.clear();
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  mockDb = drizzle(sqlite, { schema });
  await migrate(mockDb as unknown as Parameters<typeof migrate>[0], {
    ...migrations,
    journal: { entries: migrations.journal.entries.filter(({ idx }) => idx <= 8) },
  });
  mockMutation.mockResolvedValue(empty);
  mockDownload.mockImplementation(async () => {
    mockFiles.add("file:///documents/recovered.jpg");
    return "recovered.jpg";
  });
  mockUpload.mockResolvedValue({ storageId: "uploaded-file", photoUpdatedAt: 0 });
});
afterEach(() => sqlite.close());

async function upgrade() {
  for (const journalOwner of [owner, "account:other"]) {
    sqlite
      .prepare(`INSERT INTO savedWorks (owner, localId, title, artist, savedAt, cropStorageId, syncedAt)
      VALUES (?, ?, 'Painting', 'Artist', 100, 'crop-file', 200)`)
      .run(journalOwner, workId);
  }
  await migrateDatabase(mockDb as unknown as Parameters<typeof migrateDatabase>[0], "installation");
}

it.each([undefined, 300])(
  "pulls every album page before deciding whether to recover a remote photo with deletedAt %s",
  async (deletedAt) => {
    await upgrade();
    expect(pendingAlbum(owner).photos).toEqual([]);
    expect(albumMediaPending(owner, { saveLocalIds: [workId] })).toBe(true);
    mockMutation.mockResolvedValueOnce({ ...empty, checkpoint: 1, hasMore: true });
    mockMutation.mockResolvedValueOnce({ ...empty, photos: [{ ...original, deletedAt }], checkpoint: 2 });
    mockMutation.mockResolvedValue({ ...empty, checkpoint: 2 });

    await syncArtworkAlbums(context, "token", () => true);

    expect(mockMutation.mock.calls.every(([, args]) => args.photos.length === 0)).toBe(true);
    expect(
      selectArtworkPhotos(workId, owner)
        .all()
        .map(({ localId }) => localId),
    ).toEqual(deletedAt ? [] : [photoId]);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(albumMediaPending(owner, { saveLocalIds: [workId] })).toBe(false);
    expect(albumMediaPending("account:other", { saveLocalIds: [workId] })).toBe(true);
  },
);

it("keeps recovery deferred across an interrupted album download and resumes from its checkpoint", async () => {
  await upgrade();
  mockMutation.mockResolvedValueOnce({ ...empty, checkpoint: 1, hasMore: true });
  mockMutation.mockRejectedValueOnce(new Error("Network request failed"));
  await expect(syncArtworkAlbums(context, "token", () => true)).rejects.toThrow("Network request failed");
  expect(pendingAlbum(owner).photos).toEqual([]);
  expect(albumMediaPending(owner, { saveLocalIds: [workId] })).toBe(true);
  mockMutation.mockResolvedValueOnce({ ...empty, photos: [original], checkpoint: 2 });
  mockMutation.mockResolvedValue({ ...empty, checkpoint: 2 });

  await syncArtworkAlbums(context, "token", () => true);

  expect(mockMutation.mock.calls[2][1]).toMatchObject({ since: 1, photos: [] });
  expect(
    selectArtworkPhotos(workId, owner)
      .all()
      .map(({ localId }) => localId),
  ).toEqual([photoId]);
  expect(mockUpload).not.toHaveBeenCalled();
});

it("recovers a genuine legacy crop only after confirming the server album is empty", async () => {
  await upgrade();
  mockMutation.mockImplementation(async (_function, args) => ({
    ...empty,
    photos: args.photos.map((photo: { localId: string }) => ({ ...original, ...photo, storageId: undefined })),
  }));

  await syncArtworkAlbums(context, "token", () => true);

  expect(mockMutation.mock.calls[0][1].photos).toEqual([]);
  expect(mockMutation.mock.calls[1][1].photos).toEqual([
    expect.objectContaining({ localId: workId, savedLocalId: workId }),
  ]);
  expect(selectArtworkPhotos(workId, owner).all()).toEqual([
    expect.objectContaining({
      localId: workId,
      path: "recovered.jpg",
      storageId: "uploaded-file",
      recoveryStorageId: null,
    }),
  ]);
  expect(mockDownload).toHaveBeenCalledWith("token", "scope", workId, "crop", "crop-file", undefined);
});

it("retains deferred recovery if the account changes during the album pull", async () => {
  await upgrade();
  let current = true;
  mockMutation.mockImplementationOnce(async () => {
    current = false;
    return { ...empty, photos: [original], checkpoint: 2 };
  });

  await syncArtworkAlbums(context, "token", () => current);

  expect(albumMediaPending(owner, { saveLocalIds: [workId] })).toBe(true);
  expect(selectArtworkPhotos(workId, owner).all()).toEqual([]);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});
