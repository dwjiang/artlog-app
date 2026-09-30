import { fireEvent, render, screen } from "@testing-library/react-native";
import { Color, router } from "expo-router";

import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";

import { MiniPlayer } from "./mini-player";

const mockAudio = {
  current: { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } },
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
  playing: true,
  waiting: false,
  position: 12,
  duration: 72,
  controller: { toggle: jest.fn() },
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  router: { push: jest.fn() },
}));

beforeEach(() => {
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  mockAudio.duration = 72;
  jest.clearAllMocks();
});

it("shows the time left once the narration's length is known, and only the state before that", async () => {
  const { rerender } = await render(<MiniPlayer />);
  expect(screen.getByText("Playing · 1:00 left")).toBeOnTheScreen();
  mockAudio.duration = 0;
  await rerender(<MiniPlayer />);
  expect(screen.getByText("Playing")).toBeOnTheScreen();
});

it("lets native glass adapt the title and playback status to the content behind it", async () => {
  await render(<MiniPlayer />);

  expect(screen.getByText("Water Lilies")).toHaveStyle({ color: Color.ios.label });
  expect(screen.getByText("Playing · 1:00 left")).toHaveStyle({ color: Color.ios.secondaryLabel });
});

it("shows generation activity and keeps the player reachable while audio is loading", async () => {
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  await render(<MiniPlayer />);
  expect(screen.getByRole("progressbar", { name: "Generating narration…" })).toBeBusy();
  expect(screen.queryByRole("button", { name: "Play narration" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /Open player, Water Lilies, Generating narration/ }));
  expect(router.push).toHaveBeenCalledWith({ pathname: "/now-playing", params: { view: "player" } });
});
