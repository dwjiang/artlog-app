import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Color, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";

import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";

import type { GuideSection, GuideSentence } from "../../../convex/lib/validators";
import { MiniPlayer } from "./mini-player";

// Four equally long sentences, one per section, so each section takes a quarter of the guide.
const guide: GuideSentence[] = (["hook", "look", "story", "takeaway"] as GuideSection[]).map((section) => ({
  sentence: "Monet painted the pond he dug.",
  factIds: [],
  section,
}));
const mockAudio = {
  current: { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } },
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
  sentences: guide as GuideSentence[] | undefined,
  playing: true,
  waiting: false,
  position: 40,
  duration: 72,
  availableDuration: 0,
  controller: { toggle: jest.fn(), stop: jest.fn(), restart: jest.fn(), seek: jest.fn() },
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));
jest.mock("@shopify/react-native-skia", () => {
  const { View } = jest.requireActual("react-native");
  return { Canvas: View, Path: View };
});

beforeEach(() => {
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  mockAudio.sentences = guide;
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

it("names the artist and the section being spoken", async () => {
  await renderMiniPlayer();

  expect(screen.getByText("Claude Monet")).toBeOnTheScreen();
  expect(screen.getByText(" · The story")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Open player, Water Lilies, Claude Monet, The story" })).toBeOnTheScreen();
});

it("names only the artist until the guide's sections are known", async () => {
  mockAudio.sentences = undefined;
  await renderMiniPlayer();

  expect(screen.getByRole("button", { name: "Open player, Water Lilies, Claude Monet" })).toBeOnTheScreen();
  expect(screen.queryByText(/·/)).toBeNull();
});

it("lets native glass adapt the title and byline to the content behind it", async () => {
  await renderMiniPlayer();

  expect(screen.getByText("Water Lilies")).toHaveStyle({ color: Color.ios.label });
  expect(screen.getByText("Claude Monet")).toHaveStyle({ color: Color.ios.secondaryLabel });
});

it("goes back 15 seconds from the bar", async () => {
  await renderMiniPlayer();
  await fireEvent.press(screen.getByRole("button", { name: "Back 15 seconds" }));
  expect(mockAudio.controller.seek).toHaveBeenCalledWith(25);
});

it("says when narration failed and retries from the play button", async () => {
  mockAudio.phase = "error";
  await renderMiniPlayer();

  expect(screen.getByText("Couldn’t play · Tap to retry")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Retry narration" }));
  expect(mockAudio.controller.toggle).toHaveBeenCalledTimes(1);
});

it("shows generation activity and keeps the player reachable while audio is loading", async () => {
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  const view = renderMiniPlayer();
  await view;
  expect(screen.getByRole("progressbar", { name: "Generating narration…" })).toBeBusy();
  expect(screen.queryByRole("button", { name: "Play narration" })).toBeNull();
  expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeDisabled();
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
