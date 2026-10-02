import { fireEvent, render, screen } from "@testing-library/react-native";

import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";
import type { VenueView } from "@/lib/venue/use-venue";

import { VisitPlayerBar } from "./visit-player-bar";

const mockPush = jest.fn();
const mockAudio = {
  current: { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } } as { work: object } | undefined,
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
  playing: true,
  waiting: false,
  position: 12,
  duration: 72,
  controller: { toggle: jest.fn() },
};
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  useRouter: () => ({ push: mockPush }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("@/lib/audio/use-listening", () => ({ useListening: () => mockAudio }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, venue: mockVenue }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAudio.current = { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } };
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  mockAudio.playing = true;
  mockVisit = {
    localId: "visit-1",
    venueId: "id-met" as never,
    venueName: "Metropolitan Museum of Art",
    startedAt: Date.UTC(2026, 9, 2, 17, 42),
    visitedOn: "2026-10-02",
    timeZone: "America/New_York",
  };
  mockVenue = { kind: "seeded", venueId: "id-met" as never, name: "Metropolitan Museum of Art" };
});

it("keeps the visit as the title with the narration and its time left underneath", async () => {
  await render(<VisitPlayerBar />);
  expect(screen.getByText("Metropolitan Museum of Art")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("· Playing · 1:00 left")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Open player, Water Lilies, Playing · 1:00 left" }),
  ).toHaveAccessibilityValue({ text: "Visiting Metropolitan Museum of Art" });
});

it("pauses the narration, opens the player, and ends the visit from one bar", async () => {
  await render(<VisitPlayerBar />);
  await fireEvent.press(screen.getByRole("button", { name: "Pause narration" }));
  expect(mockAudio.controller.toggle).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole("button", { name: /Open player/ }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/now-playing", params: { view: "player" } });

  await fireEvent.press(screen.getByRole("button", { name: "End visit" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/journal/[visitId]",
    params: { visitId: "visit-1", endVisit: "true" },
  });
});

it("shows generation progress while the narration loads and keeps End visit available", async () => {
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  await render(<VisitPlayerBar />);
  expect(screen.getByRole("progressbar", { name: "Generating narration…" })).toBeBusy();
  expect(screen.queryByRole("button", { name: /narration$/ })).toBeNull();
  expect(screen.getByRole("button", { name: "End visit" })).toBeOnTheScreen();
});

it("says the visit is open, not current, away from its museum", async () => {
  mockVenue = undefined;
  await render(<VisitPlayerBar />);
  expect(screen.getByRole("button", { name: /Open player/ })).toHaveAccessibilityValue({
    text: "Visit open at Metropolitan Museum of Art",
  });
});

it.each(["visit", "narration"])("renders nothing without %s", async (missing) => {
  if (missing === "visit") mockVisit = undefined;
  else mockAudio.current = undefined;
  await render(<VisitPlayerBar />);
  expect(screen.queryByRole("button")).toBeNull();
});
