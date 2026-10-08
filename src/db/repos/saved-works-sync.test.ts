import { db } from "@/db/client";
import { savedWorks } from "@/db/schema";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import * as repo from "./saved-works";
import { editSavedWork } from "./saved-works";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const deviceId = "this-device" as Id<"devices">;
const remote: Doc<"collections"> = {
  _id: "collection-1" as Id<"collections">,
  _creationTime: 1,
  owner: { kind: "device", deviceId: "sibling" as Id<"devices"> },
  changeVersion: 1,
  localId: "work",
  savedAt: 1,
  updatedAt: 10,
  updatedBy: "sibling" as Id<"devices">,
  snapshot: { title: "Water Lilies", artist: "Monet", institution: "Museum" },
};
beforeEach(async () => {
  await db.delete(savedWorks);
});

it("imports metadata without a photo, then deduplicates a replay", async () => {
  await repo.upsertFromRemote([remote]);
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toHaveLength(1);
  expect(await repo.getSavedWork("work")).toMatchObject({
    title: "Water Lilies",
    institution: "Museum",
    photoPath: null,
    cropPath: null,
    syncedAt: 10,
    syncedBy: "sibling",
  });
  expect(await repo.listUnsynced()).toEqual([]);
});

it("imports the crop source before its album photo is downloaded and clears a removed source", async () => {
  const crop = { ...remote, cropStorageId: "crop" as Id<"files">, cropPhotoLocalId: "source-photo", photoUpdatedAt: 1 };
  await repo.upsertFromRemote([crop]);
  expect(await repo.getSavedWork("work")).toMatchObject({ cropPhotoLocalId: "source-photo", cropPath: null });
  await repo.updatePhotoTransfer("work", { cropPath: "crop.jpg" });
  await repo.upsertFromRemote([
    { ...crop, cropStorageId: "unlinked-crop" as Id<"files">, cropPhotoLocalId: undefined, photoUpdatedAt: 2 },
  ]);
  expect(await repo.getSavedWork("work")).toMatchObject({ cropPhotoLocalId: null, cropPath: null });
});

it("keeps local photos while receiving artwork details edited on another device", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Original",
    artist: "Artist",
    savedAt: 1,
    photoPath: "photo.jpg",
    cropPath: "crop.jpg",
    syncedAt: 1,
  });
  await repo.upsertFromRemote([{ ...remote, updatedBy: deviceId }]);
  expect(await repo.getSavedWork("work")).toMatchObject({
    title: "Water Lilies",
    photoPath: "photo.jpg",
    cropPath: "crop.jpg",
    syncedAt: 10,
  });
});

it("clears a date, medium, or institution removed on another device", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Original",
    artist: "Artist",
    date: "1906",
    medium: "Oil",
    institution: "Museum",
    savedAt: 1,
    syncedAt: 1,
  });
  await repo.upsertFromRemote([{ ...remote, snapshot: { title: "Water Lilies", artist: "Monet" } }]);
  expect(await repo.getSavedWork("work")).toMatchObject({
    title: "Water Lilies",
    date: null,
    medium: null,
    institution: null,
    syncedAt: 10,
  });
});

it("keeps an in-flight edit dirty even if the old upload is acknowledged", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "Artist",
    savedAt: 1,
  });
  const [pending] = await repo.listUnsynced();
  editSavedWork("work", { title: "Newer title", artist: "Artist", date: null, medium: null });
  await repo.markSynced([
    {
      localId: "work",
      revision: pending.revision,
      updatedAt: 20,
      updatedBy: deviceId,
    },
  ]);
  await repo.upsertFromRemote([{ ...remote, updatedBy: deviceId }]);
  expect(await repo.listUnsynced()).toMatchObject([
    { localId: "work", title: "Newer title", syncedAt: null, revision: 1 },
  ]);
});

it("queues deletion after sync and never resurrects a deleted row on remote replay", async () => {
  await repo.upsertFromRemote([remote]);
  await repo.softDeleteSavedWork("work", 12);
  const [pending] = await repo.listUnsynced();
  expect(pending.deletedAt).toBe(12);
  await repo.markSynced([
    {
      localId: pending.localId,
      revision: pending.revision,
      updatedAt: 20,
      updatedBy: deviceId,
    },
  ]);
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toEqual([]);
});

it("applies a server deletion when uploading a stale local edit", async () => {
  await repo.upsertFromRemote([remote]);
  editSavedWork("work", { title: "Offline title", artist: "Monet", date: null, medium: null });
  const [pending] = await repo.listUnsynced();
  await repo.markSynced([
    {
      localId: pending.localId,
      revision: pending.revision,
      updatedAt: 20,
      updatedBy: deviceId,
      deletedAt: 15,
    },
  ]);
  expect(await repo.listSavedWorks()).toEqual([]);
  expect(await repo.getSavedWork(pending.localId)).toMatchObject({
    deletedAt: 15,
    syncedAt: 20,
  });
});

it("keeps one save when another device returns a copy of the same work", async () => {
  await repo.insertSavedWork({
    localId: remote.localId,
    title: "Original",
    artist: "Artist",
    savedAt: 1,
    photoPath: "photo.jpg",
    syncedAt: 1,
  });
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toHaveLength(1);
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({
    title: "Water Lilies",
    photoPath: "photo.jpg",
  });
});

it("applies remote deletion while a local edit is pending", async () => {
  await repo.upsertFromRemote([remote]);
  const [saved] = await repo.listSavedWorks();
  editSavedWork(saved.localId, { title: "Offline edit", artist: "Monet", date: null, medium: null });
  await repo.upsertFromRemote([{ ...remote, updatedAt: 20, deletedAt: 20 }]);
  expect(await repo.listSavedWorks()).toEqual([]);
  expect(await repo.listUnsynced()).toMatchObject([{ deletedAt: 20, title: "Offline edit" }]);
});

it.each([
  ["a", "z"],
  ["z", "a"],
])("merges simultaneous edits consistently in %s then %s order", async (first, second) => {
  for (const author of [first, second]) {
    await repo.upsertFromRemote([
      { ...remote, updatedBy: author as Id<"devices">, snapshot: { ...remote.snapshot, title: author } },
    ]);
  }
  expect((await repo.getSavedWork(remote.localId))?.title).toBe("z");
});

it("does not move the confirmed version backward when an older upload response arrives", async () => {
  await repo.upsertFromRemote([{ ...remote, updatedAt: 30, snapshot: { ...remote.snapshot, title: "Latest title" } }]);
  await repo.markSynced([
    {
      localId: remote.localId,
      revision: 0,
      updatedAt: 10,
      updatedBy: deviceId,
    },
  ]);
  await repo.upsertFromRemote([{ ...remote, updatedAt: 20, snapshot: { ...remote.snapshot, title: "Older title" } }]);
  expect((await repo.getSavedWork(remote.localId))?.title).toBe("Latest title");
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({
    syncedAt: 30,
  });
});

it("accepts an image reference without replacing a newer local edit or original photo", async () => {
  await repo.insertSavedWork({
    localId: remote.localId,
    title: "Painting",
    artist: "",
    savedAt: 1,
    photoPath: "original.heic",
  });
  editSavedWork(remote.localId, { title: "Still uploading", artist: "", date: null, medium: null });
  const cropStorageId = "cloud-crop" as Id<"files">;
  await repo.upsertFromRemote([{ ...remote, cropStorageId }]);
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({
    title: "Still uploading",
    photoPath: "original.heic",
    cropStorageId,
    syncedAt: null,
  });
});

it("downloads a newer remote crop independently of edit stamps, reports the displaced file, and ignores older crop replays", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    cropPath: "old.jpg",
    cropStorageId: "old" as Id<"files">,
    photoUpdatedAt: 1,
    syncedAt: 100,
  });
  expect(await repo.upsertFromRemote([{ ...remote, cropStorageId: "new" as Id<"files">, photoUpdatedAt: 3 }])).toEqual([
    "old.jpg",
  ]);
  expect(await repo.getSavedWork("work")).toMatchObject({
    cropPath: null,
    cropStorageId: "new" as Id<"files">,
    photoUpdatedAt: 3,
    syncedAt: 100,
  });
  await repo.updatePhotoTransfer("work", { cropPath: "new.jpg" });
  expect(await repo.upsertFromRemote([{ ...remote, cropStorageId: "old" as Id<"files">, photoUpdatedAt: 2 }])).toEqual(
    [],
  );
  expect(await repo.getSavedWork("work")).toMatchObject({
    cropPath: "new.jpg",
    cropStorageId: "new" as Id<"files">,
  });
  expect(await repo.upsertFromRemote([{ ...remote, cropStorageId: "new" as Id<"files">, photoUpdatedAt: 3 }])).toEqual(
    [],
  );
});

it("keeps a local crop awaiting upload when remote sync still contains the previous crop", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Painting",
    artist: "",
    savedAt: 1,
    cropPath: "old.jpg",
    cropStorageId: "old" as Id<"files">,
    photoPath: "source.jpg",
  });
  repo.replaceSavedCrop("work", "edited.jpg", null, "source.jpg");
  await repo.upsertFromRemote([
    { ...remote, cropStorageId: "old" as Id<"files">, cropPhotoLocalId: "other-photo", photoUpdatedAt: 100 },
  ]);
  expect(await repo.getSavedWork("work")).toMatchObject({
    cropPath: "edited.jpg",
    cropPhotoLocalId: "work",
    cropStorageId: null,
  });
});

it("takes the server's museum for a save moved with its visit, even while a local edit is pending", async () => {
  await repo.insertSavedWork({
    localId: "work",
    title: "Water Lilies",
    artist: "Monet",
    savedAt: 1,
    venueId: "old-museum" as Id<"museums">,
    venueName: "Old Museum",
  });
  editSavedWork("work", { title: "Pending here", artist: "Monet", date: null, medium: null });
  const moved = { ...remote, venueId: "new-museum" as Id<"museums">, venueName: "New Museum", updatedAt: 1 };
  await repo.upsertFromRemote([moved]);
  expect(await repo.getSavedWork("work")).toMatchObject({
    venueId: "new-museum",
    venueName: "New Museum",
    title: "Pending here",
    syncedAt: null,
  });
});
