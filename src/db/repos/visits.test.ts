import { db } from "@/db/client";
import { artworkEncounters, artworkPhotos, pendingScans, savedWorks, visits } from "@/db/schema";
import { onCollectionChange } from "@/lib/account/sync-events";

import type { Id } from "../../../convex/_generated/dataModel";
import * as repo from "./visits";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const venueId = "museum-1" as Id<"museums">;
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const visit = {
  localId: first,
  venueId,
  venueName: "Museum",
  visitedOn: "2024-02-29",
  timeZone: "UTC",
};
beforeEach(async () => {
  await db.delete(savedWorks);
  await db.delete(visits);
});

it("creates and links a visit atomically without copying photos, including retries", async () => {
  await db.insert(savedWorks).values({
    owner: "account:me",
    localId: "art",
    title: "Painting",
    artist: "Artist",
    savedAt: 1,
  });
  await repo.upsertVisit(visit, "account:me", "art");
  await repo.upsertVisit(visit, "account:me", "art");
  expect(await repo.listVisits("account:me")).toHaveLength(1);
  expect(await db.select().from(artworkEncounters)).toEqual([
    expect.objectContaining({
      owner: "account:me",
      savedLocalId: "art",
      visitLocalId: first,
    }),
  ]);
  expect(await db.select().from(artworkPhotos)).toEqual([]);
  await expect(repo.upsertVisit({ ...visit, localId: second }, "account:other", "art")).rejects.toThrow("not_found");
  expect(await repo.listVisits("account:other")).toEqual([]);
});

it("preserves empty, manual and repeat visits and retries the same UUID", async () => {
  await repo.upsertVisit(visit);
  await repo.upsertVisit(visit);
  await repo.upsertVisit({ ...visit, localId: second });
  expect((await repo.listVisits()).map((v) => v.localId)).toEqual([second, first]);
  expect(await repo.getVisit(first)).toMatchObject({
    startedAt: null,
    endedAt: null,
    revision: 0,
  });
});

it.each([
  { localId: "invalid" },
  { visitedOn: "2023-02-29" },
  { visitedOn: "2999-01-01" },
  { timeZone: "Unknown/City" },
  { reflection: "x".repeat(20_001) },
  { startedAt: 1 },
  { endedAt: 1 },
])("rejects invalid creates before persistence: %j", async (fields) => {
  await expect(repo.upsertVisit({ ...visit, ...fields })).rejects.toThrow("invalid_visit");
  expect(await repo.listVisits()).toEqual([]);
});

it("validates merged patches, allows reflection clearing and refuses foreign targets", async () => {
  await repo.upsertVisit({
    ...visit,
    reflection: "private",
    startedAt: Date.parse("2024-02-29T12:00Z"),
  });
  await expect(repo.patchVisit(first, { visitedOn: "2024-02-28" })).rejects.toThrow("invalid_visit");
  await expect(repo.patchVisit(first, { reflection: "" }, "account:other")).rejects.toThrow("not_found");
  await repo.patchVisit(first, { reflection: null });
  expect(await repo.getVisit(first)).toMatchObject({
    visitedOn: "2024-02-29",
    reflection: null,
  });
  await expect(repo.upsertVisit({ ...visit, venueId: "other" as never })).rejects.toThrow("invalid_visit");
});

it("keeps edits made during sync pending until their own revision is acknowledged", async () => {
  await repo.upsertVisit(visit);
  await repo.patchVisit(first, { reflection: "newer" });
  await repo.markVisitsSynced([
    {
      localId: first,
      revision: 0,
      visitId: "remote" as never,
      updatedAt: 10,
      updatedBy: "device" as never,
    },
  ]);
  expect(await repo.getVisit(first)).toMatchObject({
    reflection: "newer",
    syncedAt: null,
    remoteVisitId: "remote",
  });
});

it("leaves a sync: false patch pending without requesting a sync", async () => {
  const requests = jest.fn();
  const unsubscribe = onCollectionChange(requests);
  try {
    await repo.upsertVisit(visit);
    requests.mockClear();
    await repo.patchVisit(first, { reflection: "pause" }, undefined, {
      sync: false,
    });
    expect(await repo.getVisit(first)).toMatchObject({
      reflection: "pause",
      syncedAt: null,
    });
    expect(requests).not.toHaveBeenCalled();
    await repo.patchVisit(first, { reflection: "blur" });
    expect(requests).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

it("accepts a remote visit the server stamped after this device crossed local midnight", async () => {
  jest.useFakeTimers().setSystemTime(Date.parse("2024-02-29T23:59:50Z"));
  try {
    await repo.upsertVisitsFromRemote([
      {
        visibility: "public" as const,
        _id: "remote" as never,
        _creationTime: 1,
        owner: { kind: "device", deviceId: "device" as never },
        localId: first,
        venueId,
        venueName: "Museum",
        visitedOn: "2024-03-01",
        timeZone: "UTC",
        updatedAt: Date.parse("2024-03-01T00:00:10Z"),
        updatedBy: "device" as never,
        changeVersion: 1,
      },
    ]);
    expect(await repo.getVisit(first)).toMatchObject({
      visitedOn: "2024-03-01",
      remoteVisitId: "remote",
    });
  } finally {
    jest.useRealTimers();
  }
});

it("defaults new visits to Public and preserves an explicit Private choice across later saves", async () => {
  await repo.upsertVisit(visit);
  expect(await repo.getVisit(first)).toMatchObject({ visibility: "public" });
  await repo.patchVisit(first, { visibility: "private" });
  await repo.upsertVisit({ ...visit, reflection: "A later note" });
  expect(await repo.getVisit(first)).toMatchObject({
    visibility: "private",
    reflection: "A later note",
  });
  await repo.upsertVisit({ ...visit, localId: second });
  expect(await repo.getVisit(second)).toMatchObject({ visibility: "public" });
});

it("finds the visit at a museum on a day, latest started first, and only open ones on request", async () => {
  const noon = Date.parse("2024-02-29T12:00Z");
  await repo.upsertVisit({ ...visit, startedAt: noon, endedAt: noon + 1 });
  await repo.upsertVisit({ ...visit, localId: second, startedAt: noon + 2 });
  await repo.upsertVisit({
    ...visit,
    localId: "00000000-0000-4000-8000-000000000003",
    visitedOn: "2024-02-28",
  });
  await repo.upsertVisit({
    ...visit,
    localId: "00000000-0000-4000-8000-000000000004",
    venueId: "museum-2" as Id<"museums">,
  });
  expect((await repo.findVisitOnDay(venueId, "2024-02-29"))?.localId).toBe(second);
  await repo.patchVisit(second, { endedAt: noon + 3 });
  expect(await repo.findVisitOnDay(venueId, "2024-02-29", undefined, { open: true })).toBeUndefined();
  expect(await repo.findVisitOnDay(venueId, "2024-02-29", "account:other")).toBeUndefined();
  expect(await repo.findVisitOnDay(venueId, "2024-03-01")).toBeUndefined();
});

it("moves a visit to another museum and day with its saves and unsent scans, keeping its clock times", async () => {
  const noon = Date.parse("2024-02-29T12:00Z");
  const otherVenue = "museum-2" as Id<"museums">;
  await repo.upsertVisit({ ...visit, startedAt: noon, endedAt: noon + 3_600_000 }, "account:me");
  await repo.upsertVisit({ ...visit, localId: second }, "account:me");
  const work = { title: "Painting", artist: "Artist", savedAt: noon, venueId, venueName: "Museum", syncedAt: 10 };
  await db.insert(savedWorks).values([
    { ...work, owner: "account:me", localId: "moves", visitLocalId: first },
    { ...work, owner: "account:me", localId: "stays", visitLocalId: second },
  ]);
  const scan = {
    owner: "account:me",
    photoPath: "photo.jpg",
    cropPath: "crop.jpg",
    vector: [0.5],
    descriptors: new Uint8Array([1]).buffer,
    keypoints: new Uint8Array([2]).buffer,
    modelVersion: "model-v1",
    attemptModelVersion: "model-v1",
    capturedAt: noon,
    createdAt: noon,
    venueId,
    visitLocalId: first,
  };
  await db.insert(pendingScans).values([
    { ...scan, localId: "unsent" },
    { ...scan, localId: "sent", scanId: "scan" as Id<"scans"> },
  ]);
  await repo.moveVisit(
    first,
    { venueId: otherVenue, venueName: "Other Museum", visitedOn: "2024-02-27", timeZone: "Asia/Tokyo" },
    "account:me",
  );
  expect(await repo.getVisit(first, "account:me")).toMatchObject({
    venueId: otherVenue,
    venueName: "Other Museum",
    visitedOn: "2024-02-27",
    timeZone: "Asia/Tokyo",
    startedAt: Date.parse("2024-02-27T12:00+09:00"),
    endedAt: Date.parse("2024-02-27T13:00+09:00"),
    revision: 1,
  });
  const works = await db.select().from(savedWorks);
  expect(works.find((row) => row.localId === "moves")).toMatchObject({
    venueId: otherVenue,
    venueName: "Other Museum",
    syncedAt: 10,
  });
  expect(works.find((row) => row.localId === "stays")).toMatchObject({ venueId, venueName: "Museum" });
  const scans = await db.select().from(pendingScans);
  expect(scans.find((row) => row.localId === "unsent")?.venueId).toBe(otherVenue);
  expect(scans.find((row) => row.localId === "sent")?.venueId).toBe(venueId);
  await db.delete(pendingScans);
});

it("refuses to move a visit to a future day or a missing visit", async () => {
  await repo.upsertVisit(visit);
  const to = { venueId, venueName: "Museum", visitedOn: "2999-01-01", timeZone: "UTC" };
  await expect(repo.moveVisit(first, to)).rejects.toThrow("invalid_visit");
  await expect(repo.moveVisit(second, { ...to, visitedOn: "2024-02-28" })).rejects.toThrow("not_found");
  expect(await repo.getVisit(first)).toMatchObject({ visitedOn: "2024-02-29", revision: 0 });
});
