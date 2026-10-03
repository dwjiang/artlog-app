import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Color, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";

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
  controller: { toggle: jest.fn(), stop: jest.fn(), restart: jest.fn() },
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));

beforeEach(() => {
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  mockAudio.duration = 72;
  jest.clearAllMocks();
});

function renderMiniPlayer() {
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      index: MiniPlayer,
      "now-playing": () => <Text>Now playing</Text>,
    },
    { initialUrl: "/" },
  );
}

it.each([
  [72, "Playing · 1:00 left"],
  [0, "Playing"],
])(
  "shows the time left once the narration's length is known (%i s), and only the state before that",
  async (duration, status) => {
    mockAudio.duration = duration;
    await renderMiniPlayer();
    expect(screen.getByText(status)).toBeOnTheScreen();
  },
);

it("lets native glass adapt the title and playback status to the content behind it", async () => {
  await renderMiniPlayer();

  expect(screen.getByText("Water Lilies")).toHaveStyle({ color: Color.ios.label });
  expect(screen.getByText("Playing · 1:00 left")).toHaveStyle({ color: Color.ios.secondaryLabel });
});

it("shows generation activity and keeps the player reachable while audio is loading", async () => {
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  const view = renderMiniPlayer();
  await view;
  expect(screen.getByRole("progressbar", { name: "Generating narration…" })).toBeBusy();
  expect(screen.queryByRole("button", { name: "Play narration" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /Open player, Water Lilies, Generating narration/ }));
  await waitFor(() => expect(view.getPathname()).toBe("/now-playing"));
  expect(view.getSearchParams()).toEqual({ view: "player" });
});

it("offers stopping and restarting from the bar without opening the player", async () => {
  const view = renderMiniPlayer();
  await view;
  const summary = screen.getByRole("button", { name: /Open player, Water Lilies/ });

  await fireEvent(summary, "accessibilityAction", { nativeEvent: { actionName: "restart" } });
  await fireEvent(summary, "accessibilityAction", { nativeEvent: { actionName: "stop" } });

  expect(mockAudio.controller.restart).toHaveBeenCalledTimes(1);
  expect(mockAudio.controller.stop).toHaveBeenCalledTimes(1);
  expect(view.getPathname()).toBe("/");
});

it("opens Up next from the bar's actions", async () => {
  const view = renderMiniPlayer();
  await view;
  await fireEvent(screen.getByRole("button", { name: /Open player, Water Lilies/ }), "accessibilityAction", {
    nativeEvent: { actionName: "upNext" },
  });
  await waitFor(() => expect(view.getPathname()).toBe("/now-playing"));
  expect(view.getSearchParams()).toEqual({ view: "queue" });
});
