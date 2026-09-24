import { fireEvent, render, screen } from "@testing-library/react-native";

import { VenuePill } from "./venue-pill";
import type { VenueView } from "@/lib/venue/use-venue";

const mockPush = jest.fn();
let mockLoading = false;
let mockView: VenueView;
let mockWorks: { localId: string }[] = [];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => mockView }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: (visitLocalId?: string) => ({
    works: visitLocalId ? mockWorks : [],
    loading: mockLoading,
  }),
}));

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

function view(
  status: VenueView["status"],
  venue?: VenueView["venue"],
  current?: VenueView["visit"],
): VenueView {
  return {
    status,
    venue,
    visit: current,
    options: [],
    resolve: jest.fn(),
    confirm: jest.fn(),
    dismiss: jest.fn(),
    declinePrompt: jest.fn(),
    end: jest.fn(),
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockLoading = false;
  mockWorks = [];
});

it("keeps the visit count behind a ghost until its artworks are read", async () => {
  mockView = view("resolved", legion, visit);
  mockLoading = true;
  const rendered = await render(<VenuePill />);
  expect(screen.getByLabelText("Loading visit artwork count")).toBeOnTheScreen();
  expect(screen.queryByText("· 0")).toBeNull();
  mockLoading = false;
  await rendered.rerender(<VenuePill />);
  expect(screen.getByText("· 0")).toBeOnTheScreen();
});

it("names the museum the phone resolved and opens the visit sheet on tap", async () => {
  mockView = view("resolved", legion);
  await render(<VenuePill />);
  await fireEvent.press(screen.getByRole("button", { name: "Legion of Honor" }));
  expect(mockPush).toHaveBeenCalledWith("/venue-picker");
});

it("shows the open visit with its artwork count", async () => {
  mockView = view("resolved", legion, visit);
  mockWorks = [{ localId: "a" }, { localId: "b" }, { localId: "c" }];
  await render(<VenuePill />);
  expect(
    screen.getByRole("button", { name: "Legion of Honor, visiting now, 3 artworks" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("· 3")).toBeOnTheScreen();
});

it("does not count a visit paused away from the resolved venue", async () => {
  mockView = view(
    "resolved",
    { ...legion, venueId: "id-other" as never, name: "de Young Museum" },
    visit,
  );
  mockWorks = [{ localId: "a" }];
  await render(<VenuePill />);
  expect(screen.getByRole("button", { name: "de Young Museum" })).toBeOnTheScreen();
  expect(screen.queryByText("· 1")).toBeNull();
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
] as [VenueView["status"], string][])(
  "offers the picker when the status is %s",
  async (status, label) => {
    mockView = view(status);
    await render(<VenuePill />);
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(mockPush).toHaveBeenCalledWith("/venue-picker");
  },
);
