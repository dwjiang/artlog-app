import { fireEvent, render, screen } from "@testing-library/react-native";
import { VisitBar } from "./visit-bar";
import type { VenueView } from "@/lib/venue/use-venue";
const mockPush = jest.fn();
let mockVisit: VenueView["visit"];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit }) }));
beforeEach(() => {
  jest.clearAllMocks();
  mockVisit = {
    localId: "visit-1",
    venueId: "id-legion" as never,
    venueName: "Legion of Honor",
    startedAt: 1,
    visitedOn: "2026-09-18",
    timeZone: "America/Los_Angeles",
  };
});
it("opens the visit from the compact dock and keeps ending the visit in its detail", async () => {
  await render(<VisitBar />);
  expect(screen.getByText("Visiting · Legion of Honor")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "End visit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Visiting Legion of Honor" }));
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
