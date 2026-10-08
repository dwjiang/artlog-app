import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { showErrorToast, showToast } from "@/lib/ui/toast";
import type { VenueView } from "@/lib/venue/use-venue";

import { NowCard, NowCardScrolledAway, useNowCardScroll } from "./now-card";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockStartVisit = jest.fn();
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
let mockReady: VenueView["ready"];
let mockOptions: VenueView["options"] = [];
let mockWorks: { localId: string; cropPath: string | null; title: string }[] = [];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({
    visit: mockVisit,
    venue: mockVenue,
    ready: mockReady,
    options: mockOptions,
    startVisit: mockStartVisit,
  }),
}));
jest.mock("./dont-miss", () => {
  const { Text } = jest.requireActual("react-native");
  return { DontMiss: ({ venueId }: { venueId?: string }) => (venueId ? <Text>Don’t miss at {venueId}</Text> : null) };
});
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({ works: visitLocalId ? mockWorks : [], loading: false }),
}));

const started = Date.UTC(2026, 8, 18, 17, 42);
const met = { kind: "seeded", venueId: "id-met" as never, name: "The Metropolitan Museum of Art" } as const;
const visit = {
  localId: "visit-1",
  venueId: "id-met" as never,
  venueName: "The Metropolitan Museum of Art",
  startedAt: started,
  visitedOn: "2026-09-18",
  timeZone: "America/New_York",
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(started + 83 * 60_000);
  mockWorks = [
    { localId: "a", cropPath: "a.jpg", title: "Water Lilies" },
    { localId: "b", cropPath: "b.jpg", title: "Starry Night" },
  ];
  mockVenue = met;
  mockReady = { kind: "here", venue: met };
  mockOptions = [met];
  mockVisit = undefined;
  mockStartVisit.mockResolvedValue({ ...visit, startedAt: Date.now() });
});
afterEach(() => jest.restoreAllMocks());

it("starts today’s visit at the museum the phone is at, then opens the camera", async () => {
  await render(<NowCard />);
  expect(screen.getByRole("header", { name: "Now" })).toBeOnTheScreen();
  expect(screen.getByText("You’re here")).toBeOnTheScreen();
  expect(screen.getByText("The Metropolitan Museum of Art")).toBeOnTheScreen();
  expect(screen.getByText("Don’t miss at id-met")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
  expect(mockStartVisit).toHaveBeenCalledWith("id-met");
  expect(showToast).toHaveBeenCalledWith("Visit started.");
  expect(mockNavigate).toHaveBeenCalledWith("/scan");
});

it("stays on Home and offers a retry when the visit cannot start", async () => {
  mockStartVisit.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
  await render(<NowCard />);
  await fireEvent.press(screen.getByRole("button", { name: "Start visit" }));
  expect(showErrorToast).toHaveBeenCalledWith("Couldn’t start the visit.", expect.any(Function));
  expect(mockNavigate).not.toHaveBeenCalled();
});

it("asks which museum while several nearby are undecided, and starts the visit from the chooser", async () => {
  mockVenue = undefined;
  mockReady = { kind: "choose" };
  mockOptions = [met, { kind: "seeded", venueId: "id-neue" as never, name: "Neue Galerie" }];
  await render(<NowCard />);
  expect(screen.getByText("2 museums nearby")).toBeOnTheScreen();
  expect(screen.getByText("Which museum are you in?")).toBeOnTheScreen();
  expect(screen.queryByText(/Don’t miss/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Choose museum" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/venue-picker", params: { mode: "start" } });
  expect(mockStartVisit).not.toHaveBeenCalled();
});

it("stays off Home when no visit can start here and none is open", async () => {
  mockReady = undefined;
  await render(<NowCard />);
  expect(screen.queryByRole("header", { name: "Now" })).toBeNull();
});

it("shows the visit in progress with its start and count under the name, and opens it or its end review", async () => {
  mockVisit = visit;
  mockReady = undefined;
  await render(<NowCard />);
  expect(screen.queryByText("You’re here")).toBeNull();
  expect(screen.getByText("Since 1:42 PM · 2 artworks")).toBeOnTheScreen();
  expect(screen.getByText("Don’t miss at id-met")).toBeOnTheScreen();
  const card = screen.getByRole("button", { name: "Visiting The Metropolitan Museum of Art" });
  expect(card).toHaveAccessibilityValue({ text: "Since 1:42 PM · 2 artworks" });
  await fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/journal/[visitId]", params: { visitId: "visit-1" } });
  await fireEvent.press(screen.getByRole("button", { name: "End visit" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1", endVisit: "true" },
  });
});

it("leaves the count out until the visit has an artwork", async () => {
  mockVisit = visit;
  mockWorks = [];
  await render(<NowCard />);
  expect(screen.getByText("Since 1:42 PM")).toBeOnTheScreen();
});

it("keeps a visit paused elsewhere on the card as open rather than in progress", async () => {
  mockVisit = visit;
  mockVenue = { kind: "seeded", venueId: "id-neue" as never, name: "Neue Galerie" };
  mockReady = undefined;
  await render(<NowCard />);
  expect(screen.getByText("Visit open")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Visit open at The Metropolitan Museum of Art" })).toBeOnTheScreen();
  expect(screen.queryByText("Neue Galerie")).toBeNull();
  expect(screen.queryByText(/Don’t miss/)).toBeNull();
});

it("tells the tab layout when the card scrolls under the navigation bar and back, and resets when Home goes", async () => {
  const report = jest.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <NowCardScrolledAway value={report}>{children}</NowCardScrolledAway>
  );
  const view = await renderHook(() => useNowCardScroll(), { wrapper });
  const scroll = (y: number) =>
    act(() =>
      view.result.current.onScroll({
        nativeEvent: { contentOffset: { x: 0, y } },
      } as NativeSyntheticEvent<NativeScrollEvent>),
    );
  await act(() =>
    view.result.current.onCardLayout({
      nativeEvent: { layout: { x: 0, y: 8, width: 402, height: 280 } },
    } as LayoutChangeEvent),
  );
  for (const y of [-116, 0, 171]) await scroll(y);
  expect(report).not.toHaveBeenCalled();
  for (const y of [172, 600]) await scroll(y);
  expect(report.mock.calls).toEqual([[true]]);
  for (const y of [40, -116]) await scroll(y);
  expect(report.mock.calls).toEqual([[true], [false]]);
  await scroll(400);
  await view.unmount();
  expect(report.mock.calls).toEqual([[true], [false], [true], [false]]);
});
