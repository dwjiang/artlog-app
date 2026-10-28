import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkPhotos } from "@/db/schema";

import {
  albumMediaPending,
  saveArtworkSession,
  addArtworkPhoto,
  editArtworkPhoto,
  linkArtworkVisit,
  linkArtworkVisits,
  linkArtworksVisit,
  pendingAlbum,
  selectArtworkEncounters,
  selectArtworkPhotos,
  selectVisitArtworkPhotos,
  unlinkArtworkVisit,
} from "./artwork-album";
import { createJournalRepository } from "./journal";
import { insertSavedWork, softDeleteSavedWork, selectSavedWork } from "./saved-works";
import { discardVisit, upsertVisit } from "./visits";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async () => [],
}));
const owner = "device:test-installation";
beforeAll(async () => {
  await upsertVisit({
    localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341",
    venueId: "museum" as never,
    venueName: "Museum",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  });
  await upsertVisit({
    localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342",
    venueId: "museum" as never,
    venueName: "Museum",
    visitedOn: "2026-09-02",
    timeZone: "UTC",
  });
  await insertSavedWork({
    localId: "work",
    title: "Lilies",
    artist: "Monet",
    savedAt: 1,
    photoPath: "full.jpg",
    visitLocalId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341",
    venueId: "museum" as never,
  });
});

it("keeps photo kinds together and links a repeat visit only once", () => {
  addArtworkPhoto({
    localId: "detail",
    savedLocalId: "work",
    path: "detail.jpg",
    capturedAt: 2,
    kind: "detail",
    visitLocalId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342",
  });
  addArtworkPhoto({
    localId: "label",
    savedLocalId: "work",
    path: "label.jpg",
    capturedAt: 3,
    kind: "label",
    visitLocalId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342",
  });
  linkArtworkVisit("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342");
  expect(
    selectArtworkPhotos("work")
      .all()
      .map((row) => row.kind),
  ).toEqual(["full", "detail", "label"]);
  expect(selectArtworkEncounters().all()).toHaveLength(2);
});

it("scopes photos to the visit they were taken on, so a repeat visit does not inherit earlier photos", () => {
  expect(
    selectVisitArtworkPhotos("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341")
      .all()
      .map((row) => row.kind),
  ).toEqual(["full"]);
  expect(
    selectVisitArtworkPhotos("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342")
      .all()
      .map((row) => row.kind),
  ).toEqual(["detail", "label"]);
  expect(selectVisitArtworkPhotos("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342", "account:other").all()).toEqual([]);
});

it("lists the same artwork on both visits without cloning it", async () => {
  const journal = createJournalRepository(owner);
  expect((await journal.savedWorks("ab7f8f54-0af5-4ac0-8839-bc5fc00e3341")).page.map((row) => row.localId)).toEqual([
    "work",
  ]);
  expect((await journal.savedWorks("ab7f8f54-0af5-4ac0-8839-bc5fc00e3342")).page.map((row) => row.localId)).toEqual([
    "work",
  ]);
});

it("rejects foreign artwork and visit identifiers", async () => {
  await insertSavedWork({ localId: "foreign", title: "Private", artist: "", savedAt: 1 }, "account:other");
  expect(() => linkArtworkVisit("foreign", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341")).toThrow("Artwork is unavailable");
  expect(() => linkArtworkVisit("work", "foreign")).toThrow("Visit is unavailable");
  expect(selectArtworkPhotos("work", "account:other").all()).toEqual([]);
});

it("unlinking preserves photographs and the visit record", async () => {
  unlinkArtworkVisit("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342");
  expect(selectArtworkEncounters().all()).toHaveLength(1);
  expect(selectArtworkPhotos("work").all()).toHaveLength(3);
  expect(await createJournalRepository(owner).detail("ab7f8f54-0af5-4ac0-8839-bc5fc00e3342")).toMatchObject({
    localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342",
  });
  linkArtworkVisit("work", "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342");
  expect(
    selectArtworkEncounters()
      .all()
      .find((row) => row.visitLocalId === "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342")?.deletedAt,
  ).toBeNull();
});

it("deleting the artwork tombstones its album and retains visits", async () => {
  await softDeleteSavedWork("work", 20);
  expect(selectArtworkPhotos("work").all()).toEqual([]);
  expect(selectArtworkEncounters().all()).toEqual([]);
  expect(pendingAlbum(owner).photos.every((row) => row.deletedAt === 20)).toBe(true);
  expect(await createJournalRepository(owner).detail("ab7f8f54-0af5-4ac0-8839-bc5fc00e3341")).toMatchObject({
    localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341",
  });
});

it("rolls back a whole capture session when a photo belongs to another artwork", () => {
  expect(() =>
    saveArtworkSession(
      "new",
      { localId: "new", title: "New work", artist: "", savedAt: 30 },
      [
        {
          localId: "new-photo",
          savedLocalId: "new",
          path: "new.jpg",
          kind: "full",
          capturedAt: 30,
        },
        {
          localId: "detail",
          savedLocalId: "new",
          path: "detail.jpg",
          kind: "detail",
          capturedAt: 31,
        },
      ],
      undefined,
      owner,
    ),
  ).toThrow("Photo belongs to another artwork");
  expect(selectSavedWork("new").get()).toBeUndefined();
  expect(selectArtworkPhotos("new").all()).toEqual([]);
});

it("links a new saved crop to its capture photo even when their local IDs differ", () => {
  saveArtworkSession(
    "new-crop-work",
    {
      localId: "new-crop-work",
      title: "Painting",
      artist: "",
      savedAt: 1,
      photoPath: "capture.jpg",
      cropPath: "crop.jpg",
    },
    [{ localId: "capture-photo", savedLocalId: "new-crop-work", path: "capture.jpg", kind: "full", capturedAt: 1 }],
    undefined,
    owner,
  );
  expect(selectSavedWork("new-crop-work").get()).toMatchObject({ cropPhotoLocalId: "capture-photo" });
});

it("moves photos and their visit link atomically and reuses deleted capacity", async () => {
  const visitLocalId = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341";
  await insertSavedWork({
    localId: "move-source",
    title: "Source",
    artist: "",
    savedAt: 1,
    photoPath: "source.jpg",
    visitLocalId,
    venueId: "museum" as never,
  });
  await insertSavedWork({
    localId: "move-target",
    title: "Target",
    artist: "",
    savedAt: 1,
  });
  for (let i = 0; i < 100; i++) {
    addArtworkPhoto({
      localId: `capacity-${i}`,
      savedLocalId: "move-target",
      path: "photo.jpg",
      capturedAt: i,
      kind: "full",
    });
  }
  expect(() => editArtworkPhoto("move-source", { savedLocalId: "move-target" })).toThrow("100 photos");
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId === "move-target"),
  ).toHaveLength(0);
  editArtworkPhoto("capacity-0", { deletedAt: 20 });
  editArtworkPhoto("move-source", { savedLocalId: "move-target" });
  expect(selectArtworkPhotos("move-target").all()).toHaveLength(100);
  expect(
    selectArtworkEncounters()
      .all()
      .find((row) => row.savedLocalId === "move-target"),
  ).toMatchObject({ visitLocalId });
});

it("moves a retained photo without linking its discarded visit to the destination artwork", async () => {
  const visitLocalId = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3343";
  await upsertVisit({
    localId: visitLocalId,
    venueId: "museum" as never,
    venueName: "Museum",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  });
  await insertSavedWork({
    localId: "discarded-source",
    title: "Source",
    artist: "",
    savedAt: 1,
    photoPath: "retained.jpg",
    visitLocalId,
    venueId: "museum" as never,
  });
  await insertSavedWork({ localId: "discarded-target", title: "Target", artist: "", savedAt: 1 });
  discardVisit(visitLocalId);
  editArtworkPhoto("discarded-source", { savedLocalId: "discarded-target", kind: "detail", caption: "Retained" });
  expect(selectArtworkPhotos("discarded-source").all()).toEqual([]);
  expect(selectArtworkPhotos("discarded-target").all()).toMatchObject([
    { path: "retained.jpg", kind: "detail", caption: "Retained", visitLocalId, deletedAt: null, syncedAt: null },
  ]);
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId === "discarded-target"),
  ).toEqual([]);
});

it("reports media a publish depends on as pending until its rows and bytes reach the server", async () => {
  await insertSavedWork({
    localId: "pending-work",
    title: "Pending",
    artist: "",
    savedAt: 1,
    photoPath: "pending.jpg",
  });
  expect(albumMediaPending(owner, {})).toBe(false);
  expect(albumMediaPending(owner, { photoLocalIds: ["pending-work"] })).toBe(true);
  expect(albumMediaPending(owner, { saveLocalIds: ["pending-work"] })).toBe(true);
  db.update(artworkPhotos).set({ syncedAt: 5 }).where(eq(artworkPhotos.localId, "pending-work")).run();
  expect(albumMediaPending(owner, { saveLocalIds: ["pending-work"] })).toBe(false);
  expect(albumMediaPending(owner, { photoLocalIds: ["pending-work"] })).toBe(true);
  db.update(artworkPhotos)
    .set({ storageId: "stored" as never })
    .where(eq(artworkPhotos.localId, "pending-work"))
    .run();
  expect(
    albumMediaPending(owner, {
      photoLocalIds: ["pending-work"],
      saveLocalIds: ["pending-work"],
    }),
  ).toBe(false);
});

it("links a selection atomically and rolls every new link back if one artwork is unavailable", async () => {
  await insertSavedWork({
    localId: "batch-one",
    title: "One",
    artist: "",
    savedAt: 1,
  });
  await insertSavedWork({
    localId: "batch-two",
    title: "Two",
    artist: "",
    savedAt: 1,
  });
  const visitId = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341";
  expect(() => linkArtworksVisit(["batch-one", "missing"], visitId)).toThrow("Artwork is unavailable");
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId === "batch-one"),
  ).toEqual([]);
  linkArtworksVisit(["batch-one", "batch-two", "batch-one"], visitId);
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId.startsWith("batch-")),
  ).toHaveLength(2);
});

it("links one artwork to several visits atomically", async () => {
  await insertSavedWork({
    localId: "multi-visit",
    title: "Multi",
    artist: "",
    savedAt: 1,
  });
  const first = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341";
  const second = "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342";
  expect(() => linkArtworkVisits("multi-visit", [first, "missing-visit"])).toThrow("Visit is unavailable");
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId === "multi-visit"),
  ).toEqual([]);
  linkArtworkVisits("multi-visit", [first, second, first]);
  expect(
    selectArtworkEncounters()
      .all()
      .filter((row) => row.savedLocalId === "multi-visit")
      .map((row) => row.visitLocalId)
      .sort(),
  ).toEqual([first, second]);
});
