import { db } from "@/db/client";
import {
  artworkEncounters,
  artworkPhotos,
  offlineScanResults,
  pendingScans,
  savedWorks,
  settings,
  visits,
} from "@/db/schema";
import type { OfflineResult } from "@/shared/offline/types";

import { deleteAllLocalData } from "./local-data";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const tables = [visits, savedWorks, artworkPhotos, artworkEncounters, pendingScans, offlineScanResults, settings];

function seed(owner: string) {
  const venueId = "venue" as never;
  db.insert(visits)
    .values({ owner, localId: "visit", venueId, venueName: "Museum", visitedOn: "2026-10-01", timeZone: "UTC" })
    .run();
  db.insert(savedWorks)
    .values({ owner, localId: "work", visitLocalId: "visit", savedAt: 1, title: "Work", artist: "Artist" })
    .run();
  db.insert(artworkPhotos).values({ owner, localId: "photo", savedLocalId: "work", kind: "full", capturedAt: 1 }).run();
  db.insert(artworkEncounters).values({ owner, savedLocalId: "work", visitLocalId: "visit" }).run();
  db.insert(pendingScans)
    .values({
      owner,
      localId: "scan",
      photoPath: "photos/scan.jpg",
      cropPath: "crops/scan.jpg",
      vector: [0],
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
      modelVersion: "m",
      visitLocalId: "visit",
      capturedAt: 1,
      attemptModelVersion: "m",
      createdAt: 1,
    })
    .run();
  db.insert(offlineScanResults)
    .values({ owner, localId: "scan", result: {} as OfflineResult })
    .run();
  db.insert(settings)
    .values({ key: `journalSync:${owner}`, value: "1" })
    .run();
}

it("erases every owner's journal, queued scans and preferences", () => {
  seed("device:installation");
  seed("account:signed-in");
  db.insert(settings).values({ key: "welcome-seen", value: "true" }).run();

  deleteAllLocalData();

  for (const table of tables) expect(db.select().from(table).all()).toEqual([]);
});
