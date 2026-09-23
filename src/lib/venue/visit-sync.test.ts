import { getVisit, upsertVisit, markVisitsSynced } from "@/db/repos/visits";
import { db } from "@/db/client";
import { visits } from "@/db/schema";
import { resolveScanVisit } from "./visit-sync";
import { initializeOwner, switchOwner } from "@/lib/account/owner-store";
import { isTransientError, SyncUnavailableError } from "@/lib/network-error";
import { ConvexError } from "convex/values";

const mockFlush = jest.fn();
jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: () => mockFlush() }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
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
  expect(await resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78", venueId)).toBe("remote");
  expect(await getVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78")).toMatchObject({
    startedAt: 1,
    endedAt: 2,
  });
});
it("rejects missing and mismatched visits before sending anything", async () => {
  await expect(resolveScanVisit("missing", venueId)).rejects.toThrow("invalid visit");
  expect(mockFlush).not.toHaveBeenCalled();
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
  await expect(resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78", venueId)).rejects.toThrow(
    "owner changed",
  );
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
    const error = await resolveScanVisit("7288f45f-956f-5e34-ba13-5a375a2f4d78", venueId).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBe(failure);
    expect(isTransientError(error)).toBe(true);
  },
);
