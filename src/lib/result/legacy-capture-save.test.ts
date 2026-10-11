import { db } from "@/db/client";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import { getSavedWork } from "@/db/repos/saved-works";
import { artworkPhotos, pendingScans, savedWorks, settings } from "@/db/schema";
import { switchOwner } from "@/lib/account/owner-store";

import { saveResult } from "./save";
import { draftFromCandidate } from "./snapshot";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const mockFiles = new Set<string>();
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
jest.mock("expo-crypto", () => ({ randomUUID: () => "saved-water-lilies" }));
jest.mock("@/lib/files/kept-photos", () => ({ keepPhotos: async () => {} }));
jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: async () => {} }));
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: jest.fn() } }));
jest.mock("@/lib/venue/use-venue", () => ({ openVisitLocalId: () => undefined }));
jest.mock("@/lib/venue/venue-db", () => ({ venueNameById: async () => undefined }));

const capture = {
  owner: "device:test-installation",
  localId: "legacy-capture",
  photoPath: "photos/legacy-capture.jpg",
  cropPath: "crops/legacy-capture.jpg",
  cropCorners: null,
  venueId: null,
  visitId: null,
  visitLocalId: null,
  capturedAt: 1_750_000_000_000,
};

beforeEach(() => {
  db.delete(savedWorks).run();
  db.delete(pendingScans).run();
  db.delete(settings).run();
  switchOwner(capture.owner);
  mockFiles.clear();
  mockFiles.add(`file:///documents/${capture.photoPath}`);
  mockFiles.add(`file:///documents/${capture.cropPath}`);
});

it.each([
  ["a legacy scan that predates separate previews", false, "crops/legacy-capture.jpg"],
  ["a scan with an unpadded preview", true, "crops/legacy-capture.preview.jpg"],
] as const)("saves an existing crop and completion thumbnail for %s", async (_name, hasPreview, expectedPath) => {
  if (hasPreview) mockFiles.add("file:///documents/crops/legacy-capture.preview.jpg");
  const result = await saveResult({
    capture,
    draft: draftFromCandidate({ title: "Water Lilies", artist: "Claude Monet" }),
  });
  await result.synced;

  expect(await getSavedWork(result.localId)).toMatchObject({
    title: "Water Lilies",
    artist: "Claude Monet",
    savedAt: capture.capturedAt,
    photoPath: capture.photoPath,
    cropPath: expectedPath,
  });
  expect(result.completion.previewPath).toBe(expectedPath);
  expect(selectArtworkPhotos(result.localId).all()).toEqual([
    expect.objectContaining({ localId: capture.localId, path: capture.photoPath, capturedAt: capture.capturedAt }),
  ]);
});

it("reuses a recovered legacy artwork when its original capture is saved again", async () => {
  db.insert(savedWorks)
    .values({
      owner: capture.owner,
      localId: "legacy-artwork",
      title: "Water Lilies",
      artist: "Claude Monet",
      savedAt: capture.capturedAt,
      photoPath: capture.photoPath,
      cropPath: capture.cropPath,
    })
    .run();
  db.insert(artworkPhotos)
    .values({
      owner: capture.owner,
      localId: "legacy-artwork",
      savedLocalId: "legacy-artwork",
      kind: "full",
      capturedAt: capture.capturedAt,
      path: capture.photoPath,
    })
    .run();
  db.insert(pendingScans)
    .values({
      ...capture,
      savedPhotoLocalId: "legacy-artwork",
      vector: [],
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
      modelVersion: "old",
      attemptModelVersion: "old",
      createdAt: capture.capturedAt,
    })
    .run();

  const result = await saveResult({
    capture,
    draft: draftFromCandidate({ title: "Water Lilies", artist: "Claude Monet" }),
  });
  await result.synced;

  expect(result.localId).toBe("legacy-artwork");
  expect(db.select().from(savedWorks).all()).toHaveLength(1);
  expect(selectArtworkPhotos(result.localId).all()).toHaveLength(1);
});
