import { fireEvent, render, screen } from "@testing-library/react-native";

import type { VenueView } from "@/lib/venue/use-venue";

import { VenuePill } from "./venue-pill";

const mockPush = jest.fn();
let mockView: VenueView;

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => mockView }));

const legion = {
  kind: "seeded",
  venueId: "id-legion" as never,
  name: "Legion of Honor",
  distanceM: 40,
} as const;
const visit = {
  localId: "visit-1",
  venueId: "id-legion" as never,
  venueName: "Legion of Honor",
  startedAt: 1,
  visitedOn: "2026-09-18",
  timeZone: "America/Los_Angeles",
};

function view(status: VenueView["status"], venue?: VenueView["venue"], current?: VenueView["visit"]): VenueView {
  return {
    hydrated: true,
    status,
    venue,
    visit: current,
    options: [],
    resolve: jest.fn(),
    confirm: jest.fn(),
    dismiss: jest.fn(),
    declinePrompt: jest.fn(),
    promptChooser: jest.fn(),
    end: jest.fn(),
    startVisit: jest.fn(),
    move: jest.fn(),
  };
}

beforeEach(() => {
  mockPush.mockReset();
});

it("names the museum the phone resolved and opens the museum chooser on tap", async () => {
  mockView = view("resolved", legion);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
});

it("steps aside for the visit band while a visit is in progress at the resolved museum", async () => {
  mockView = view("resolved", legion, visit);
  await render(<VenuePill />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("names the resolved museum when the open visit is paused at another one", async () => {
  mockView = view("resolved", { ...legion, venueId: "id-other" as never, name: "de Young Museum" }, visit);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole("button", { name: "de Young Museum" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
});

it("says it is still looking while the first fix is in flight and cannot be tapped", async () => {
  mockView = view("locating");
  await render(<VenuePill />);
  const pill = screen.getByRole("button", { name: "Finding your museum…" });
  expect(pill).toBeDisabled();
  expect(pill).toBeBusy();
  await fireEvent.press(pill);
  expect(mockPush).not.toHaveBeenCalled();
});

it("keeps the visit venue while a fresh fix is in flight", async () => {
  mockView = view("locating", legion);
  await render(<VenuePill />);
  expect(screen.getByRole("button", { name: "Legion of Honor" })).toBeEnabled();
});

it.each([
  ["none", "No museum nearby"],
  ["denied", "Location is off"],
  ["choose", "Which museum?"],
] as [VenueView["status"], string][])("offers the picker when the status is %s", async (status, label) => {
  mockView = view(status);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole("button", { name: label }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
});
