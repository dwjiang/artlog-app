import { render, screen } from "@testing-library/react-native";

import type { VisitSummary } from "@/lib/journal/visit-summaries";

import { VisitPlaceScreen } from "./visit-browse-screens";

const NAME = "Solomon R. Guggenheim Museum";
const mockSetOptions = jest.fn();
const mockVisit = {
  localId: "visit-1",
  venueId: "guggenheim",
  venueName: NAME,
  city: "New York",
  cityKey: "new-york",
  location: "New York, United States",
  visitedOn: "2026-10-04",
  works: [],
} as unknown as VisitSummary;
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ placeKey: "new-york", name: "Solomon R. Guggenheim Museum", venueId: "guggenheim" }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({ visits: [mockVisit], loading: false }),
}));
jest.mock("./visit-globe", () => ({ VisitGlobe: () => null }));

it("shows the whole museum name in the page and gives it to the bar for scrolling", async () => {
  await render(<VisitPlaceScreen />);

  expect(screen.getByRole("header", { name: NAME })).toBeOnTheScreen();
  expect(mockSetOptions).toHaveBeenCalledWith({ title: NAME });
});
