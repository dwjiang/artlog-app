import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";

import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";
import type { VenueView } from "@/lib/venue/use-venue";

import { VisitPlayerBar } from "./visit-player-bar";

const mockAudio = {
  current: { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } } as { work: object } | undefined,
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
  playing: true,
  waiting: false,
  position: 12,
  duration: 72,
  controller: { toggle: jest.fn(), stop: jest.fn(), restart: jest.fn() },
};
let mockVisit: VenueView["visit"];
let mockVenue: VenueView["venue"];
jest.mock("@/lib/audio/use-listening", () => ({ useListening: () => mockAudio }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, venue: mockVenue }) }));

function renderBar() {
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      index: VisitPlayerBar,
      "now-playing": () => <Text>Now playing</Text>,
      "journal/[visitId]": () => <Text>Visit</Text>,
    },
    { initialUrl: "/" },
  );
}

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
  await renderBar();
  expect(screen.getByText("Metropolitan Museum of Art")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("· Playing · 1:00 left")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Open player, Water Lilies, Playing · 1:00 left" }),
  ).toHaveAccessibilityValue({ text: "Visiting Metropolitan Museum of Art" });
});

it("pauses the narration and opens the player from the bar", async () => {
  const view = renderBar();
  await view;
  await fireEvent.press(screen.getByRole("button", { name: "Pause narration" }));
  expect(mockAudio.controller.toggle).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole("button", { name: /Open player/ }));
  await waitFor(() => expect(view.getPathname()).toBe("/now-playing"));
  expect(view.getSearchParams()).toEqual({ view: "player" });
});

it("ends the visit from the bar through its review", async () => {
  const view = renderBar();
  await view;
  await fireEvent.press(screen.getByRole("button", { name: "End visit" }));
  await waitFor(() => expect(view.getPathname()).toBe("/journal/visit-1"));
  expect(view.getSearchParams()).toMatchObject({ endVisit: "true" });
});

it("shows generation progress while the narration loads and keeps End visit available", async () => {
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  await renderBar();
  expect(screen.getByRole("progressbar", { name: "Generating narration…" })).toBeBusy();
  expect(screen.queryByRole("button", { name: /narration$/ })).toBeNull();
  expect(screen.getByRole("button", { name: "End visit" })).toBeOnTheScreen();
});

it("stops the narration from the bar's actions without ending the visit", async () => {
  const view = renderBar();
  await view;
  await fireEvent(screen.getByRole("button", { name: /Open player/ }), "accessibilityAction", {
    nativeEvent: { actionName: "stop" },
  });
  expect(mockAudio.controller.stop).toHaveBeenCalledTimes(1);
  expect(view.getPathname()).toBe("/");
});

it("says the visit is open, not current, away from its museum", async () => {
  mockVenue = undefined;
  await renderBar();
  expect(screen.getByRole("button", { name: /Open player/ })).toHaveAccessibilityValue({
    text: "Visit open at Metropolitan Museum of Art",
  });
});

it.each(["visit", "narration"])("renders nothing without %s", async (missing) => {
  if (missing === "visit") mockVisit = undefined;
  else mockAudio.current = undefined;
  await renderBar();
  expect(screen.queryByRole("button")).toBeNull();
});
