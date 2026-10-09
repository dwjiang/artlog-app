import { act, renderHook } from "@testing-library/react-native";
import type { RequestForQueries } from "convex/react";
import { AppState, type AppStateStatus } from "react-native";

import { useCurrentMuseumPhoto } from "./use-museum-photo";
import type { VenueView } from "./use-venue";

const mockRequest = jest.fn();
const appStateListeners = new Set<(state: AppStateStatus) => void>();
let mockResults: Record<string, { photo: unknown; checked: boolean }>;
let mockVisit: VenueView["visit"];
let mockReady: VenueView["ready"];
jest.mock("convex/react", () => ({
  useQueries: (queries: RequestForQueries) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { args }]) => [key, mockResults[(args as { venueId: string }).venueId]]),
    ),
  useMutation: () => mockRequest,
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("./use-venue", () => ({ useVenue: () => ({ visit: mockVisit, ready: mockReady }) }));

const aic = { kind: "seeded", venueId: "id-aic" as never, name: "Art Institute of Chicago" } as const;
const photo = { imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/AIC.jpg?width=1280", pageUrl: "p" };

beforeEach(() => {
  appStateListeners.clear();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  mockRequest.mockReset().mockResolvedValue(null);
  mockResults = {};
  mockVisit = undefined;
  mockReady = { kind: "here", venue: aic };
});
afterEach(() => jest.restoreAllMocks());

async function appStateChanged(state: AppStateStatus) {
  await act(() => {
    for (const listener of appStateListeners) listener(state);
  });
}

it("shows the photo of the museum the phone is at, asking nothing once it has been looked up", async () => {
  mockResults["id-aic"] = { photo, checked: true };
  const view = await renderHook(() => useCurrentMuseumPhoto());
  expect(view.result.current).toEqual(photo);
  expect(mockRequest).not.toHaveBeenCalled();
});

it("asks once for a lookup of a museum nobody has seen yet", async () => {
  mockResults["id-aic"] = { photo: null, checked: false };
  const view = await renderHook(() => useCurrentMuseumPhoto());
  await view.rerender({});
  expect(view.result.current).toBeUndefined();
  expect(mockRequest.mock.calls).toEqual([[{ venueId: "id-aic" }]]);
});

it("retries a pending lookup when the app returns after the backend timeout without remounting", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  mockResults["id-aic"] = { photo: null, checked: false };
  const view = await renderHook(() => useCurrentMuseumPhoto());
  await appStateChanged("inactive");
  await appStateChanged("background");
  expect(mockRequest).toHaveBeenCalledTimes(1);

  now.mockReturnValue(1_000_000 + 11 * 60_000);
  await appStateChanged("active");
  expect(mockRequest.mock.calls).toEqual([[{ venueId: "id-aic" }], [{ venueId: "id-aic" }]]);

  await view.unmount();
  await appStateChanged("active");
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

it.each([photo, null])("stops foreground retries once the lookup has completed with %p", async (result) => {
  mockResults["id-aic"] = { photo: null, checked: false };
  const view = await renderHook(() => useCurrentMuseumPhoto());
  mockResults["id-aic"] = { photo: result, checked: true };
  await view.rerender({});
  await appStateChanged("background");
  await appStateChanged("active");
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(view.result.current).toEqual(result ?? undefined);
});

it("retries only the current museum after switching venues", async () => {
  mockResults["id-aic"] = { photo: null, checked: false };
  const view = await renderHook(() => useCurrentMuseumPhoto());
  mockResults["id-met"] = { photo: null, checked: false };
  mockReady = { kind: "here", venue: { ...aic, venueId: "id-met" as never, name: "The Met" } };
  await view.rerender({});
  mockRequest.mockClear();
  await appStateChanged("background");
  await appStateChanged("active");
  expect(mockRequest.mock.calls).toEqual([[{ venueId: "id-met" }]]);
});

it("follows the open visit's museum, even away from it, and has none while several museums are undecided", async () => {
  mockResults["id-met"] = { photo, checked: true };
  mockVisit = {
    localId: "visit-1",
    venueId: "id-met" as never,
    venueName: "The Met",
    startedAt: 0,
    visitedOn: "2026-10-09",
    timeZone: "America/New_York",
  };
  expect((await renderHook(() => useCurrentMuseumPhoto())).result.current).toEqual(photo);

  mockVisit = undefined;
  mockReady = { kind: "choose" };
  expect((await renderHook(() => useCurrentMuseumPhoto())).result.current).toBeUndefined();
});
