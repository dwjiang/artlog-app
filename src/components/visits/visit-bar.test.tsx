import { fireEvent, render, screen } from "@testing-library/react-native";

import type { VenueView } from "@/lib/venue/use-venue";

import { VisitBar } from "./visit-bar";

const mockPush = jest.fn();
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ visit: mockVisit, venue: mockVenue }),
}));
let mockWorks: { localId: string }[] = [];
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({ works: visitLocalId ? mockWorks : [], loading: false }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockWorks = [{ localId: "a" }, { localId: "b" }, { localId: "c" }];
  mockVisit = {
    localId: "visit-1",
    venueId: "id-legion" as never,
    venueName: "Legion of Honor",
    startedAt: Date.UTC(2026, 8, 18, 21, 10),
    visitedOn: "2026-09-18",
    timeZone: "America/Los_Angeles",
  };
  mockVenue = { kind: "seeded", venueId: "id-legion" as never, name: "Legion of Honor" };
});

it("opens the visit from the compact dock and keeps ending the visit in its detail", async () => {
  await render(<VisitBar />);
  expect(screen.getByText("Legion of Honor")).toBeOnTheScreen();
  expect(screen.getByText("Currently visiting · 18 Sep 2026 · 3 artworks")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Visiting Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1" },
  });
});

it("stays up away from the museum, since the visit is open until ended by hand", async () => {
  mockVenue = undefined;
  await render(<VisitBar />);
  expect(screen.getByText("Legion of Honor")).toBeOnTheScreen();
  expect(screen.getByText("Visit open · 18 Sep 2026 · 3 artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Visit open at Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1" },
  });
});

it("renders nothing without an open visit", async () => {
  mockVisit = undefined;
  await render(<VisitBar />);
  expect(screen.queryByRole("button")).toBeNull();
});
