import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SQLite from "expo-sqlite";
import { db } from "@/db/client";
import { artworkPhotos, pendingScans, savedWorks } from "@/db/schema";
import { saveArtworkSession } from "@/db/repos/artwork-album";
import { enqueuePendingScan } from "@/db/repos/pending-scans";
import { useQueue } from "./use-queue";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));
jest.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false }),
}));
jest.mock("./queue", () => ({ startQueueFlusher: jest.fn() }));
jest.mock("@/lib/label/share-saved-label", () => ({
  startPendingShareFlusher: jest.fn(),
}));

const listeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();
const owner = "device:test-installation";

beforeEach(() => {
  for (const table of [artworkPhotos, savedWorks, pendingScans]) {
    db.delete(table).run();
  }
  listeners.clear();
  jest.spyOn(SQLite, "addDatabaseChangeListener").mockImplementation((listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
});
afterEach(() => jest.restoreAllMocks());

it("removes a newly saved scan from a mounted recent-scans query without reopening the camera", async () => {
  await enqueuePendingScan({
    localId: "scan",
    photoPath: "photos/scan.jpg",
    cropPath: "crops/scan.jpg",
    vector: [],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "m",
    attemptModelVersion: "m",
    capturedAt: 1,
    createdAt: 1,
  });
  const hook = await renderHook(useQueue);
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  await act(async () => {
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
    for (const listener of listeners) {
      listener({
        tableName: "artworkPhotos",
        databaseName: "artlog.db",
        databaseFilePath: "",
        rowId: 1,
      });
    }
  });
  await waitFor(() => expect(hook.result.current.items).toHaveLength(0));
});
