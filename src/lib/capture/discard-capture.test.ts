import { db } from "@/db/client";
import { artworkPhotos, pendingScans, savedWorks, settings } from "@/db/schema";
import { saveArtworkSession } from "@/db/repos/artwork-album";
import { enqueuePendingScan, getPendingScan } from "@/db/repos/pending-scans";
import { removePhotoFile } from "@/lib/account/photo-transfer";
import { discardCapture } from "./discard-capture";
import { readPhotoDraft, writePhotoDraft } from "./photo-draft";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/account/photo-transfer", () => ({
  removePhotoFile: jest.fn(),
}));

const owner = "device:test-installation";

beforeEach(async () => {
  jest.resetAllMocks();
  for (const table of [artworkPhotos, savedWorks, pendingScans, settings]) {
    db.delete(table).run();
  }
  await enqueuePendingScan({
    localId: "scan",
    photoPath: "photos/scan.jpg",
    cropPath: "crops/scan.jpg",
    labelPhotoPath: "labels/scan.jpg",
    vector: [],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    capturedAt: 1,
    createdAt: 1,
  });
  writePhotoDraft(owner, "photos/scan.jpg", [
    {
      localId: "detail",
      path: "photos/detail.jpg",
      kind: "detail",
      capturedAt: 2,
    },
  ]);
});

it("discards the capture, additional photos and label together", async () => {
  await discardCapture("scan", owner);
  expect(await getPendingScan("scan")).toBeUndefined();
  expect(readPhotoDraft(owner, "photos/scan.jpg")).toEqual([]);
  expect(jest.mocked(removePhotoFile).mock.calls.map(([path]) => path)).toEqual(
    [
      "photos/scan.jpg",
      "crops/scan.jpg",
      "crops/scan.preview.jpg",
      "labels/scan.jpg",
      "photos/detail.jpg",
    ],
  );
});

it("leaves another owner’s capture and photos alone", async () => {
  await discardCapture("scan", "device:other");
  expect(await getPendingScan("scan")).toBeDefined();
  expect(removePhotoFile).not.toHaveBeenCalled();
});

it("protects a scan saved after the recent-scans sheet was opened", async () => {
  saveArtworkSession(
    "work",
    {
      localId: "work",
      title: "Study",
      artist: "",
      savedAt: 1,
      photoPath: "photos/scan.jpg",
      cropPath: "crops/scan.jpg",
    },
    [
      {
        localId: "scan",
        savedLocalId: "work",
        path: "photos/scan.jpg",
        kind: "full",
        capturedAt: 1,
      },
    ],
    undefined,
    owner,
  );
  await expect(discardCapture("scan", owner)).rejects.toThrow(
    "already been saved",
  );
  expect(removePhotoFile).not.toHaveBeenCalled();
  expect(await getPendingScan("scan")).toBeDefined();
});

it("keeps the draft reachable for retry if file removal fails", async () => {
  jest.mocked(removePhotoFile).mockImplementationOnce(() => {
    throw new Error("File unavailable");
  });
  await expect(discardCapture("scan", owner)).rejects.toThrow(
    "File unavailable",
  );
  expect(await getPendingScan("scan")).toBeDefined();
  expect(readPhotoDraft(owner, "photos/scan.jpg")).toHaveLength(1);
  await discardCapture("scan", owner);
  expect(await getPendingScan("scan")).toBeUndefined();
});
