import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkEncounters, artworkPhotos, savedWorks, visits } from "@/db/schema";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  acknowledgeAlbum,
  applyAlbum,
  pendingAlbum,
  selectArtworkEncounters,
  selectArtworkPhotos,
} from "./artwork-album";
import { insertSavedWork, isPhotoFileReferenced, softDeleteSavedWork } from "./saved-works";
import { upsertVisit } from "./visits";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const owner = "device:test-installation";
const deviceId = "device" as Id<"devices">;
const workId = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342";
const visitId = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341";

beforeEach(async () => {
  await db.delete(artworkPhotos);
  await db.delete(artworkEncounters);
  await db.delete(savedWorks);
  await db.delete(visits);
});

it("keeps a deleted artwork's photos and encounters deleted when its pre-delete upload returns", async () => {
  await upsertVisit({
    localId: visitId,
    venueId: "museum" as Id<"museums">,
    venueName: "Museum",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  });
  await insertSavedWork({
    localId: workId,
    title: "Water Lilies",
    artist: "Monet",
    savedAt: 1,
    photoPath: "original.jpg",
    venueId: "museum" as Id<"museums">,
    visitLocalId: visitId,
  });
  const pending = pendingAlbum(owner);
  const photo: Doc<"artworkPhotos"> = {
    _id: "photo" as Id<"artworkPhotos">,
    _creationTime: 1,
    owner: { kind: "device", deviceId },
    localId: workId,
    savedLocalId: workId,
    saveId: "saved" as Id<"collections">,
    visitLocalId: visitId,
    kind: "full",
    capturedAt: 1,
    updatedAt: 2,
    changeVersion: 1,
  };
  const encounter: Doc<"artworkEncounters"> = {
    _id: "encounter" as Id<"artworkEncounters">,
    _creationTime: 1,
    owner: photo.owner,
    savedLocalId: workId,
    saveId: photo.saveId,
    visitLocalId: visitId,
    visitId: "visit" as Id<"visits">,
    updatedAt: 2,
    changeVersion: 2,
  };

  await softDeleteSavedWork(workId, 3, owner);
  expect(selectArtworkPhotos(workId, owner).all()).toEqual([]);
  expect(selectArtworkEncounters(owner).all()).toEqual([]);
  acknowledgeAlbum(pending, owner);
  applyAlbum([photo], [encounter], owner);

  expect(selectArtworkPhotos(workId, owner).all()).toEqual([]);
  expect(selectArtworkEncounters(owner).all()).toEqual([]);
  expect(await isPhotoFileReferenced("original.jpg")).toBe(false);
});

it("rolls back the artwork tombstone when deleting its photo rows fails", async () => {
  await insertSavedWork({
    localId: workId,
    title: "Water Lilies",
    artist: "Monet",
    savedAt: 1,
    photoPath: "original.jpg",
  });
  const beforeWorks = db.select().from(savedWorks).all();
  const beforePhotos = db.select().from(artworkPhotos).all();
  db.run(sql`CREATE TEMP TRIGGER fail_photo_delete BEFORE UPDATE ON artworkPhotos
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END`);
  try {
    await expect(softDeleteSavedWork(workId, 3, owner)).rejects.toThrow("storage failure");
    expect(db.select().from(savedWorks).all()).toEqual(beforeWorks);
    expect(db.select().from(artworkPhotos).all()).toEqual(beforePhotos);
  } finally {
    db.run(sql`DROP TRIGGER fail_photo_delete`);
  }
});
