import { act, renderHook } from "@testing-library/react-native";

import { confidentScan, lilies } from "@/components/scan/result/__fixtures__/scan";
import { db } from "@/db/client";
import {
  pendingAlbum,
  recoverArtworkVisits,
  selectArtworkPhotos,
  selectVisitArtworkPhotos,
} from "@/db/repos/artwork-album";
import { getSavedWork } from "@/db/repos/saved-works";
import { upsertVisit } from "@/db/repos/visits";
import { artworkEncounters, artworkPhotos, savedWorks, settings, visits } from "@/db/schema";
import { anonymousOwner, getLocalOwner, switchOwner } from "@/lib/account/owner-store";
import { writePhotoDraft } from "@/lib/capture/photo-draft";
import { addToMuseumVisit, useMakeVisit } from "@/lib/journal/visitless-saves";
import { saveResult } from "@/lib/result/save";
import { draftFromCandidate } from "@/lib/result/snapshot";
import { toResultViewState } from "@/lib/result/state";
import { calendarDate } from "@/shared/journal/limits";

jest.mock("@/db/client", () => {
  const db = jest.requireActual<typeof import("@/db/test-db")>("@/db/test-db").createTestDatabase();
  const transaction = db.transaction.bind(db);
  db.transaction = (run, config) => {
    // Expo's root transaction starts BEGIN; better-sqlite3 silently uses a savepoint when nested.
    if (db.$client.inTransaction) throw new Error("cannot start a transaction within a transaction");
    return transaction(run, config);
  };
  return { db };
});
jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: jest.fn() }));
jest.mock("@/lib/convex-client", () => ({ convex: {} }));
jest.mock("@/lib/files/kept-photos", () => ({ keepPhotos: jest.fn() }));
jest.mock("@/lib/label/share-saved-label", () => ({ shareSavedLabel: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `work-${++mockUuid}` }));
jest.mock("@/lib/venue/venue-db", () => ({ venueNameById: async () => "The Met" }));
const mockVisitForSave = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({
  visitByDefault: () => false,
  openVisitLocalId: () => undefined,
  visitForSave: (...args: unknown[]) => mockVisitForSave(...args),
}));

const earlier = Date.UTC(2026, 9, 1, 12);
const today = Date.UTC(2026, 9, 7, 12);
const venueId = "museum-met" as never;
const visitId = "00000000-0000-4000-8000-000000000099";
async function saveCapture(id: string, at: number) {
  return saveResult({
    capture: {
      localId: id,
      owner: getLocalOwner(),
      capturedAt: at,
      photoPath: `photos/${id}.jpg`,
      cropPath: `crops/${id}.jpg`,
      cropCorners: null,
      venueId,
      visitId: null,
      visitLocalId: null,
    },
    view: toResultViewState(confidentScan),
    draft: draftFromCandidate(lilies),
  });
}
beforeEach(() => {
  mockPush.mockClear();
  switchOwner(anonymousOwner());
  for (const table of [artworkEncounters, artworkPhotos, savedWorks, settings, visits]) db.delete(table).run();
  mockVisitForSave.mockReset().mockImplementation(async (_museum, at: number) => {
    const visit = {
      localId: visitId,
      venueId,
      venueName: "The Met",
      startedAt: at,
      endedAt: at,
      visitedOn: calendarDate(at, "UTC"),
      timeZone: "UTC",
    };
    await upsertVisit(visit);
    return visit;
  });
});

it("makes a retroactively added save's photo available to its visit", async () => {
  const result = await saveCapture("first-capture", today);
  const work = (await getSavedWork(result.localId))!;
  await addToMuseumVisit(venueId, [work], getLocalOwner());
  expect(selectArtworkPhotos(result.localId).all()).toHaveLength(1);
  expect(selectVisitArtworkPhotos(result.localId, visitId).all()).toHaveLength(1);
  expect(pendingAlbum(getLocalOwner()).photos[0]).toMatchObject({ visitLocalId: visitId, revision: 1 });
  const anotherVisit = "00000000-0000-4000-8000-000000000098";
  await upsertVisit({ localId: anotherVisit, venueId, venueName: "The Met", visitedOn: "2026-10-08", timeZone: "UTC" });
  recoverArtworkVisits([{ savedId: result.localId, visitId: anotherVisit }]);
  expect(selectVisitArtworkPhotos(result.localId, visitId).all()).toHaveLength(1);
  expect(selectVisitArtworkPhotos(result.localId, anotherVisit).all()).toHaveLength(0);
});

it("recovers added session photos even when an imported detail has an older capture date", async () => {
  writePhotoDraft(getLocalOwner(), "photos/with-detail.jpg", [
    {
      localId: "detail",
      path: "photos/detail.jpg",
      capturedAt: earlier,
      kind: "detail",
    },
  ]);
  const saved = await saveCapture("with-detail", today);
  const hook = await renderHook(useMakeVisit);
  await act(() => hook.result.current.make([saved.localId], undefined, saved.completion.capture));
  expect(
    selectVisitArtworkPhotos(saved.localId, visitId)
      .all()
      .map((photo) => photo.localId),
  ).toEqual(["detail", "with-detail"]);
});

it("asks for the rescan's museum instead of reusing its artwork's old museum", async () => {
  const saved = await saveCapture("unknown-museum", earlier);
  const capture = { capturedAt: today, photoIds: ["new-photo"] };
  const hook = await renderHook(useMakeVisit);
  await act(() => hook.result.current.make([saved.localId], undefined, capture));
  expect(mockVisitForSave).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/add-to-visit",
    params: {
      savedIds: saved.localId,
      capturedAt: String(today),
      photoIds: "new-photo",
    },
  });
});

it("adds the latest scan to its capture day when its artwork was saved before", async () => {
  const first = await saveCapture("first-capture", earlier);
  const second = await saveCapture("second-capture", today);
  expect(second.localId).toBe(first.localId);
  expect(selectArtworkPhotos(second.localId).all()).toHaveLength(2);
  const hook = await renderHook(useMakeVisit);
  await act(() => hook.result.current.make([second.localId], undefined, second.completion.capture));
  expect(mockVisitForSave).toHaveBeenCalledWith(venueId, today, { past: true });
  expect(
    selectVisitArtworkPhotos(second.localId, visitId)
      .all()
      .map((photo) => photo.localId),
  ).toEqual(["second-capture"]);
  expect(
    selectArtworkPhotos(second.localId)
      .all()
      .find((photo) => photo.localId === "first-capture")?.visitLocalId,
  ).toBeNull();
});
