import { db } from "@/db/client";
import { pendingScans, savedWorks, visits } from "@/db/schema";
import { initializeOwner, switchOwner } from "@/lib/account/owner-store";

import { createJournalRepository } from "./journal";
import { enqueuePendingScan } from "./pending-scans";
import { insertSavedWork, softDeleteSavedWork } from "./saved-works";
import { upsertVisit } from "./visits";

const mockMetadata = jest.fn();
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: (...args: unknown[]) => mockMetadata(...args),
}));
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const venueId = "museum" as never;
const owner = "account:me";
const visit = (i: number) => ({
  localId: uuid(i),
  venueId,
  venueName: "Musée",
  visitedOn: "2024-02-29",
  timeZone: "UTC",
});
beforeEach(async () => {
  await db.delete(savedWorks);
  await db.delete(pendingScans);
  await db.delete(visits);
  initializeOwner("test-installation");
  switchOwner(owner);
  mockMetadata.mockResolvedValue([
    {
      id: venueId,
      name: "Musée",
      city: "Paris",
      country: "FR",
      cityKey: "wikidata:Q90",
    },
  ]);
});

it("binds all reads to the owner and computes summaries from the complete journal before pagination", async () => {
  for (let i = 0; i < 23; i++) await upsertVisit(visit(i));
  await upsertVisit(visit(99), "account:foreign");
  const repo = createJournalRepository(owner);
  switchOwner("account:foreign");
  const first = await repo.history({ search: "france" });
  expect(first.page).toHaveLength(20);
  const last = await repo.history({ search: "france", cursor: first.cursor });
  expect(last.page.map((row) => row.localId)).toEqual([uuid(2), uuid(1), uuid(0)]);
  expect((await repo.summaries("place")).page).toEqual([
    expect.objectContaining({
      museumCount: 1,
      visitCount: 23,
      latestVisitedOn: "2024-02-29",
    }),
  ]);
  await expect(repo.detail(uuid(99))).rejects.toThrow("not_found");
});

it("rejects missing, foreign and venue-mismatched local memberships and preserves the last empty visit", async () => {
  await upsertVisit(visit(1));
  await upsertVisit(visit(2), "account:foreign");
  const work = {
    localId: uuid(3),
    title: "Painting",
    artist: "",
    savedAt: 1,
    visitLocalId: uuid(1),
    venueId,
  };
  for (const change of [
    { visitLocalId: uuid(2) },
    { visitLocalId: uuid(99) },
    { visitLocalId: "" },
    { venueId: "wrong" as never },
  ]) {
    await expect(insertSavedWork({ ...work, ...change })).rejects.toThrow("not_found");
    await expect(
      enqueuePendingScan({
        ...work,
        ...change,
        photoPath: "photo.jpg",
        cropPath: "crop.jpg",
        vector: [],
        descriptors: new ArrayBuffer(0),
        keypoints: new ArrayBuffer(0),
        modelVersion: "v1",
        attemptModelVersion: "v1",
        capturedAt: 1,
        createdAt: 1,
      }),
    ).rejects.toThrow("not_found");
  }
  await insertSavedWork(work);
  const repo = createJournalRepository(owner);
  expect((await repo.savedWorks(uuid(1))).page).toHaveLength(1);
  await softDeleteSavedWork(work.localId);
  expect((await repo.savedWorks(uuid(1))).page).toEqual([]);
  expect(await repo.detail(uuid(1))).toMatchObject({ localId: uuid(1) });
});
