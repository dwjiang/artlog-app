import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { useMuseumPick, type MuseumPick } from "@/lib/venue/use-museum-picks";
import { calendarDate } from "@/shared/journal/limits";

import { DontMiss } from "./dont-miss";

const mockPush = jest.fn();
let mockPicks: MuseumPick[] | Error | undefined;
let mockSaved: { artworkId: string | null }[] = [];
let mockRequests: Record<string, { args: unknown }> = {};
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/db/repos/saved-works", () => ({ listSavedArtworkIds: () => ({}) }));
jest.mock("drizzle-orm/expo-sqlite", () => ({ useLiveQuery: () => ({ data: mockSaved }) }));
jest.mock("convex/react", () => ({
  useQueries: (requests: Record<string, { args: unknown }>) => {
    mockRequests = requests;
    return requests.picks ? { picks: mockPicks } : {};
  },
}));
const mockReportError = jest.fn();
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));

const pick = (artworkId: string, title: string, artist: string): MuseumPick => ({
  artworkId: artworkId as never,
  title,
  artist,
  date: undefined,
  medium: undefined,
  thumbnailUrl: `https://museum.example/${artworkId}.jpg`,
  savers: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 2, 18));
  mockSaved = [];
  mockPicks = [
    pick("wheat", "Wheat Field with Cypresses", "Vincent van Gogh"),
    pick("delaware", "Washington Crossing the Delaware", "Emanuel Leutze"),
  ];
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("lists the museum's picks for the phone's day and opens one for a closer look", async () => {
  await render(<DontMiss venueId="met" />);
  expect(screen.getByRole("header", { name: "Don’t miss" })).toBeOnTheScreen();
  expect(mockRequests.picks.args).toEqual({ venueId: "met", day: expect.stringMatching(/^2026-10-0[12]$/) });
  expect(screen.getByText("Washington Crossing the Delaware")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Wheat Field with Cypresses, Vincent van Gogh" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/dont-miss", params: { venueId: "met", artworkId: "wheat" } });
});

it("leaves out works already saved", async () => {
  mockSaved = [{ artworkId: "wheat" }];
  await render(<DontMiss venueId="met" />);
  expect(screen.queryByText("Wheat Field with Cypresses")).toBeNull();
  expect(screen.getByText("Washington Crossing the Delaware")).toBeOnTheScreen();
});

it.each([
  ["while loading", undefined],
  ["when the museum has nothing to suggest", []],
])("stays hidden %s", async (_, picks) => {
  mockPicks = picks;
  await render(<DontMiss venueId="met" />);
  expect(screen.queryByRole("header", { name: "Don’t miss" })).toBeNull();
});

it("stays hidden and reports when the picks fail to load", async () => {
  mockPicks = new Error("Server Error");
  await render(<DontMiss venueId="met" />);
  expect(screen.queryByRole("header", { name: "Don’t miss" })).toBeNull();
  expect(mockReportError).toHaveBeenCalledWith(mockPicks, "venue.picks.load");
});

it("asks for nothing without a museum", async () => {
  await render(<DontMiss venueId={undefined} />);
  expect(mockRequests).toEqual({});
  expect(screen.queryByRole("header", { name: "Don’t miss" })).toBeNull();
});

it("refreshes the day when Home stays mounted across a background night", async () => {
  let change!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  await render(<DontMiss venueId="met" />);
  const before = mockRequests.picks.args;
  await act(() => change("background"));
  const tomorrow = Date.UTC(2026, 9, 3, 18);
  jest.spyOn(Date, "now").mockReturnValue(tomorrow);
  await act(() => change("active"));
  expect(mockRequests.picks.args).not.toEqual(before);
  expect(mockRequests.picks.args).toEqual({
    venueId: "met",
    day: calendarDate(tomorrow, Intl.DateTimeFormat().resolvedOptions().timeZone),
  });
});

it("refreshes at local midnight while Home remains in the foreground", async () => {
  jest.restoreAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 2, 23, 59, 59));
  await render(<DontMiss venueId="met" />);
  expect(mockRequests.picks.args).toEqual({ venueId: "met", day: "2026-10-02" });
  await act(() => jest.advanceTimersByTime(1001));
  expect(mockRequests.picks.args).toEqual({ venueId: "met", day: "2026-10-03" });
});

it("requests the selected artwork independently of the daily list and saved filter", async () => {
  mockSaved = [{ artworkId: "wheat" }];
  const { result } = await renderHook(() => useMuseumPick("met", "wheat"));
  expect(mockRequests.picks.args).toMatchObject({ venueId: "met", artworkId: "wheat" });
  expect(result.current).toMatchObject({ pick: { artworkId: "wheat" }, loading: false, error: false });
});
