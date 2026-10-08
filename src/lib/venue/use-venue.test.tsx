import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { NewVisit, Visit } from "@/db/schema";
import { museumDay } from "@/lib/journal/visit-date";
import { calendarDate } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";
import type { VenueCandidate } from "./resolve";
import { createVenueController, VenueResolver, VisitInProgressError, type VenueController } from "./use-venue";
import { NOT_HERE_MS } from "./venue-reducer";

const mockActivateVisit = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetPermission = jest.fn();
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
jest.mock("@/lib/journal/wrap-up", () => ({
  markWrapUp: async (owner: string, visitId: string) => {
    mockSettings.set(`wrapUpVisit:${owner}`, visitId);
  },
}));
const mockVisits = new Map<string, Visit>();
const mockLatestSaves = new Map<string, number>();
let mockNow = 1_000_000;
let mockUuid = 0;
let mockIntroduction: "pending" | "justEnded" | "over" = "over";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getForegroundPermissionsAsync: () => mockGetPermission(),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/account/introduction", () => ({ useIntroduction: () => mockIntroduction }));
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
jest.mock("@/db/repos/current-visit", () => ({
  activateVisit: (...args: unknown[]) => mockActivateVisit(...args),
  visitSettingKeys: (owner: string) => ({
    current: `currentVisit:${owner}`,
    manual: `manualVisit:${owner}`,
    ended: `endedVisit:${owner}`,
  }),
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
  patchVisit: async (localId: string, fields: Partial<Visit>) => {
    const row = mockVisits.get(localId);
    if (row) mockVisits.set(localId, { ...row, ...fields, syncedAt: null });
  },
  moveVisit: async (localId: string, to: Partial<Visit>) => {
    const row = mockVisits.get(localId);
    if (row) mockVisits.set(localId, { ...row, ...to, syncedAt: null });
  },
  latestVisitSaveAt: async (localId: string) => mockLatestSaves.get(localId),
}));
jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
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
  mockUuid = 0;
  mockIntroduction = "over";
  mockAuth.isAuthenticated = true;
  mockReachable = true;
  mockSettings.clear();
  mockVisits.clear();
  mockLatestSaves.clear();
  mockActivateVisit.mockImplementation(
    (
      visit: NewVisit,
      owner: string,
      options: {
        manual?: boolean;
        endPrevious?: { localId: string; at: number };
      },
    ) => {
      const old = options.endPrevious && mockVisits.get(options.endPrevious.localId);
      if (old) mockVisits.set(old.localId, { ...old, endedAt: options.endPrevious!.at, syncedAt: null });
      const existing = mockVisits.get(visit.localId);
      mockVisits.set(visit.localId, {
        owner,
        endedAt: null,
        remoteVisitId: null,
        reflection: null,
        syncedAt: null,
        syncedBy: null,
        revision: 0,
        ...Object.fromEntries(Object.entries(visit).filter(([, value]) => value !== undefined)),
        ...existing,
        startedAt: visit.startedAt,
      } as Visit);
      mockSettings.delete(`endedVisit:${owner}`);
      mockSettings.delete(`manualVisit:${owner}`);
      if (options.manual) mockSettings.set(`manualVisit:${owner}`, visit.localId);
      mockSettings.set(`currentVisit:${owner}`, visit.localId);
    },
  );
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockGetPermission.mockResolvedValue({ granted: true });
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

it("distinguishes an empty visit from one that has not hydrated yet", async () => {
  expect(controller.getState().hydrated).toBe(false);
  const hydration = controller.hydrate();
  expect(controller.getState().hydrated).toBe(false);
  await hydration;
  expect(controller.getState()).toMatchObject({ hydrated: true, visit: undefined });
});

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
      await expect(controller.confirm(option)).resolves.toBe("id-neue");
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

  it("opens the picker on launch once onboarding is behind the person", async () => {
    mockNearest.mockResolvedValue([metRow, neueRow]);
    await act(async () => {
      await render(<VenueResolver controller={controller} />);
    });
    await act(async () => {});
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/venue-picker",
      params: { mode: "choose" },
    });
  });

  it("checks location only after the welcome, and leaves the museum unasked when onboarding hands off to Home", async () => {
    mockIntroduction = "pending";
    mockNearest.mockResolvedValue([metRow, neueRow]);
    const view = await render(<VenueResolver controller={controller} />);
    await act(async () => {});
    expect(mockGetPermission).not.toHaveBeenCalled();

    mockIntroduction = "justEnded";
    await act(async () => {
      await view.rerender(<VenueResolver controller={controller} />);
    });
    await act(async () => {});
    expect(mockGetPermission).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("choose");
    expect(mockPush).not.toHaveBeenCalled();

    // Opening the camera still asks, as it does for anyone at an undecided spot.
    await act(async () => controller.promptChooser());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/venue-picker",
      params: { mode: "choose" },
    });
  });

  it("records a denied permission without asking for a position", async () => {
    mockGetPermission.mockResolvedValue({ granted: false });
    await expect(controller.resolve()).resolves.toEqual({});
    expect(mockGetPosition).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("denied");
  });

  it("leaves the system location prompt to a scan: launch and foreground only check the answer", async () => {
    mockGetPermission.mockResolvedValue({ granted: false });
    await mountResolver();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("denied");

    mockNearest.mockResolvedValue([metRow]);
    await act(async () => {
      await controller.resolveForScan(mockNow);
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(controller.getContext()).toEqual({ venueId: "id-met" });
  });

  it("pauses the visit while an expired Allow Once leaves location unanswered, and still only pauses it once declined", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const visit = await controller.visitForSave(metId, mockNow);
    controller.appStateChanged("background");
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: true });
    await controller.resolve();
    expect(controller.getState().status).toBe("denied");
    expect(mockVisits.get(visit.localId)).toMatchObject({ endedAt: null });

    await expect(controller.resolveForScan(mockNow)).resolves.toMatchObject({
      venueId: "id-met",
      visitLocalId: visit.localId,
    });

    controller.appStateChanged("background");
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: false });
    await controller.resolve();
    expect(controller.getState()).toMatchObject({ status: "denied", visit: { localId: visit.localId } });
    expect(mockVisits.get(visit.localId)).toMatchObject({ endedAt: null });
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

  it("never opens a second visit: a capture from before the open one began gets a visit spanning its saves", async () => {
    const openVisits = () => [...mockVisits.values()].filter((visit) => visit.endedAt === null);
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
    await expect(controller.visitForSave(metId, morning + 60_000)).resolves.toMatchObject({ localId: met.localId });
    expect(mockVisits.get(met.localId)).toMatchObject({
      venueId: "id-met",
      startedAt: morning,
      endedAt: morning + 60_000,
    });
    expect(openVisits().map((visit) => visit.localId)).toEqual(["uuid-1"]);
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
    // Back at the museum, a new capture waits for the open visit to be ended by hand.
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    const blocked = controller.visitForSave(metId, mockNow);
    await expect(blocked).rejects.toBeInstanceOf(VisitInProgressError);
    await expect(blocked).rejects.toMatchObject({ visit: { localId: "uuid-1", venueName: "Neue Galerie" } });
    expect(openVisits().map((visit) => visit.localId)).toEqual(["uuid-1"]);
  });

  it("files saves sorted after the fact under the museum day's visit instead of opening one", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const first = await controller.visitForSave(metId, mockNow - 60_000, { past: true });
    await expect(controller.visitForSave(metId, mockNow, { past: true })).resolves.toMatchObject({
      localId: first.localId,
    });
    expect(mockVisits.get(first.localId)).toMatchObject({ startedAt: mockNow - 60_000, endedAt: mockNow });
    expect(controller.getState().visit).toBeUndefined();
    expect(mockActivateVisit).not.toHaveBeenCalled();
    // An open visit at the museum takes them in.
    const open = await controller.visitForSave(metId, mockNow + 60_000);
    await expect(controller.visitForSave(metId, mockNow + 120_000, { past: true })).resolves.toMatchObject({
      localId: open.localId,
    });
  });

  it("files a save after the fact at its own museum while a visit is open at another", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockVenueName.mockResolvedValue("Neue Galerie");
    const neue = await controller.visitForSave(neueId, mockNow + 60_000, { past: true });
    expect(neue).toMatchObject({ venueId: "id-neue", venueName: "Neue Galerie" });
    expect(mockVisits.get(neue.localId)).toMatchObject({ endedAt: mockNow + 60_000 });
    expect(controller.getState().visit?.localId).toBe("uuid-1");
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

  it("keeps a visit open at another museum until it is ended by hand; only then does a save there start one", async () => {
    mockMutation.mockImplementation(async (ref: string, args: { localId?: string }) =>
      ref === "syncVisit" ? { visitId: args.localId === "uuid-2" ? "remote-2" : "remote-1" } : {},
    );
    mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    mockNow += 10 * 60 * 1000;
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-neue" });
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    await expect(controller.visitForSave(neueId, mockNow)).rejects.toMatchObject({ visit: { localId: "uuid-1" } });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    expect(mockVisits.size).toBe(1);
    await controller.end("uuid-1");
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

  it("carries a move of the open visit into the venue state and leaves it alone for another visit", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const open = await controller.visitForSave(metId, mockNow);
    const to = { venueId: neueId, venueName: "Neue Galerie", visitedOn: open.visitedOn, timeZone: open.timeZone };
    await controller.move(open.localId, to);
    expect(controller.getState().visit).toMatchObject({ localId: open.localId, ...to, startedAt: open.startedAt });
    await controller.move("elsewhere", { ...to, venueId: metId, venueName: "Metropolitan Museum of Art" });
    expect(controller.getState().visit).toMatchObject({ localId: open.localId, venueId: neueId });
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

  it("closes a visit left open from an earlier day at launch where its saves stopped, queues its wrap-up, and leaves other visits alone", async () => {
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
    mockLatestSaves.set("stale", startedAt + 2 * 60 * 60 * 1000);
    mockSettings.set(CURRENT, "stale");
    mockNearest.mockResolvedValue([metRow]);
    await mountResolver();
    expect(mockVisits.get("stale")).toMatchObject({ endedAt: startedAt + 2 * 60 * 60 * 1000 });
    expect(mockVisits.get("elsewhere")).toMatchObject({ endedAt: null });
    expect(mockSettings.get(CURRENT)).toBeUndefined();
    expect(mockSettings.get("wrapUpVisit:device:test-installation")).toBe("stale");
    // Yesterday's ending does not block today's visit at the same museum.
    expect(controller.visitByDefault(metId)).toBe(true);
    expect(controller.getContext()).toEqual({ venueId: "id-met" });
    expect(mockMutation).toHaveBeenCalledWith(
      "syncVisit",
      expect.objectContaining({ localId: "stale", endedAt: startedAt + 2 * 60 * 60 * 1000 }),
    );
  });

  it("closes a visit with no saves at its start when its day is over", async () => {
    const startedAt = mockNow - DAY;
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
    expect(controller.getState().visit).toBeUndefined();
  });

  it("keeps a visit open past midnight while the app stays up, then closes it on the next foreground and lets a new one start", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    const lateSave = mockNow + 2 * 60 * 60 * 1000;
    mockNow = lateSave;
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({ localId: "uuid-1" });
    mockLatestSaves.set("uuid-1", lateSave);
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    mockNow += DAY;
    // The next day's resolve closes yesterday's visit before deciding where the phone is.
    await expect(controller.resolve()).resolves.toEqual({ venueId: "id-met" });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: lateSave });
    expect(mockSettings.get("wrapUpVisit:device:test-installation")).toBe("uuid-1");
    expect(controller.visitByDefault(metId)).toBe(true);
    await expect(controller.visitForSave(metId, mockNow)).resolves.toMatchObject({ localId: "uuid-2" });
    expect(mockVisits.get("uuid-2")).toMatchObject({ endedAt: null });
  });

  it("starts a visit from the Add visit sheet without a save and lets the next save join it", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await expect(controller.startVisit(metId)).resolves.toMatchObject({ localId: "uuid-1", startedAt: mockNow });
    expect(controller.getContext()).toEqual({ venueId: "id-met", visitLocalId: "uuid-1" });
    expect(mockSettings.get(CURRENT)).toBe("uuid-1");
    await expect(controller.visitForSave(metId, mockNow + 60_000)).resolves.toMatchObject({ localId: "uuid-1" });
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
    await controller.end("uuid-1");
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

  it("pauses the visit when Not here is tapped over its own museum; it stays open until ended by hand", async () => {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    await controller.visitForSave(metId, mockNow);
    await act(async () => {
      controller.dismiss();
    });
    expect(mockVisits.get("uuid-1")).toMatchObject({ endedAt: null });
    expect(controller.getState().visit?.localId).toBe("uuid-1");
    expect(controller.getContext()).toEqual({});
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
    await expect(confirming).resolves.toBeUndefined();
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
      await controller.end("uuid-1");
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
  mockGetPermission.mockResolvedValue({ granted: false });
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
  expect(mockGetPermission).not.toHaveBeenCalled();
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

it("closes a searched museum's visit the next day while location stays denied, and a relaunch finds it closed", async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  await controller.confirm({ kind: "seeded", venueId: metId, name: metRow.name, manual: byHand() });
  const visit = await controller.visitForSave(metId, mockNow);
  mockNow += DAY;
  expect(await controller.resolve()).toEqual({});
  expect(controller.getState().visit).toBeUndefined();
  expect(mockVisits.get(visit.localId)).toMatchObject({ endedAt: visit.startedAt });
  expect(mockSettings.get("wrapUpVisit:device:test-installation")).toBe(visit.localId);
  const restored = createVenueController();
  await restored.hydrate();
  expect(restored.getContext()).toEqual({});
  expect(await restored.resolve()).toEqual({});
  expect(restored.getState().visit).toBeUndefined();
});

it("lets location take over the day after a museum was picked from search without a visit", async () => {
  mockGetPermission.mockResolvedValue({ granted: false });
  await controller.confirm({
    kind: "seeded",
    venueId: metId,
    name: metRow.name,
    manual: byHand(),
  });
  expect(await controller.resolve()).toEqual({ venueId: metId });
  expect(mockGetPermission).not.toHaveBeenCalled();
  mockNow += DAY;
  mockGetPermission.mockResolvedValue({ granted: true });
  mockNearest.mockResolvedValue([{ ...neueRow, distanceM: 40 }]);
  expect(await controller.resolve()).toEqual({ venueId: neueId });
  expect(mockGetPermission).toHaveBeenCalledTimes(1);
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

it("keeps a manually selected museum when its first save follows ending the previous visit", async () => {
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
  await controller.end(previous.localId);
  const next = await controller.visitForSave(neueId, mockNow);
  expect(mockVisits.get(previous.localId)?.endedAt).not.toBeNull();
  mockGetPermission.mockResolvedValue({ granted: false });
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
  mockGetPermission.mockResolvedValue({ granted: false });
  const restored = createVenueController();
  await restored.hydrate();
  expect(await restored.resolve()).toMatchObject({
    venueId: metId,
    visitLocalId: visit.localId,
  });
});

it("a museum change received through sync leaves new scans usable", async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  const open = await controller.visitForSave(metId, mockNow);
  await controller.syncRemoteVisit();
  // This is the row upsertVisitsFromRemote installs after another device changes the museum.
  const row = mockVisits.get(open.localId)!;
  mockVisits.set(open.localId, { ...row, venueId: neueId, venueName: "Neue Galerie", syncedAt: mockNow });
  await controller.syncRemoteVisit();
  await expect(controller.resolveForScan(mockNow)).resolves.toBeDefined();
});

it.each(["local", "remote"])(
  "follows a %s move of the manually selected open visit for captures, saves and relaunch",
  async (source) => {
    await controller.confirm({ kind: "seeded", venueId: metId, name: metRow.name, manual: byHand() });
    const open = await controller.visitForSave(metId, mockNow);
    await controller.syncRemoteVisit();
    const to = { venueId: neueId, venueName: neueRow.name, visitedOn: open.visitedOn, timeZone: open.timeZone };
    if (source === "local") {
      await controller.move(open.localId, to);
    } else {
      mockVisits.set(open.localId, { ...mockVisits.get(open.localId)!, ...to, syncedAt: mockNow });
      await controller.syncRemoteVisit();
    }
    const context = { venueId: neueId, visitLocalId: open.localId, visitId: "remote-1" };
    expect(await controller.resolveForScan(mockNow)).toEqual(context);
    expect(await controller.visitForSave(neueId, mockNow)).toMatchObject({ localId: open.localId });
    expect(JSON.parse(mockSettings.get("venuePick:device:test-installation")!)).toMatchObject({ venueId: neueId });
    const restored = createVenueController();
    mockGetPermission.mockResolvedValue({ granted: false });
    await restored.hydrate();
    expect(await restored.resolveForScan(mockNow)).toEqual(context);
  },
);

it("keeps an unrelated manually selected museum when the open visit moves", async () => {
  await controller.confirm({ kind: "seeded", venueId: metId, name: metRow.name, manual: byHand() });
  const open = await controller.visitForSave(metId, mockNow);
  const elsewhere = "id-elsewhere" as Id<"museums">;
  await controller.confirm({ kind: "seeded", venueId: elsewhere, name: "Elsewhere", manual: byHand() });
  await controller.move(open.localId, {
    venueId: neueId,
    venueName: neueRow.name,
    visitedOn: open.visitedOn,
    timeZone: open.timeZone,
  });
  expect(await controller.resolveForScan(mockNow)).toEqual({ venueId: elsewhere });
});

describe("starting a visit from the museum prompt", () => {
  async function prepareReplacement() {
    mockNearest.mockResolvedValue([metRow]);
    await controller.resolve();
    const previous = await controller.startVisit(metId);
    await controller.confirm({ kind: "seeded", venueId: neueId, name: neueRow.name });
    return previous;
  }

  it("replaces only the visit the prompt offered to end", async () => {
    const previous = await prepareReplacement();
    await expect(controller.startVisit(neueId, { replaceVisitLocalId: "stale-visit" })).rejects.toBeInstanceOf(
      VisitInProgressError,
    );
    expect(mockVisits.get(previous.localId)?.endedAt).toBeNull();
    const next = await controller.startVisit(neueId, { replaceVisitLocalId: previous.localId });
    expect(mockVisits.get(previous.localId)?.endedAt).toBe(mockNow);
    expect(controller.getState().visit?.localId).toBe(next.localId);
    expect(mockSettings.get(CURRENT)).toBe(next.localId);
  });

  it.each([false, true])(
    "cancels during the venue lookup without changing visits (replacement: %s)",
    async (replace) => {
      const previous = replace ? await prepareReplacement() : undefined;
      if (!replace) await controller.confirm({ kind: "seeded", venueId: neueId, name: neueRow.name });
      const coordinates = deferred<{ lat: number; lng: number }>();
      const locating = deferred<void>();
      mockCoordinates.mockImplementationOnce(() => {
        locating.resolve();
        return coordinates.promise;
      });
      const abort = new AbortController();
      const starting = controller.startVisit(neueId, { signal: abort.signal, replaceVisitLocalId: previous?.localId });
      await locating.promise;
      abort.abort();
      controller.dismiss();
      coordinates.resolve(met);
      await expect(starting).rejects.toMatchObject({ name: "AbortError" });
      expect(controller.getState().visit?.localId).toBe(previous?.localId);
      expect([...mockVisits.values()].map(({ localId, endedAt }) => ({ localId, endedAt }))).toEqual(
        previous ? [{ localId: previous.localId, endedAt: null }] : [],
      );
    },
  );

  it.each(["lookup", "commit"])(
    "preserves the previous visit after a %s failure and permits retry",
    async (failure) => {
      const previous = await prepareReplacement();
      if (failure === "lookup") {
        mockCoordinates.mockRejectedValueOnce(new Error("storage failure"));
      } else {
        mockActivateVisit.mockImplementationOnce(() => {
          throw new Error("storage failure");
        });
      }
      await expect(controller.startVisit(neueId, { replaceVisitLocalId: previous.localId })).rejects.toThrow(
        "storage failure",
      );
      expect(controller.getState().visit?.localId).toBe(previous.localId);
      expect(mockVisits.get(previous.localId)?.endedAt).toBeNull();
      expect(mockSettings.get(CURRENT)).toBe(previous.localId);
      const next = await controller.startVisit(neueId, { replaceVisitLocalId: previous.localId });
      expect(controller.getState().visit?.localId).toBe(next.localId);
    },
  );
});
