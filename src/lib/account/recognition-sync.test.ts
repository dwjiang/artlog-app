import { ConvexError } from "convex/values";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { saveArtworkSession } from "@/db/repos/artwork-album";
import { enqueuePendingScan } from "@/db/repos/pending-scans";
import { softDeleteSavedWork } from "@/db/repos/saved-works";
import { artworkPhotos, artworkEncounters, savedWorks, pendingScans, settings } from "@/db/schema";

import { switchOwner } from "./owner-store";
import { syncSavedRecognition } from "./recognition-sync";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
const mockUpload = jest.fn<Promise<unknown>, [unknown, { localId: string }]>();
jest.mock("@/lib/convex-client", () => ({
  convex: { action: (fn: unknown, args: { localId: string }) => mockUpload(fn, args) },
}));
const owner = "device:recognition-test";
const context = { owner, scope: "test-scope" };

beforeEach(async () => {
  for (const table of [artworkPhotos, artworkEncounters, savedWorks, pendingScans, settings]) await db.delete(table);
  switchOwner(owner, context.scope);
  mockUpload.mockReset().mockResolvedValue(null);
});

async function save(localId: string, kind: "full" | "label" = "full", savedOwner = owner) {
  await enqueuePendingScan(
    {
      localId: `capture-${localId}`,
      photoPath: `${localId}.jpg`,
      cropPath: `${localId}-crop.jpg`,
      vector: [1, 0],
      descriptors: new ArrayBuffer(32),
      keypoints: new ArrayBuffer(16),
      modelVersion: "model",
      attemptModelVersion: "model",
      capturedAt: 1,
      createdAt: 1,
      status: "queued",
    },
    savedOwner,
  );
  saveArtworkSession(
    localId,
    {
      localId,
      title: "Unidentified artwork",
      artist: "",
      savedAt: 1,
      photoPath: `${localId}.jpg`,
      cropPath: `${localId}-crop.jpg`,
      syncedAt: 1,
    },
    [{ localId: `capture-${localId}`, savedLocalId: localId, path: `${localId}.jpg`, kind, capturedAt: 1 }],
    undefined,
    savedOwner,
  );
}

it("uploads an offline save's existing features once without requiring a server scan ID", async () => {
  await save("offline");
  await syncSavedRecognition(context, () => true);
  expect(mockUpload.mock.calls[0][1]).toMatchObject({
    localId: "offline",
    sourceLocalId: "capture-offline",
    vector: [1, 0],
    modelVersion: "model",
    scope: context.scope,
  });
  await syncSavedRecognition(context, () => true);
  expect(mockUpload).toHaveBeenCalledTimes(1);
});

it("keeps a failed upload pending while completing other saves and excludes deleted, foreign and label photos", async () => {
  await save("a");
  await save("b");
  await save("deleted");
  await save("label", "label");
  await save("foreign", "full", "device:other");
  await softDeleteSavedWork("deleted", 2, owner);
  mockUpload.mockImplementation(async (_fn, args) => {
    if (args.localId === "a") throw new Error("Network request failed");
  });
  await expect(syncSavedRecognition(context, () => true)).rejects.toThrow("Network request failed");
  expect(mockUpload.mock.calls.map((call) => call[1].localId).sort()).toEqual(["a", "b"]);
  mockUpload.mockReset().mockResolvedValue(null);
  await syncSavedRecognition(context, () => true);
  expect(mockUpload.mock.calls.map((call) => call[1].localId)).toEqual(["a"]);
});

it("does not acknowledge a response after the account changes", async () => {
  await save("a");
  let current = true;
  mockUpload.mockImplementationOnce(async () => {
    current = false;
  });
  await syncSavedRecognition(context, () => current);
  mockUpload.mockResolvedValue(null);
  await syncSavedRecognition(context, () => true);
  expect(mockUpload).toHaveBeenCalledTimes(2);
});

it("retains features when a saved album gives the captured photo a new ID", async () => {
  await save("resaved");
  await db
    .update(artworkPhotos)
    .set({ localId: "new-album-photo" })
    .where(eq(artworkPhotos.localId, "capture-resaved"));
  await syncSavedRecognition(context, () => true);
  expect(mockUpload.mock.calls[0][1]).toMatchObject({ localId: "resaved", sourceLocalId: "capture-resaved" });
});

it("stops the batch at the first rate limit and leaves the remaining saves pending", async () => {
  await save("a");
  await save("b");
  mockUpload.mockRejectedValueOnce(new ConvexError({ code: "rate_limited", name: "recognitionUpload" }));
  await expect(syncSavedRecognition(context, () => true)).rejects.toMatchObject({ data: { code: "rate_limited" } });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  await syncSavedRecognition(context, () => true);
  expect(mockUpload.mock.calls.slice(1).map((call) => call[1].localId)).toEqual(["a", "b"]);
});
