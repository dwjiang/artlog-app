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
let mockLoading = false;
let mockError: Error | undefined;
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({
    works: visitLocalId ? mockWorks : [],
    loading: mockLoading,
    error: mockError,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockWorks = [{ localId: "a" }, { localId: "b" }, { localId: "c" }];
  mockLoading = false;
  mockError = undefined;
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

it("offers a review action without implying the visit will end immediately", async () => {
  await render(<VisitBar />);
  expect(screen.getByText("Legion of Honor")).toBeOnTheScreen();
  expect(screen.getByText("Currently visiting · 3 artworks")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Visiting Legion of Honor" })).toHaveAccessibilityValue({
    text: "18 Sep 2026 · 3 artworks",
  });
  expect(screen.getByRole("button", { name: "Done?" })).toBeOnTheScreen();
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
  expect(screen.getByText("Visit open · 3 artworks")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Visit open at Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1" },
  });
});

it.each([true, false])("opens the end-visit review directly, whether at the museum (%s) or away", async (here) => {
  if (!here) mockVenue = undefined;
  await render(<VisitBar />);
  await fireEvent.press(screen.getByRole("button", { name: "Done?" }));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1", endVisit: "true" },
  });
});

it.each(["loading", "error"])(
  "keeps the visit actions available without a misleading artwork count during %s",
  async (state) => {
    mockWorks = [];
    mockLoading = state === "loading";
    mockError = state === "error" ? new Error("Unavailable") : undefined;
    await render(<VisitBar />);
    expect(screen.getByText("Currently visiting")).toBeOnTheScreen();
    expect(screen.queryByText(/artworks/)).toBeNull();
    expect(screen.getByRole("button", { name: "Done?" })).toBeOnTheScreen();
  },
);

it("renders nothing without an open visit", async () => {
  mockVisit = undefined;
  await render(<VisitBar />);
  expect(screen.queryByRole("button")).toBeNull();
});
