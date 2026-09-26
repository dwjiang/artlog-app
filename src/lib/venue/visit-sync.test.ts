import { ConvexError } from "convex/values";

import { db } from "@/db/client";
import { getVisit, upsertVisit, markVisitsSynced, moveVisit } from "@/db/repos/visits";
import { visits } from "@/db/schema";
import { initializeOwner, switchOwner } from "@/lib/account/owner-store";
import { isTransientError, SyncUnavailableError } from "@/lib/network-error";

import { resolveScanVisit } from "./visit-sync";

const mockFlush = jest.fn();
jest.mock("@/lib/account/collection-sync", () => ({
  flushJournal: () => mockFlush(),
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const venueId = "museum" as never;
beforeEach(async () => {
  await db.delete(visits);
  initializeOwner("test-installation");
  mockFlush.mockReset();
});

it("synchronizes the original offline visit even after it ended and another visit started", async () => {
  await upsertVisit({
    localId: "7288f45f-956f-5e34-ba13-5a375a2f4d78",
    venueId,
    venueName: "Museum",
    visitedOn: "1970-01-01",
    timeZone: "UTC",
    startedAt: 1,
    endedAt: 2,
  });
  mockFlush.mockImplementation(async () => {
    await markVisitsSynced([
      {
        localId: "7288f45f-956f-5e34-ba13-5a375a2f4d78",
        visitId: "remote" as never,
        revision: 0,
        updatedAt: 3,
        updatedBy: "device" as never,
      },
    ]);
  });
  expect(await resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78")).toBe("remote");
  expect(await getVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78")).toMatchObject({
    startedAt: 1,
    endedAt: 2,
  });
});

it("rejects missing visits before sending anything", async () => {
  await expect(resolveScanVisit("missing")).rejects.toThrow("invalid visit");
  expect(mockFlush).not.toHaveBeenCalled();
});

async function movedSyncedVisit() {
  const localId = "7288f45f-956f-5e34-ba13-5a375a2f4d78";
  const visit = { localId, venueId, venueName: "Museum", visitedOn: "1970-01-01", timeZone: "UTC" };
  await upsertVisit(visit);
  const acknowledgement = {
    localId,
    visitId: "remote" as never,
    revision: 0,
    updatedAt: 3,
    updatedBy: "device" as never,
  };
  await markVisitsSynced([acknowledgement]);
  await moveVisit(localId, { ...visit, venueId: "new-museum" as never, venueName: "New Museum" });
  return { localId, acknowledgement: { ...acknowledgement, revision: 1, updatedAt: 4 } };
}

it("syncs a museum edit before returning an existing remote visit for a queued scan", async () => {
  const { localId, acknowledgement } = await movedSyncedVisit();
  mockFlush.mockImplementation(async () => {
    await markVisitsSynced([acknowledgement]);
  });
  expect(await resolveScanVisit(localId)).toBe("remote");
  expect(await getVisit(localId)).toMatchObject({ venueId: "new-museum", syncedAt: 4 });
  mockFlush.mockClear();
  expect(await resolveScanVisit(localId)).toBe("remote");
  expect(mockFlush).not.toHaveBeenCalled();
});

it.each([new SyncUnavailableError(), new TypeError("Network request failed")])(
  "keeps scans retryable when a moved visit cannot sync: %s",
  async (failure) => {
    const { localId } = await movedSyncedVisit();
    mockFlush.mockRejectedValue(failure);
    await expect(resolveScanVisit(localId)).rejects.toBe(failure);
  },
);

it("keeps scans retryable if a visit edit is still pending after a sync attempt", async () => {
  const { localId } = await movedSyncedVisit();
  mockFlush.mockResolvedValue(undefined);
  await expect(resolveScanVisit(localId)).rejects.toBeInstanceOf(SyncUnavailableError);
});

it("discards an in-flight result after an account switch", async () => {
  await upsertVisit({
    localId: "7288f45f-956f-5e34-ba13-5a375a2f4d78",
    venueId,
    venueName: "Museum",
    visitedOn: "1970-01-01",
    timeZone: "UTC",
  });
  mockFlush.mockImplementation(async () => {
    switchOwner("account:other");
  });
  await expect(resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78")).rejects.toThrow("owner changed");
});

it.each([new ConvexError({ code: "rate_limited" }), new SyncUnavailableError()])(
  "propagates the sync failure %s so the flusher does not count an attempt",
  async (failure) => {
    await upsertVisit({
      localId: "7288f45f-956f-5e34-ba13-5a375a2f4d78",
      venueId,
      venueName: "Museum",
      visitedOn: "1970-01-01",
      timeZone: "UTC",
    });
    mockFlush.mockRejectedValue(failure);
    const error = await resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78").catch((cause: unknown) => cause);
    expect(error).toBe(failure);
    expect(isTransientError(error)).toBe(true);
  },
);
