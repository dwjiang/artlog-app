import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { NewVisit, Visit } from "@/db/schema";
import { museumDay } from "@/lib/journal/visit-date";
import { calendarDate } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";
import type { VenueCandidate } from "./resolve";
import { createVenueController, VenueResolver, type VenueController } from "./use-venue";
import { NOT_HERE_MS } from "./venue-reducer";

const mockRequestPermission = jest.fn();
const mockGetPosition = jest.fn();
const mockPush = jest.fn();
const mockMutation = jest.fn();
const mockSearchNearby = jest.fn();
const mockNearest = jest.fn();
const mockInsertConfirmed = jest.fn();
const mockCoordinates = jest.fn();
const mockVenueName = jest.fn();
const mockSignPayload = jest.fn();
const mockRefresh = jest.fn();
const mockAuth = { isAuthenticated: true };
let mockReachable = true;
const mockSettings = new Map<string, string>();
const mockVisits = new Map<string, Visit>();
let mockActivity: number | undefined;
let mockPatchRejects: string | undefined;
let mockNow = 1_000_000;
let mockUuid = 0;

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("convex/react", () => ({
  useConvexAuth: () => mockAuth,
  useQuery: () => (mockAuth.isAuthenticated ? "registered" : null),
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: mockReachable }),
}));
jest.mock("../../../convex/_generated/api", () => ({
  api: {
    devices: { me: "me" },
    museums: { confirmPoiVenue: "confirmPoiVenue" },
  },
}));
jest.mock("../../../modules/poi-search/src", () => ({
  getPoiSearch: () => ({
    searchNearby: (...args: unknown[]) => mockSearchNearby(...args),
  }),
}));
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
  removeSetting: async (key: string) => {
    mockSettings.delete(key);
  },
}));
jest.mock("@/db/repos/visits", () => ({
  upsertVisit: async (visit: NewVisit) => {
    const existing = mockVisits.get(visit.localId);
    const merged = {
      owner: "device:test-installation",
      endedAt: null,
      remoteVisitId: null,
      visitedOn: "1970-01-01",
      timeZone: "America/New_York",
      reflection: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
      ...existing,
      ...Object.fromEntries(Object.entries(visit).filter(([, v]) => v !== undefined)),
    } as Visit;
    mockVisits.set(visit.localId, merged);
  },
  getVisit: async (localId: string) => mockVisits.get(localId),
  findVisitOnDay: async (venueId: string, visitedOn: string, _owner: string, { open = false } = {}) =>
    [...mockVisits.values()]
      .filter(
        (visit) => visit.venueId === venueId && visit.visitedOn === visitedOn && (!open || visit.endedAt === null),
      )
      .sort((a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity))[0],
  listOpenVisits: async () =>
    [...mockVisits.values()].filter((visit) => visit.startedAt !== null && visit.endedAt === null),
  latestVisitActivity: async () => mockActivity,
  patchVisit: async (localId: string, fields: Partial<Visit>) => {
    if (localId === mockPatchRejects) throw new Error("invalid_visit");
    const row = mockVisits.get(localId);
    if (row) mockVisits.set(localId, { ...row, ...fields, syncedAt: null });
  },
}));
jest.mock("@/lib/attested-write", () => ({
  signPayload: (...args: unknown[]) => mockSignPayload(...args),
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("./venue-db", () => ({
  venueCoordinates: (...args: unknown[]) => mockCoordinates(...args),
  venueNameById: (...args: unknown[]) => mockVenueName(...args),
  openVenueDb: async () => "venue-db",
  nearest: (...args: unknown[]) => mockNearest(...args),
  applyVenueMetadata: (...args: unknown[]) => mockInsertConfirmed(...args),
}));
let mockSyncRunning: Promise<void> | undefined;
jest.mock("@/lib/account/collection-sync", () => ({
  flushJournal: async () => {
    if (mockSyncRunning) await mockSyncRunning;
    mockSyncRunning = (async () => {
      for (const visit of mockVisits.values()) {
        if (visit.syncedAt !== null) continue;
        const result = await mockMutation("syncVisit", { ...visit });
        visit.remoteVisitId = result?.visitId ?? visit.remoteVisitId;
        visit.syncedAt = mockNow;
      }
    })();
    try {
      await mockSyncRunning;
    } finally {
      mockSyncRunning = undefined;
    }
  },
}));
jest.mock("./refresh", () => ({
  refreshVenueTableInBackground: () => mockRefresh(),
}));

const met = { lat: 40.779444444, lng: -73.963333333 };
const metId = "id-met" as Id<"museums">;
const neueId = "id-neue" as Id<"museums">;
const metRow: VenueCandidate = {
  id: metId,
  key: "wikidata:Q160236",
  name: "Metropolitan Museum of Art",
  ...met,
  website: "https://www.metmuseum.org/",
  region: "new-york",
  distanceM: 40,
};
const neueRow: VenueCandidate = {
  ...metRow,
  id: neueId,
  key: "wikidata:Q1",
  name: "Neue Galerie",
  website: null,
  distanceM: 320,
};
const place = {
  name: "Corner Gallery",
  lat: 40.78,
  lng: -73.96,
  website: "https://corner.example",
  category: "unknown",
  distanceMeters: 80,
};
const CURRENT = "currentVisit:device:test-installation";
const ENDED = "endedVisit:device:test-installation";
const DAY = 24 * 60 * 60 * 1000;
/** A museum picked from search on the museum's current day. */
const byHand = () => museumDay(met, mockNow);

let controller: VenueController;
let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(Date, "now").mockImplementation(() => mockNow);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockNow = 1_000_000;
  mockActivity = undefined;
  mockPatchRejects = undefined;
  mockUuid = 0;
  mockAuth.isAuthenticated = true;
  mockReachable = true;
  mockSettings.clear();
  mockVisits.clear();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockGetPosition.mockResolvedValue({
    coords: { latitude: met.lat, longitude: met.lng },
    timestamp: mockNow,
  });
  mockNearest.mockResolvedValue([]);
  mockSearchNearby.mockResolvedValue([]);
  mockMutation.mockImplementation(async (ref: string) =>
    ref === "syncVisit"
      ? { visitId: "remote-1" }
      : {
          venueId: "id-corner",
          venue: {
            id: "id-corner",
            key: "poi:corner",
            region: "US",
            name: "Corner Gallery",
            lat: 40.8,
            lng: -73.9,
          },
        },
  );
  mockSignPayload.mockResolvedValue({
    nonce: "nonce",
    assertionBase64: "assertion",
    payloadJson: "{}",
  });
  mockInsertConfirmed.mockResolvedValue(undefined);
  mockCoordinates.mockResolvedValue({ lat: 40.779, lng: -73.963 });
  mockVenueName.mockResolvedValue(undefined);
  controller = createVenueController();
});
afterEach(() => jest.restoreAllMocks());

async function mountResolver() {
  await act(async () => {
    await render(<VenueResolver controller={controller} />);
  });
  await act(async () => {
    await controller.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("resolving the museum", () => {
  it("resolves a single nearby venue without a visit; the first save starts one dated by the shutter and syncs it", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    expect(mockGetPosition).toHaveBeenCalledWith({ accuracy: 3 });
    expect(mockNearest).toHaveBeenCalledWith("venue-db", { lat: met.lat, lng: met.lng, at: mockNow }, 400);
    expect(controller.getState().status).toBe("resolved");
    expect(controller.getContext()).toEqual({ venueId: "id-met" });
    expect(mockVisits.size).toBe(0);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(controller.visitByDefault(metId)).toBe(true);
    const visit = await controller.visitForSave(metId, mockNow - 500);
    await controller.syncRemoteVisit();
    expect(visit).toMatchObject({
      localId: "uuid-1",
      venueId: "id-met",
      venueName: "Metropolitan Museum of Art",
      startedAt: mockNow - 500,
      timeZone: "America/New_York",
    });
    expect(controller.getContext()).toEqual({
      visitLocalId: "uuid-1",
      venueId: "id-met",
      visitId: "remote-1",
    });
    expect(mockMutation).toHaveBeenCalledWith(
      "syncVisit",
      expect.objectContaining({ venueId: "id-met", localId: "uuid-1" }),
    );
    expect(mockVisits.get("uuid-1")).toMatchObject({
      venueId: "id-met",
      startedAt: mockNow - 500,
      endedAt: null,
      remoteVisitId: "remote-1",
    });
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
  });

  it("reuses the fix for three minutes and asks again after the app was backgrounded", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await mountResolver();
    expect(mockGetPosition).toHaveBeenCalledTimes(1);
    mockNow += 2 * 60 * 1000;
    await act(async () => {
      await controller.resolve();
    });
    expect(mockGetPosition).toHaveBeenCalledTimes(1);
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
    });
    expect(mockGetPosition).toHaveBeenCalledTimes(2);
    expect(mockVisits.size).toBe(0);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("asks between two seeded venues, opens the picker once, and a choice resolves that museum without a visit", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await mountResolver();
    expect(controller.getState().status).toBe("choose");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/venue-picker",
      params: { mode: "choose" },
    });
    expect(controller.getContext()).toEqual({});
    const option = controller.getState().options[1];
    await act(async () => {
      await controller.confirm(option);
    });
    expect(controller.getState().status).toBe("resolved");
    expect(controller.getContext()).toEqual({ venueId: "id-neue" });
    expect(mockVisits.size).toBe(0);
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("searches MapKit when nothing seeded is near and confirms a place through the attested mutation", async () => {
    mockSearchNearby.mockResolvedValue([place]);
    await mountResolver();
    expect(mockSearchNearby).toHaveBeenCalledWith(met.lat, met.lng, 300);
    expect(controller.getState()).toMatchObject({
      status: "none",
      options: [{ kind: "poi", name: "Corner Gallery", distanceM: 80 }],
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      await controller.confirm(controller.getState().options[0]);
    });
    const fields = {
      name: "Corner Gallery",
      lat: 40.78,
      lng: -73.96,
      website: "https://corner.example",
    };
    expect(mockSignPayload).toHaveBeenCalledWith({
      action: "museums.confirmPoiVenue",
      ...fields,
    });
    expect(mockMutation).toHaveBeenCalledWith("confirmPoiVenue", {
      ...fields,
      nonce: "nonce",
      assertionBase64: "assertion",
      payloadJson: "{}",
    });
    expect(mockInsertConfirmed).toHaveBeenCalledWith("venue-db", [
      expect.objectContaining({ id: "id-corner", name: "Corner Gallery" }),
    ]);
    expect(controller.getContext()).toEqual({ venueId: "id-corner" });
    expect(mockVisits.size).toBe(0);
    await expect(controller.visitForSave("id-corner" as Id<"museums">, mockNow)).resolves.toMatchObject({
      venueId: "id-corner",
      venueName: "Corner Gallery",
    });
    expect(mockMutation).toHaveBeenCalledWith(
      "syncVisit",
      expect.objectContaining({ venueId: "id-corner", localId: "uuid-1" }),
    );
  });

  it("does not open the picker when MapKit finds nothing, and refuses a place on a device that cannot attest", async () => {
    await mountResolver();
    expect(controller.getState().status).toBe("none");
    expect(mockPush).not.toHaveBeenCalled();
    mockSignPayload.mockResolvedValue(null);
    await expect(
      controller.confirm({
        kind: "poi",
        name: "X",
        lat: 1,
        lng: 2,
        distanceM: 5,
        category: "unknown",
      }),
    ).rejects.toThrow("cannot confirm");
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("records a denied permission without asking for a position", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false });
    await expect(controller.resolve()).resolves.toEqual({});
    expect(mockGetPosition).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("denied");
  });

  it("keeps the last venue when the fix fails and reports the error", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockNow += 10 * 60 * 1000;
    mockGetPosition.mockRejectedValue(new Error("Location services are disabled"));
    await controller.resolve();
    await controller.syncRemoteVisit();
    expect(controller.getContext()).toEqual({
      visitLocalId: "uuid-1",
      venueId: "id-met",
      visitId: "remote-1",
    });
    expect(controller.getState()).toMatchObject({
      status: "resolved",
      error: "Location services are disabled",
    });
  });
});

describe("the visit a save links to", () => {
  it("joins the visit open at the museum on the capture day and moves its start back to an earlier shutter", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const first = await controller.visitForSave(metId, mockNow);
    expect(await controller.visitForSave(metId, mockNow + 60_000)).toMatchObject({
      localId: first.localId,
      startedAt: mockNow,
    });
    expect(await controller.visitForSave(metId, mockNow - 60_000)).toMatchObject({
      localId: first.localId,
      startedAt: mockNow - 60_000,
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({
      startedAt: mockNow - 60_000,
      endedAt: null,
    });
    expect(controller.getState().visit?.startedAt).toBe(mockNow - 60_000);
    expect(mockVisits.size).toBe(1);
  });

  it("gives a capture from an earlier day its own visit without disturbing the one open today", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const today = await controller.visitForSave(metId, mockNow);
    const yesterday = await controller.visitForSave(metId, mockNow - DAY);
    expect(yesterday.localId).not.toBe(today.localId);
    expect(yesterday.visitedOn < today.visitedOn).toBe(true);
    expect(controller.getState().visit?.localId).toBe(today.localId);
    expect(mockVisits.get(today.localId)).toMatchObject({ endedAt: null });
    // Yesterday is over: the visit spans exactly its saves instead of staying open with nothing to close it.
    expect(mockVisits.get(yesterday.localId)).toMatchObject({
      startedAt: mockNow - DAY,
      endedAt: mockNow - DAY,
    });
    expect(mockSettings.get(CURRENT)).toBe(today.localId);
  });

  it("joins the visit already on the books for an earlier day instead of starting another, stretching it over the shutter", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const today = await controller.visitForSave(metId, mockNow);
    const yesterday = await controller.visitForSave(metId, mockNow - DAY);
    await expect(controller.visitForSave(metId, mockNow - DAY + 60_000)).resolves.toMatchObject({
      localId: yesterday.localId,
      startedAt: mockNow - DAY,
    });
    await expect(controller.visitForSave(metId, mockNow - DAY - 60_000)).resolves.toMatchObject({
      localId: yesterday.localId,
      startedAt: mockNow - DAY - 60_000,
    });
    // A later save from that day moves the ending after its shutter; an earlier one moves only the start.
    expect(mockVisits.get(yesterday.localId)).toMatchObject({
      startedAt: mockNow - DAY - 60_000,
      endedAt: mockNow - DAY + 60_000,
    });
    await expect(controller.visitForSave(metId, mockNow - DAY + 120_000)).resolves.toMatchObject({
      localId: yesterday.localId,
    });
    expect(mockVisits.get(yesterday.localId)).toMatchObject({
      startedAt: mockNow - DAY - 60_000,
      endedAt: mockNow - DAY + 120_000,
    });
    expect(mockVisits.size).toBe(2);
    expect(controller.getState().visit?.localId).toBe(today.localId);
  });

  it("joins a visit created by hand for today at the museum, giving it the shutter as its start", async () => {
    const manual = {
      owner: "device:test-installation",
      localId: "manual",
      venueId: metId,
      venueName: "The Met",
      visitedOn: calendarDate(mockNow, "America/New_York"),
      timeZone: "America/New_York",
      visibility: "public",
      reflection: null,
      startedAt: null,
      endedAt: null,
      remoteVisitId: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
    } as Visit;
    mockVisits.set(manual.localId, manual);
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "manual",
      startedAt: mockNow,
    });
    expect(mockVisits.get("manual")).toMatchObject({
      startedAt: mockNow,
      endedAt: null,
    });
    expect(controller.getContext()).toMatchObject({
      venueId: "id-met",
      visitLocalId: "manual",
    });
    expect(mockSettings.get(CURRENT)).toBe("manual");
  });

  it("leaves the visit open elsewhere alone when saving a same-day capture from another museum; the return there joins it", async () => {
    mockNearest
      .mockResolvedValueOnce([metRow])
      .mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }])
      .mockResolvedValueOnce([metRow]);
    await controller.resolve();
    const morning = mockNow;
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-neue" });
    await controller.visitForSave(neueId, mockNow);
    mockVenueName.mockResolvedValue("Metropolitan Museum of Art");
    const met = await controller.visitForSave(metId, morning);
    expect(met).toMatchObject({ venueId: "id-met", startedAt: morning });
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
    expect(mockVisits.get("uuid-1")).toMatchObject({
      venueId: "id-neue",
      endedAt: null,
    });
    expect(mockVisits.get(met.localId)).toMatchObject({ endedAt: null });
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: met.localId,
      startedAt: morning,
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: mockNow });
    expect(controller.getContext()).toMatchObject({
      venueId: "id-met",
      visitLocalId: met.localId,
    });
    expect(mockVisits.size).toBe(2);
  });

  it("closes a visit left open for another museum once its day has passed, with its last artwork, at the next fix", async () => {
    mockNearest.mockResolvedValue([{ ...neueRow, distanceM: 30 }]);
    await controller.resolve();
    await controller.visitForSave(neueId, mockNow);
    mockVenueName.mockResolvedValue("Metropolitan Museum of Art");
    const met = await controller.visitForSave(metId, mockNow - 60_000);
    expect(mockVisits.get(met.localId)).toMatchObject({ endedAt: null });
    expect(controller.getState().visit?.venueId).toBe("id-neue");
    mockActivity = mockNow + 60_000;
    mockNow += DAY;
    await controller.resolve();
    expect(mockVisits.get(met.localId)).toMatchObject({
      endedAt: mockActivity,
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({
      venueId: "id-neue",
      endedAt: mockActivity,
    });
    expect(controller.getState().visit).toBeUndefined();
  });

  it("starts the visit for a capture whose museum is no longer the resolved one, naming it from the table", async () => {
    mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([]);
    await controller.resolve();
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({});
    mockVenueName.mockResolvedValue("Metropolitan Museum of Art");
    const visit = await controller.visitForSave(metId, mockNow - 5 * 60 * 1000);
    expect(mockVenueName).toHaveBeenCalledWith("id-met");
    expect(visit).toMatchObject({
      venueId: "id-met",
      venueName: "Metropolitan Museum of Art",
      startedAt: mockNow - 5 * 60 * 1000,
    });
    expect(controller.getState().visit?.localId).toBe(visit.localId);
    // Paused away from the museum: scans out here carry nothing.
    expect(controller.getContext()).toEqual({});
  });

  it("keeps a visit open when a later fix resolves another museum; the first save there closes it and starts the new one", async () => {
    mockMutation.mockImplementation(async (ref: string, args: { localId?: string }) =>
      ref === "syncVisit" ? { visitId: args.localId === "uuid-2" ? "remote-2" : "remote-1" } : {},
    );
    mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-neue" });
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    await controller.visitForSave(neueId, mockNow);
    await controller.syncRemoteVisit();
    expect(controller.getContext()).toEqual({
      visitLocalId: "uuid-2",
      venueId: "id-neue",
      visitId: "remote-2",
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({
      endedAt: mockNow,
      remoteVisitId: "remote-1",
    });
    expect(mockVisits.get("uuid-2")).toMatchObject({
      venueId: "id-neue",
      endedAt: null,
      remoteVisitId: "remote-2",
    });
    expect(mockSettings.get(CURRENT)).toBe("uuid-2");
  });

  it("reports a save that cannot start its visit and leaves nothing behind", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    mockCoordinates.mockRejectedValueOnce(new Error("table busy"));
    await expect(controller.visitForSave(metId, mockNow)).rejects.toThrow("table busy");
    expect(mockVisits.size).toBe(0);
    expect(controller.getState().visit).toBeUndefined();
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "uuid-1",
    });
  });

  it("starts the server visit later when the session was not ready at the save", async () => {
    mockAuth.isAuthenticated = false;
    mockNearest.mockResolvedValue([metRow]);
    mockMutation.mockRejectedValue(new Error("unauthenticated"));
    const view = await render(<VenueResolver controller={controller} />);
    await act(async () => {
      await controller.resolve();
      await controller.visitForSave(metId, mockNow);
    });
    expect(controller.getContext()).toEqual({
      visitLocalId: "uuid-1",
      venueId: "id-met",
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({ remoteVisitId: null });
    mockAuth.isAuthenticated = true;
    mockMutation.mockResolvedValue({ visitId: "remote-1" });
    await act(async () => {
      await view.rerender(<VenueResolver controller={controller} />);
    });
    expect(mockMutation).toHaveBeenLastCalledWith(
      "syncVisit",
      expect.objectContaining({ venueId: "id-met", localId: "uuid-1" }),
    );
    expect(controller.getContext()).toEqual({
      visitLocalId: "uuid-1",
      venueId: "id-met",
      visitId: "remote-1",
    });
  });
});

describe("scans", () => {
  it("lets a scan go out with the last context when the fix takes longer than three seconds", async () => {
    jest.useFakeTimers();
    try {
      mockGetPosition.mockReturnValue(new Promise(() => {}));
      const pending = controller.resolveForScan(mockNow);
      jest.advanceTimersByTime(3000);
      await expect(pending).resolves.toEqual({});
      expect(controller.getState().status).toBe("locating");
    } finally {
      jest.useRealTimers();
    }
  });

  it("carries the museum only until the first save, then the open visit, moved back to an earlier shutter", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await expect(controller.resolveForScan(mockNow)).resolves.toEqual({
      venueId: "id-met",
    });
    expect(mockVisits.size).toBe(0);
    await controller.visitForSave(metId, mockNow);
    await controller.syncRemoteVisit();
    await expect(controller.resolveForScan(mockNow + 1000)).resolves.toEqual({
      venueId: "id-met",
      visitLocalId: "uuid-1",
      visitId: "remote-1",
    });
    await expect(controller.resolveForScan(mockNow - 1000)).resolves.toEqual({
      venueId: "id-met",
      visitLocalId: "uuid-1",
      visitId: "remote-1",
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({
      startedAt: mockNow - 1000,
    });
    expect(mockVisits.size).toBe(1);
  });

  it("never opens the sheet over a scan; the next foreground asks instead", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    mockSearchNearby.mockResolvedValue([place]);
    await act(async () => {
      await render(<VenueResolver controller={controller} />);
    });
    mockPush.mockClear();
    mockNow += 5 * 60 * 1000;
    await act(async () => {
      await controller.resolveForScan(mockNow);
    });
    expect(controller.getState().status).toBe("choose");
    mockNearest.mockResolvedValue([]);
    mockNow += 5 * 60 * 1000;
    await act(async () => {
      await controller.resolveForScan(mockNow);
    });
    expect(controller.getState().options).toEqual([expect.objectContaining({ kind: "poi" })]);
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe("pausing, ending and the day", () => {
  it("pauses the visit when a later fix finds nothing nearby and resumes it on return", async () => {
    mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([]).mockResolvedValueOnce([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({});
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toMatchObject({
      venueId: "id-met",
      visitLocalId: "uuid-1",
    });
    expect(mockVisits.size).toBe(1);
  });

  it("after End, saves at that museum default to no visit for the day; choosing the museum starts a fresh visit and forgets the ending", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await controller.end("uuid-1");
    expect(mockSettings.get(ENDED)).toBe("uuid-1");
    expect(controller.visitByDefault(metId)).toBe(false);
    expect(controller.visitByDefault(neueId)).toBe(true);
    mockNow += 5 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    expect(mockVisits.size).toBe(1);
    expect(controller.getState().visit).toBeUndefined();
    // A relaunch the same day remembers the ending.
    const relaunched = createVenueController();
    await relaunched.hydrate();
    await expect(relaunched.resolve()).resolves.toEqual({ venueId: "id-met" });
    expect(relaunched.visitByDefault(metId)).toBe(false);
    await expect(relaunched.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "uuid-2",
      venueId: "id-met",
    });
    expect(relaunched.visitByDefault(metId)).toBe(true);
    expect(mockSettings.has(ENDED)).toBe(false);
    expect(relaunched.getContext()).toMatchObject({
      venueId: "id-met",
      visitLocalId: "uuid-2",
    });
  });

  it("confirming the museum in the sheet after End also makes its visit the default again", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await controller.end("uuid-1");
    await controller.confirm(controller.getState().options[0]);
    expect(controller.visitByDefault(metId)).toBe(true);
    expect(mockVisits.size).toBe(1);
    const relaunched = createVenueController();
    await relaunched.hydrate();
    expect(relaunched.visitByDefault(metId)).toBe(true);
  });

  it("defaults to a visit again at that museum the next day after an ending by hand", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await controller.end("uuid-1");
    mockNow += DAY;
    const relaunched = createVenueController();
    await relaunched.hydrate();
    expect(mockSettings.has(ENDED)).toBe(false);
    await expect(relaunched.resolve()).resolves.toEqual({ venueId: "id-met" });
    expect(relaunched.visitByDefault(metId)).toBe(true);
  });

  it("ends the visit on End and syncs the ending", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await controller.syncRemoteVisit();
    mockNow += 10 * 60 * 1000;
    await controller.end("uuid-1");
    await controller.syncRemoteVisit();
    expect(mockVisits.get("uuid-1")).toMatchObject({
      endedAt: mockNow,
      remoteVisitId: "remote-1",
    });
    expect(mockMutation).toHaveBeenCalledWith(
      "syncVisit",
      expect.objectContaining({ remoteVisitId: "remote-1", endedAt: mockNow }),
    );
    expect(mockSettings.has(CURRENT)).toBe(false);
    expect(controller.getState().visit).toBeUndefined();
    expect(controller.getContext()).toEqual({ venueId: "id-met" });
    await controller.end("uuid-1");
    expect(mockVisits.size).toBe(1);
  });

  it("leaves the current visit open when saving an older end-visit review", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await controller.end("older-visit");
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
  });

  it("restores an open visit and resumes it instead of starting another local one", async () => {
    mockVisits.set("existing", {
      visibility: "public" as const,
      owner: "device:test-installation",
      localId: "existing",
      venueId: metId,
      venueName: "Metropolitan Museum of Art",
      startedAt: mockNow - 10 * 60 * 1000,
      endedAt: null,
      remoteVisitId: null,
      visitedOn: "1970-01-01",
      timeZone: "UTC",
      reflection: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
    });
    mockSettings.set(CURRENT, "existing");
    mockNearest.mockResolvedValue([metRow]);
    await controller.hydrate();
    expect(controller.getContext()).toEqual({
      visitLocalId: "existing",
      venueId: "id-met",
    });
    await controller.resolve();
    await controller.syncRemoteVisit();
    expect(controller.getContext()).toEqual({
      visitLocalId: "existing",
      venueId: "id-met",
      visitId: "remote-1",
    });
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "existing",
    });
    expect(mockVisits.size).toBe(1);
    expect(mockMutation).toHaveBeenCalledWith(
      "syncVisit",
      expect.objectContaining({ venueId: "id-met", localId: "existing" }),
    );
  });

  it("closes every visit from an earlier day at launch, ending each with its last saved artwork, not only the tracked one", async () => {
    const startedAt = mockNow - 5 * 60 * 60 * 1000;
    const stale = {
      visibility: "public" as const,
      owner: "device:test-installation",
      localId: "stale",
      venueId: metId,
      venueName: "Met",
      startedAt,
      endedAt: null,
      remoteVisitId: "remote-old" as Id<"visits">,
      visitedOn: "1969-12-31",
      timeZone: "UTC",
      reflection: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
    };
    mockVisits.set("stale", stale);
    mockVisits.set("elsewhere", {
      ...stale,
      localId: "elsewhere",
      venueId: neueId,
      venueName: "Neue",
      remoteVisitId: null,
    });
    mockSettings.set(CURRENT, "stale");
    mockActivity = mockNow - 60 * 60 * 1000;
    await controller.hydrate();
    expect(mockVisits.get("stale")).toMatchObject({ endedAt: mockActivity });
    expect(mockVisits.get("elsewhere")).toMatchObject({
      endedAt: mockActivity,
    });
    expect(mockSettings.has(CURRENT)).toBe(false);
    expect(controller.getContext()).toEqual({});
  });

  it("skips a stale visit that will not close and still restores, resolves and sweeps the rest", async () => {
    const startedAt = mockNow - 5 * 60 * 60 * 1000;
    const stale = {
      visibility: "public" as const,
      owner: "device:test-installation",
      localId: "ahead",
      venueId: neueId,
      venueName: "Neue",
      startedAt,
      endedAt: null,
      remoteVisitId: "remote-old" as Id<"visits">,
      visitedOn: "1970-01-02",
      timeZone: "UTC",
      reflection: null,
      syncedAt: mockNow,
      syncedBy: null,
      revision: 0,
    };
    mockVisits.set("ahead", stale);
    mockVisits.set("stale", {
      ...stale,
      localId: "stale",
      venueId: metId,
      venueName: "Met",
      visitedOn: "1969-12-31",
    });
    mockPatchRejects = "ahead";
    mockNearest.mockResolvedValue([metRow]);
    await mountResolver();
    expect(console.warn).toHaveBeenCalledWith("Could not close the visit", "ahead", expect.any(Error));
    expect(mockVisits.get("ahead")).toMatchObject({ endedAt: null });
    expect(mockVisits.get("stale")).toMatchObject({ endedAt: startedAt });
    expect(controller.getState()).toMatchObject({
      status: "resolved",
      venue: { venueId: "id-met" },
      error: undefined,
    });
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      venueId: "id-met",
    });
  });

  it("closes an earlier day's visit with no artworks at its start time", async () => {
    const startedAt = mockNow - 5 * 60 * 60 * 1000;
    mockVisits.set("empty", {
      visibility: "public" as const,
      owner: "device:test-installation",
      localId: "empty",
      venueId: metId,
      venueName: "Met",
      startedAt,
      endedAt: null,
      remoteVisitId: null,
      visitedOn: "1969-12-31",
      timeZone: "UTC",
      reflection: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
    });
    mockSettings.set(CURRENT, "empty");
    await controller.hydrate();
    expect(mockVisits.get("empty")).toMatchObject({ endedAt: startedAt });
  });

  it("closes a visit left open across midnight at the next fix, so the next save starts that day's visit", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockActivity = mockNow + 60_000;
    mockNow += DAY;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: mockActivity });
    expect(controller.getState().visit).toBeUndefined();
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "uuid-2",
    });
    expect(mockSettings.get(CURRENT)).toBe("uuid-2");
  });
});

describe("the sheet", () => {
  it('"Not here" keeps a visit paused elsewhere and does not reopen the sheet nearby', async () => {
    mockVisits.set("old", {
      visibility: "public" as const,
      owner: "device:test-installation",
      localId: "old",
      venueId: "id-old" as Id<"museums">,
      venueName: "Old",
      startedAt: mockNow - 1000,
      endedAt: null,
      remoteVisitId: null,
      visitedOn: "1970-01-01",
      timeZone: "UTC",
      reflection: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
    });
    mockSettings.set(CURRENT, "old");
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await act(async () => {
      await render(<VenueResolver controller={controller} />);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/venue-picker",
      params: { mode: "choose" },
    });
    await act(async () => {
      controller.dismiss();
    });
    expect(mockVisits.get("old")).toMatchObject({ endedAt: null });
    expect(mockSettings.get(CURRENT)).toBe("old");
    expect(controller.getState().visit?.localId).toBe("old");
    expect(controller.getContext()).toEqual({});
    mockNow += 5 * 60 * 1000;
    await act(async () => {
      await controller.resolve();
    });
    expect(mockGetPosition).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("keeps resolving local venues and confirming seeded choices while the server is offline", async () => {
    const remote = deferred<{ visitId: string }>();
    mockMutation.mockReturnValueOnce(remote.promise);
    mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }]);
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({
      localId: "uuid-1",
    });
    mockNow += 5 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-neue" });
    await controller.confirm(controller.getState().options[0]);
    expect(mockGetPosition).toHaveBeenCalledTimes(2);
    expect(mockVisits.get("uuid-1")?.endedAt).toBeNull();
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(controller.getContext()).toEqual({ venueId: "id-neue" });
    await expect(controller.visitForSave(neueId, mockNow)).resolves.toMatchObject({
      localId: "uuid-2",
      venueId: "id-neue",
    });
    expect(mockVisits.get("uuid-1")?.endedAt).toBe(mockNow);
    remote.resolve({ visitId: "remote-old" });
    await controller.syncRemoteVisit();
    expect(mockVisits.get("uuid-2")?.remoteVisitId).toBeTruthy();
  });

  it("honors Not here when a subsequent fix automatically finds the same venue", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    controller.dismiss();
    mockNow += 5 * 60 * 1000;
    await controller.resolve();
    expect(controller.getContext()).toEqual({});
    expect(mockVisits.size).toBe(0);
    await controller.confirm(controller.getState().options[0]);
    expect(controller.getContext()).toEqual({ venueId: "id-met" });
  });

  it("ends the visit when Not here is tapped over its own museum", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await act(async () => {
      controller.dismiss();
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: mockNow });
    expect(controller.getState().visit).toBeUndefined();
    expect(controller.visitByDefault(metId)).toBe(true);
  });

  it("ignores a POI confirmation dismissed while signing", async () => {
    mockSearchNearby.mockResolvedValue([place]);
    await controller.resolve();
    const signed = deferred<{
      nonce: string;
      assertionBase64: string;
      payloadJson: string;
    }>();
    mockSignPayload.mockReturnValue(signed.promise);
    const confirming = controller.confirm(controller.getState().options[0]);
    controller.dismiss();
    signed.resolve({
      nonce: "nonce",
      assertionBase64: "assertion",
      payloadJson: "{}",
    });
    await confirming;
    expect(controller.getContext()).toEqual({});
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("does not resolve the place if the sheet unmounts while the server confirms it", async () => {
    mockSearchNearby.mockResolvedValue([place]);
    await controller.resolve();
    const remote = deferred<{
      venueId: string;
      venue: {
        id: string;
        key: string;
        region: string;
        name: string;
        lat: number;
        lng: number;
      };
    }>();
    mockMutation.mockReturnValueOnce(remote.promise);
    const abort = new AbortController();
    const confirming = controller.confirm(controller.getState().options[0], abort.signal);
    await Promise.resolve();
    abort.abort();
    remote.resolve({
      venueId: "id-corner",
      venue: {
        id: "id-corner",
        key: "poi:corner",
        region: "US",
        name: "Corner Gallery",
        lat: 40.8,
        lng: -73.9,
      },
    });
    await confirming;
    expect(controller.getContext()).toEqual({});
    expect(mockInsertConfirmed).not.toHaveBeenCalled();
  });

  it("retries an unsent visit ending when connectivity returns", async () => {
    mockNearest.mockResolvedValue([metRow]);
    const view = await render(<VenueResolver controller={controller} />);
    await act(async () => {
      await controller.resolve();
      await controller.visitForSave(metId, mockNow);
      await controller.syncRemoteVisit();
    });
    mockReachable = false;
    await view.rerender(<VenueResolver controller={controller} />);
    mockMutation.mockRejectedValue(new Error("offline"));
    await act(async () => {
      controller.dismiss();
    });
    await controller.syncRemoteVisit();
    expect(mockVisits.get("uuid-1")).toMatchObject({
      endedAt: mockNow,
      syncedAt: null,
    });
    mockMutation.mockResolvedValue(null);
    mockReachable = true;
    await act(async () => {
      await view.rerender(<VenueResolver controller={controller} />);
    });
    expect(mockMutation).toHaveBeenLastCalledWith(
      "syncVisit",
      expect.objectContaining({ remoteVisitId: "remote-1", endedAt: mockNow }),
    );
    expect(mockVisits.get("uuid-1")).toMatchObject({ syncedAt: mockNow });
  });

  it.each(["none", "auto"] as const)(
    "keeps a confirmed museum and its visit when an older fix returns %s",
    async (result) => {
      mockNearest.mockResolvedValueOnce([metRow, neueRow]);
      await controller.resolve();
      const selected = controller.getState().options[1];
      mockNow += 5 * 60 * 1000;
      const fix = deferred<{
        coords: { latitude: number; longitude: number };
      }>();
      mockGetPosition.mockReturnValueOnce(fix.promise);
      mockNearest.mockResolvedValueOnce(result === "none" ? [] : [metRow]);
      const resolving = controller.resolve();
      await Promise.resolve();
      await controller.confirm(selected);
      await controller.visitForSave(neueId, mockNow);
      fix.resolve({ coords: { latitude: met.lat, longitude: met.lng } });
      await resolving;
      await controller.syncRemoteVisit();
      expect(controller.getContext().venueId).toBe("id-neue");
      expect([...mockVisits.values()].filter((visit) => visit.endedAt === null)).toEqual([
        expect.objectContaining({ localId: "uuid-1", venueId: "id-neue" }),
      ]);
      expect(mockSettings.get(CURRENT)).toBe("uuid-1");
      await controller.hydrate();
      expect(controller.getContext().venueId).toBe("id-neue");
    },
  );

  it("keeps a museum picked from the list through backgrounding and a relaunch without asking again", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await mountResolver();
    expect(mockPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      await controller.confirm(controller.getState().options[1]);
    });
    mockNow += 60 * 1000;
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
    });
    expect(mockGetPosition).toHaveBeenCalledTimes(2);
    expect(controller.getContext()).toEqual({ venueId: "id-neue" });
    controller = createVenueController();
    await mountResolver();
    expect(controller.getContext()).toEqual({ venueId: "id-neue" });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("forgets a pick once a visit starts at another museum, also after a relaunch", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await mountResolver();
    await act(async () => {
      await controller.confirm(controller.getState().options[1]);
    });
    mockNearest.mockResolvedValue([metRow]);
    mockNow += 5 * 60 * 1000;
    await act(async () => {
      await controller.resolve();
      await controller.visitForSave(metId, mockNow);
    });
    mockNearest.mockResolvedValue([metRow, neueRow]);
    controller = createVenueController();
    await mountResolver();
    expect(controller.getContext()).toMatchObject({
      venueId: "id-met",
      visitLocalId: "uuid-1",
    });
  });

  it("declines a swiped-away prompt like Not here unless a museum resolved while it was open", async () => {
    const moveTo = async (rows: VenueCandidate[]) => {
      mockNearest.mockResolvedValue(rows);
      mockNow += 5 * 60 * 1000;
      await act(async () => {
        appStateListener?.("background");
        appStateListener?.("active");
      });
    };
    mockSearchNearby.mockResolvedValue([place]);
    mockNearest.mockResolvedValue([metRow]);
    await mountResolver();
    await act(async () => {
      await controller.visitForSave(metId, mockNow);
    });
    await moveTo([]);
    expect(mockPush).toHaveBeenCalledTimes(1);
    await moveTo([metRow]);
    await act(async () => {
      controller.declinePrompt();
    });
    expect(controller.getContext()).toMatchObject({
      venueId: "id-met",
      visitLocalId: "uuid-1",
    });
    expect(mockVisits.get("uuid-1")?.endedAt).toBeNull();
    await moveTo([]);
    expect(mockPush).toHaveBeenCalledTimes(2);
    await act(async () => {
      controller.declinePrompt();
    });
    await moveTo([]);
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(controller.getState().visit?.localId).toBe("uuid-1");
  });

  it("remembers Not here across a relaunch for two hours, then asks again", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await mountResolver();
    await act(async () => {
      controller.dismiss();
    });
    controller = createVenueController();
    await mountResolver();
    expect(mockPush).toHaveBeenCalledTimes(1);
    mockNow += NOT_HERE_MS;
    await act(async () => {
      await controller.resolve();
    });
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it("keeps the other same-name place available after confirming one branch", async () => {
    const otherBranch = {
      ...place,
      lat: place.lat + 0.001,
      distanceMeters: 190,
    };
    mockSearchNearby.mockResolvedValue([place, otherBranch]);
    await controller.resolve();
    await controller.confirm(controller.getState().options[0]);
    expect(controller.getState().options).toEqual([
      expect.objectContaining({ kind: "seeded", venueId: "id-corner" }),
      expect.objectContaining({
        kind: "poi",
        name: place.name,
        lat: otherBranch.lat,
      }),
    ]);
  });
});

it("keeps a searched museum through denied location, relaunch, and scans until the visit ends", async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  const controller = createVenueController();
  await controller.confirm({
    kind: "seeded",
    venueId: "id-Met" as Id<"museums">,
    name: "Met",
    manual: byHand(),
  });
  expect(controller.getState().visit).toBeUndefined();
  expect(await controller.resolve()).toEqual({ venueId: "id-Met" });
  const visit = await controller.visitForSave("id-Met" as Id<"museums">, mockNow);
  expect(await controller.resolve()).toMatchObject({
    venueId: "id-Met",
    visitLocalId: visit.localId,
  });
  expect(mockRequestPermission).not.toHaveBeenCalled();
  const restored = createVenueController();
  await restored.hydrate();
  expect(await restored.resolve()).toMatchObject({
    venueId: "id-Met",
    visitLocalId: visit.localId,
  });
  await restored.end(visit.localId);
  expect(restored.getContext()).toEqual({});
  expect(mockVisits.get(visit.localId)?.endedAt).not.toBeNull();
});

it("lets location take over the day after a museum was picked from search without a visit", async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  await controller.confirm({
    kind: "seeded",
    venueId: metId,
    name: metRow.name,
    manual: byHand(),
  });
  expect(await controller.resolve()).toEqual({ venueId: metId });
  expect(mockRequestPermission).not.toHaveBeenCalled();
  mockNow += DAY;
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockNearest.mockResolvedValue([{ ...neueRow, distanceM: 40 }]);
  expect(await controller.resolve()).toEqual({ venueId: neueId });
  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  expect(controller.getState().venue?.manual).toBeUndefined();
});

it("starts a museum visit privately until the owner chooses to share", async () => {
  await controller.confirm({
    kind: "seeded",
    venueId: metRow.id,
    name: metRow.name,
  });
  expect(mockVisits.size).toBe(0);
  await controller.visitForSave(metRow.id, mockNow);
  expect([...mockVisits.values()]).toEqual([expect.objectContaining({ visibility: "private" })]);
});

it("keeps a manually selected museum when its first save closes the previous visit", async () => {
  await controller.confirm({
    kind: "seeded",
    venueId: metId,
    name: metRow.name,
    manual: byHand(),
  });
  const previous = await controller.visitForSave(metId, mockNow);
  await controller.confirm({
    kind: "seeded",
    venueId: neueId,
    name: neueRow.name,
    manual: byHand(),
  });
  expect(controller.getState().visit?.localId).toBe(previous.localId);
  const next = await controller.visitForSave(neueId, mockNow);
  expect(mockVisits.get(previous.localId)?.endedAt).not.toBeNull();
  mockRequestPermission.mockResolvedValue({ granted: false });
  const restored = createVenueController();
  await restored.hydrate();
  expect(await restored.resolve()).toMatchObject({
    venueId: neueId,
    visitLocalId: next.localId,
  });
});

it("keeps a searched museum across relaunch when its visit was already open", async () => {
  await controller.confirm({
    kind: "seeded",
    venueId: metId,
    name: metRow.name,
  });
  const visit = await controller.visitForSave(metId, mockNow);
  await controller.confirm({
    kind: "seeded",
    venueId: metId,
    name: metRow.name,
    manual: byHand(),
  });
  expect(mockVisits.size).toBe(1);
  mockRequestPermission.mockResolvedValue({ granted: false });
  const restored = createVenueController();
  await restored.hydrate();
  expect(await restored.resolve()).toMatchObject({
    venueId: metId,
    visitLocalId: visit.localId,
  });
});
