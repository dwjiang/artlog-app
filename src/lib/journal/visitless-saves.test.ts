import { act, renderHook } from "@testing-library/react-native";

import { db } from "@/db/client";
import { selectArtworkEncounters } from "@/db/repos/artwork-album";
import * as savedWorksRepo from "@/db/repos/saved-works";
import { listVisits, upsertVisit } from "@/db/repos/visits";
import { artworkEncounters, savedWorks, visits } from "@/db/schema";
import { anonymousOwner, getLocalOwner, switchOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { calendarDate } from "@/shared/journal/limits";

import { addToMuseumVisit, sharedMuseum, useMakeVisit, visitlessToday } from "./visitless-saves";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockVisitForSave = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({ visitForSave: (...args: unknown[]) => mockVisitForSave(...args) }));

const noon = Date.UTC(2026, 9, 7, 17);
const HOUR = 60 * 60 * 1000;
const save = (localId: string, savedAt: number, venueId: string | null = "id-aic") => ({
  localId,
  savedAt,
  venueId: venueId as never,
  venueName: venueId ? "Art Institute of Chicago" : null,
});

it("keeps today’s saves that no visit holds and that were not set aside, in the phone’s day", () => {
  const works = [
    save("today", noon - HOUR),
    save("linked", noon - 2 * HOUR),
    save("set-aside", noon - 3 * HOUR),
    save("late-yesterday", Date.UTC(2026, 9, 7, 4)),
  ];
  expect(
    visitlessToday(works, [{ savedLocalId: "linked" }], ["set-aside"], noon, "America/Chicago").map(
      (work) => work.localId,
    ),
  ).toEqual(["today"]);
  // 4:00 UTC is still the 7th in London.
  expect(visitlessToday(works, [], [], noon, "Europe/London")).toHaveLength(4);
});

it("names the museum only when every save agrees on one", () => {
  expect(sharedMuseum([save("a", 1), save("b", 2)])).toEqual({
    venueId: "id-aic",
    venueName: "Art Institute of Chicago",
  });
  expect(sharedMuseum([save("a", 1), save("b", 2, "id-met")])).toBeUndefined();
  expect(sharedMuseum([save("a", 1, null)])).toBeUndefined();
  expect(sharedMuseum([])).toBeUndefined();
});

describe("filing saved artworks into visits", () => {
  const first = Date.UTC(2026, 9, 7, 2);
  const second = Date.UTC(2026, 9, 7, 14);
  const museum = "id-met" as never;
  function visitAt(at: number) {
    const timeZone = "America/New_York";
    const visitedOn = calendarDate(at, timeZone);
    return {
      localId:
        visitedOn === "2026-10-06" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
      venueId: museum,
      venueName: "The Met",
      timeZone,
      visitedOn,
      startedAt: at,
      endedAt: at,
      visibility: "private" as const,
    };
  }
  async function saveWork(localId: string, savedAt = second) {
    const work = save(localId, savedAt, museum);
    await savedWorksRepo.insertSavedWork({ ...work, title: localId, artist: "Artist" });
    return work;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    switchOwner(anonymousOwner(), "test-scope");
    db.delete(artworkEncounters).run();
    db.delete(savedWorks).run();
    db.delete(visits).run();
    mockVisitForSave.mockReset().mockImplementation(async (_id, at: number) => {
      const visit = visitAt(at);
      await upsertVisit(visit);
      return visit;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("keeps saves on their own museum dates when the phone's day spans two museum days", async () => {
    const works = [await saveWork("earlier", first), await saveWork("later", second)];
    const eligible = visitlessToday(works, [], [], second, "Europe/London");
    expect(eligible).toHaveLength(2);
    await addToMuseumVisit(museum, eligible, getLocalOwner());
    expect(
      selectArtworkEncounters()
        .all()
        .map(({ savedLocalId, visitLocalId }) => [savedLocalId, visitLocalId]),
    ).toEqual([
      ["earlier", visitAt(first).localId],
      ["later", visitAt(second).localId],
    ]);
  });

  it("ignores a retained save toast after the journal owner changes", async () => {
    await saveWork("previous-owner");
    const hook = await renderHook(useMakeVisit);
    const { make } = hook.result.current;
    await hook.unmount();
    switchOwner("account:next");
    await act(() => make(["previous-owner"]));
    expect(mockVisitForSave).not.toHaveBeenCalled();
    expect(await listVisits("account:next")).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it("still lets the save toast add a visit after the result screen closes for the same owner", async () => {
    await saveWork("saved");
    const hook = await renderHook(useMakeVisit);
    const { make } = hook.result.current;
    await hook.unmount();
    await act(() => make(["saved"]));
    expect(selectArtworkEncounters().all()).toEqual([
      expect.objectContaining({ savedLocalId: "saved", visitLocalId: visitAt(second).localId }),
    ]);
  });

  it.each([museum, null])("stops if ownership changes while artworks are loading (museum %s)", async (venueId) => {
    await savedWorksRepo.insertSavedWork({ ...save("loading", second, venueId), title: "Loading", artist: "Artist" });
    const read = savedWorksRepo.getSavedWork;
    jest.spyOn(savedWorksRepo, "getSavedWork").mockImplementationOnce(async (...args) => {
      const work = await read(...args);
      switchOwner("account:next");
      return work;
    });
    const hook = await renderHook(useMakeVisit);
    await act(() => hook.result.current.make(["loading"]));
    expect(mockVisitForSave).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("stops a batch before linking or resolving more visits after an owner switch", async () => {
    const owner = getLocalOwner();
    const works = [await saveWork("earlier", first), await saveWork("later", second)];
    mockVisitForSave.mockImplementationOnce(async () => {
      const visit = visitAt(first);
      await upsertVisit(visit, owner);
      switchOwner("account:next");
      return visit;
    });
    await addToMuseumVisit(museum, works, owner);
    expect(mockVisitForSave).toHaveBeenCalledTimes(1);
    expect(await listVisits("account:next")).toEqual([]);
    expect(selectArtworkEncounters(owner).all()).toEqual([]);
  });

  it("does not report an owner-change cancellation as a failed save", async () => {
    await saveWork("cancelled");
    mockVisitForSave.mockImplementationOnce(async () => {
      switchOwner("account:next");
      throw new Error("Journal owner changed");
    });
    const hook = await renderHook(useMakeVisit);
    await act(() => hook.result.current.make(["cancelled"]));
    expect(reportError).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();
  });
});
