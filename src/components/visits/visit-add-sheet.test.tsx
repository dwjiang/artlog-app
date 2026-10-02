import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { VenueView } from "@/lib/venue/use-venue";

import { VisitAddSheet } from "./visit-add-sheet";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockStartVisit = jest.fn();
const mockToast = jest.fn();
let mockVenue: VenueView["venue"];
let mockVisit: VenueView["visit"];
jest.mock("expo-router", () => ({ router: { back: () => mockBack(), replace: (to: string) => mockReplace(to) } }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: (message: string) => mockToast(message) }));
jest.mock("@/lib/settings/use-measurement-units", () => ({ useMeasurementUnits: () => ({ units: "metric" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ venue: mockVenue, visit: mockVisit, startVisit: mockStartVisit }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStartVisit.mockResolvedValue({ localId: "visit-1" });
  mockVenue = { kind: "seeded", venueId: "id-met" as never, name: "The Metropolitan Museum of Art", distanceM: 82 };
  mockVisit = undefined;
});

it("starts a visit at the museum the phone is at and closes", async () => {
  await render(<VisitAddSheet />);
  const start = screen.getByRole("button", { name: "Start a visit here" });
  expect(
    screen.getByHintText("The Metropolitan Museum of Art · 80 m. Artworks you scan there join it until you end it."),
  ).toBe(start);
  await fireEvent.press(start);
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockStartVisit).toHaveBeenCalledWith("id-met");
  expect(mockToast).toHaveBeenCalledWith("Visit started.");
});

it("keeps the sheet open with a message when the visit cannot start", async () => {
  mockStartVisit.mockRejectedValue(new Error("offline"));
  await render(<VisitAddSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Start a visit here" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t start the visit. Try again."));
  expect(mockBack).not.toHaveBeenCalled();
});

it("offers only a past visit when no museum is resolved, and says so while a visit is already open", async () => {
  mockVenue = undefined;
  const view = await render(<VisitAddSheet />);
  expect(screen.queryByRole("button", { name: "Start a visit here" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Log a past visit" }));
  expect(mockReplace).toHaveBeenCalledWith("/visit-create");
  mockVenue = { kind: "seeded", venueId: "id-met" as never, name: "The Metropolitan Museum of Art" };
  mockVisit = {
    localId: "visit-1",
    venueId: "id-met" as never,
    venueName: "The Metropolitan Museum of Art",
    startedAt: 1,
    visitedOn: "2026-09-18",
    timeZone: "America/New_York",
  };
  await view.rerender(<VisitAddSheet />);
  expect(screen.queryByRole("button", { name: "Start a visit here" })).toBeNull();
  expect(screen.getByText("Your visit to The Metropolitan Museum of Art is in progress.")).toBeOnTheScreen();
});
