import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import type { VenueView } from "@/lib/venue/use-venue";

import { VisitBand, VisitBandLayout } from "./visit-band";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
let mockWorks: { localId: string; cropPath: string | null; title: string }[] = [];
let mockLoading = false;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, venue: mockVenue }) }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({ works: visitLocalId ? mockWorks : [], loading: mockLoading }),
}));

const started = Date.UTC(2026, 8, 18, 21, 14);
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(started + 40 * 60_000);
  jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
  mockLoading = false;
  mockWorks = [
    { localId: "a", cropPath: "a.jpg", title: "Water Lilies" },
    { localId: "b", cropPath: null, title: "Irises" },
  ];
  mockVisit = {
    localId: "visit-1",
    venueId: "id-aic" as never,
    venueName: "Art Institute of Chicago",
    startedAt: started,
    visitedOn: "2026-09-18",
    timeZone: "America/Chicago",
  };
  mockVenue = { kind: "seeded", venueId: "id-aic" as never, name: "Art Institute of Chicago" };
});
afterEach(() => jest.restoreAllMocks());

it("names the visit in progress and opens it, the camera or its end review", async () => {
  await render(<VisitBand />);
  expect(screen.getByText("Art Institute of Chicago")).toBeOnTheScreen();
  const band = screen.getByRole("button", { name: "Visiting Art Institute of Chicago" });
  expect(band).toHaveAccessibilityValue({ text: "since 4:14 PM, 2 artworks" });
  await fireEvent.press(band);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/journal/[visitId]", params: { visitId: "visit-1" } });
  await fireEvent.press(screen.getByRole("button", { name: "Scan" }));
  expect(mockNavigate).toHaveBeenCalledWith("/scan");
  await fireEvent.press(screen.getByRole("button", { name: "End visit" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1", endVisit: "true" },
  });
});

it("stays up away from the museum, naming the visit as open rather than in progress", async () => {
  mockVenue = undefined;
  await render(<VisitBand />);
  expect(screen.getByRole("button", { name: "Visit open at Art Institute of Chicago" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "End visit" })).toBeOnTheScreen();
});

it("leaves the artwork count out of its summary until the artworks are read", async () => {
  mockLoading = true;
  await render(<VisitBand />);
  expect(screen.getByRole("button", { name: "Visiting Art Institute of Chicago" })).toHaveAccessibilityValue({
    text: "since 4:14 PM",
  });
});

it("drops its Scan button on the camera", async () => {
  await render(<VisitBand onCamera />);
  expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
  expect(screen.getByRole("button", { name: "End visit" })).toBeOnTheScreen();
});

it("draws the newest saved photo, hidden from VoiceOver, and an opaque band under Reduce Transparency", async () => {
  const view = await render(<VisitBand />);
  expect(screen.queryByLabelText("Your photo of Water Lilies")).toBeNull();
  expect(screen.getByLabelText("Your photo of Water Lilies", { includeHiddenElements: true })).toBeTruthy();
  jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(true);
  await view.unmount();
  await render(<VisitBand />);
  expect(screen.queryByLabelText("Your photo of Water Lilies", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Visiting Art Institute of Chicago" })).toBeOnTheScreen();
});

it("shows nothing while the tab bar is hidden, or without an open visit", async () => {
  const view = await render(
    <VisitBandLayout value={{ windowTop: 62, tabBarHidden: true }}>
      <VisitBand />
    </VisitBandLayout>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  await view.unmount();
  mockVisit = undefined;
  await render(<VisitBand />);
  expect(screen.queryByRole("button")).toBeNull();
});
