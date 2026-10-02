import { fireEvent, render, screen } from "@testing-library/react-native";

import type { VenueView } from "@/lib/venue/use-venue";

import { NowCard } from "./now-card";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
let mockVisitByDefault = true;
let mockWorks: { localId: string; cropPath: string | null; title: string }[] = [];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ visit: mockVisit, venue: mockVenue }),
  visitByDefault: () => mockVisitByDefault,
}));
jest.mock("./dont-miss", () => {
  const { Text } = jest.requireActual("react-native");
  return { DontMiss: ({ venueId }: { venueId?: string }) => (venueId ? <Text>Don’t miss at {venueId}</Text> : null) };
});
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({ works: visitLocalId ? mockWorks : [], loading: false }),
}));

const started = Date.UTC(2026, 8, 18, 17, 42);
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(started + 83 * 60_000);
  mockVisitByDefault = true;
  mockWorks = [
    { localId: "a", cropPath: "a.jpg", title: "Water Lilies" },
    { localId: "b", cropPath: "b.jpg", title: "Starry Night" },
  ];
  mockVenue = { kind: "seeded", venueId: "id-met" as never, name: "The Metropolitan Museum of Art" };
  mockVisit = undefined;
});
afterEach(() => jest.restoreAllMocks());

it("invites a scan at the museum the phone is at before anything is saved there", async () => {
  await render(<NowCard />);
  expect(screen.getByRole("header", { name: "Now" })).toBeOnTheScreen();
  expect(screen.getByText("You’re here")).toBeOnTheScreen();
  expect(screen.getByText("Scan an artwork to start today’s visit.")).toBeOnTheScreen();
  expect(screen.getByText("Don’t miss at id-met")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Scan" }));
  expect(mockNavigate).toHaveBeenCalledWith("/scan");
  await fireEvent.press(screen.getByRole("button", { name: "You’re here, The Metropolitan Museum of Art" }));
  expect(mockNavigate).toHaveBeenCalledTimes(2);
});

it("stays off Home when no museum is resolved or the visit there was ended today", async () => {
  mockVenue = undefined;
  const view = await render(<NowCard />);
  expect(screen.queryByRole("header", { name: "Now" })).toBeNull();
  mockVenue = { kind: "seeded", venueId: "id-met" as never, name: "The Metropolitan Museum of Art" };
  mockVisitByDefault = false;
  await view.rerender(<NowCard />);
  expect(screen.queryByRole("header", { name: "Now" })).toBeNull();
});

it("shows the visit in progress with its start and count, suggestions there, and opens it or its end review", async () => {
  mockVisit = {
    localId: "visit-1",
    venueId: "id-met" as never,
    venueName: "The Metropolitan Museum of Art",
    startedAt: started,
    visitedOn: "2026-09-18",
    timeZone: "America/New_York",
  };
  await render(<NowCard />);
  expect(screen.getByText("Visiting now")).toBeOnTheScreen();
  expect(screen.getByLabelText("Started 1:42 PM")).toBeOnTheScreen();
  expect(screen.getByLabelText("Artworks 2")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/So far/)).toBeNull();
  expect(screen.getByText("Don’t miss at id-met")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Visiting now, The Metropolitan Museum of Art" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/journal/[visitId]", params: { visitId: "visit-1" } });
  await fireEvent.press(screen.getByRole("button", { name: "End visit" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1", endVisit: "true" },
  });
});

it("keeps a visit paused elsewhere on the card as open rather than in progress", async () => {
  mockVisit = {
    localId: "visit-1",
    venueId: "id-met" as never,
    venueName: "The Metropolitan Museum of Art",
    startedAt: started,
    visitedOn: "2026-09-18",
    timeZone: "America/New_York",
  };
  mockVenue = { kind: "seeded", venueId: "id-neue" as never, name: "Neue Galerie" };
  await render(<NowCard />);
  expect(screen.getByText("Visit open")).toBeOnTheScreen();
  expect(screen.getByText("The Metropolitan Museum of Art")).toBeOnTheScreen();
  expect(screen.queryByText("Neue Galerie")).toBeNull();
  expect(screen.queryByText(/Don’t miss/)).toBeNull();
});
