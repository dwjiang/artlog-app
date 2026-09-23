import { act, renderHook } from "@testing-library/react-native";
import type { SavedWork } from "@/db/schema";
import { scheduleRemoval, usePendingRemovals } from "./pending-removals";
import { useCollectionData } from "./use-collection-data";

const mockReads: Record<string, { data: unknown[]; updatedAt?: Date; error?: Error }> = {};
jest.mock("drizzle-orm/expo-sqlite", () => ({ useLiveQuery: (query: string) => mockReads[query] }));
jest.mock("@/db/repos/artwork-album", () => ({
  selectArtworkEncounters: () => "encounters",
  selectAllArtworkPhotos: () => "photos",
}));
jest.mock("@/db/repos/saved-works", () => ({
  listSavedWorks: () => "works",
  softDeleteSavedWork: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/db/repos/visits", () => ({ listVisits: () => "visits" }));
jest.mock("../account/owner-store", () => ({ useLocalOwner: () => "account:a" }));
jest.mock("../journal/use-venue-metadata", () => ({
  useVenueMetadata: () => ({ metadata: new Map(), ready: true }),
}));

beforeEach(() => {
  for (const key of ["encounters", "photos", "works", "visits"])
    mockReads[key] = { data: [], updatedAt: new Date() };
});

it.each(["encounters", "photos"])(
  "keeps collection counts pending until %s finish loading",
  async (key) => {
    mockReads[key].updatedAt = undefined;
    const view = await renderHook(useCollectionData);
    expect(view.result.current.loading).toBe(true);
    mockReads[key].updatedAt = new Date();
    await view.rerender({});
    expect(view.result.current.loading).toBe(false);
  },
);

it.each(["encounters", "photos"])("ends loading and surfaces a failed %s read", async (key) => {
  const error = new Error("Local read failed");
  mockReads[key] = { data: [], error };
  const view = await renderHook(useCollectionData);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBe(error);
});

it("keeps a removed artwork hidden after Undo expires while the live query catches up", async () => {
  jest.useFakeTimers();
  try {
    const work = {
      owner: "account:a",
      localId: "removed",
      title: "Water Lilies",
      deletedAt: null,
    } as SavedWork;
    const kept = { ...work, localId: "kept", title: "Irises" };
    mockReads.works.data = [work, kept];
    mockReads.visits.data = [
      {
        owner: work.owner,
        localId: "visit",
        venueId: "museum",
        visitedOn: "2026-09-22",
        timeZone: "UTC",
      },
    ];
    mockReads.encounters.data = [
      { owner: work.owner, visitLocalId: "visit", savedLocalId: work.localId, deletedAt: null },
    ];
    const view = await renderHook(useCollectionData);
    const toast = await renderHook(usePendingRemovals);
    await act(() => scheduleRemoval(work));
    expect(view.result.current.works.map((row) => row.localId)).toEqual(["kept"]);
    expect(view.result.current.visits[0].works).toEqual([]);

    await act(() => jest.advanceTimersByTime(6000));
    expect(toast.result.current).toEqual([]);
    expect(view.result.current.works.map((row) => row.localId)).toEqual(["kept"]);
    expect(view.result.current.hiddenIds).toContain("removed");
    expect(view.result.current.visits).toHaveLength(1);
    expect(view.result.current.visits[0].works).toEqual([]);

    const secondView = await renderHook(useCollectionData);
    expect(secondView.result.current.works.map((row) => row.localId)).toEqual(["kept"]);

    mockReads.works.data = [{ ...work, deletedAt: Date.now() }, kept];
    await view.rerender({});
    expect(view.result.current.works.map((row) => row.localId)).toEqual(["kept"]);
    expect(view.result.current.loading).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
