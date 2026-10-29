import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollView, StyleSheet } from "react-native";

import { DisplayMaxFontSize } from "@/constants/theme";
import { dismissToast, showErrorToast } from "@/lib/ui/toast";

import type { GuideSentence } from "../../../convex/lib/validators";
import { NowPlayingScreen } from "./now-playing-screen";

const mockAudio = {
  renderId: "render-1" as string | undefined,
  current: {
    work: {
      artworkId: "artwork-1",
      title: "Water Lilies",
      artist: "Claude Monet",
      opening: "This is Water Lilies, by Claude Monet, dated 1916.",
      facts: [
        {
          id: "f1",
          text: "The original research.",
          sourceUrl: "https://museum.example/artwork",
          sourceLabel: "Museum",
          sourceScore: 1,
        },
      ],
    },
  },
  sentences: [{ sentence: "Take a moment to notice the lilies.", factIds: ["f1"], section: "hook" }] as
    | GuideSentence[]
    | undefined,
  phase: "ready",
  waiting: false,
  position: 0,
  duration: 30,
  availableDuration: 0,
  controller: {},
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { back: jest.fn(), push: (...args: unknown[]) => mockPush(...args) },
}));
let mockInsets = { bottom: 0, left: 0, right: 0 };
let mockVerticalBar: "leading" | "trailing" | null = null;
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));
jest.mock("expo-status-bar", () => ({ useVerticalBarEdgeIOS: () => mockVerticalBar }));
jest.mock("./listening-queue", () => ({
  ListeningQueue: ({ onAdd }: { onAdd: () => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={onAdd}>
        <Text>Add saved works</Text>
      </Pressable>
    );
  },
}));
jest.mock("./add-saved-works", () => ({ AddSavedWorks: () => null }));
let mockTransportMounts = 0;
jest.mock("./player-transport", () => ({
  PlayerTransport: ({ onView }: { onView: (view: string) => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
    jest.requireActual("react").useEffect(() => {
      mockTransportMounts += 1;
    }, []);
    return (
      <>
        <Pressable accessibilityRole="button" onPress={() => onView("transcript")}>
          <Text>Transcript and sources</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onView("queue")}>
          <Text>Up next</Text>
        </Pressable>
      </>
    );
  },
}));

it("shows the exact spoken script with its sources rather than the artwork card text", async () => {
  await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  expect(screen.getByText("Take a moment to notice the lilies.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "1 source" }));
  expect(screen.getByText("Museum")).toBeOnTheScreen();
  expect(screen.queryByText("The original research.")).toBeNull();
});

it("reports the audio once it plays and the transcript once it shows", async () => {
  mockAudio.phase = "loading";
  const { rerender } = await render(<NowPlayingScreen />);
  expect(screen.getByRole("button", { name: "Report audio" })).toBeDisabled();
  mockAudio.phase = "ready";
  await rerender(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Report audio" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/report",
    params: { kind: "audio", id: "artwork-1", renderId: "render-1" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  await fireEvent.press(screen.getByRole("button", { name: "Report transcript" }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/report", params: { kind: "transcript", id: "artwork-1" } });
});

it("keeps the failed recording reportable after playback stops", async () => {
  mockAudio.phase = "error";
  mockAudio.renderId = "failed-render";
  const { rerender } = await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Report audio" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/report",
    params: { kind: "audio", id: "artwork-1", renderId: "failed-render" },
  });
  mockAudio.renderId = undefined;
  await rerender(<NowPlayingScreen />);
  expect(screen.queryByRole("button", { name: "Report audio" })).toBeNull();
  mockAudio.renderId = "render-1";
});

it("returns from choosing saved works to Up next", async () => {
  await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Up next" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add saved works" }));
  expect(screen.getByText("Add saved works")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Add saved works" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
});

it("holds the transcript's place while the guide is prepared, and says when there is none", async () => {
  mockAudio.sentences = undefined;
  mockAudio.phase = "loading";
  const { rerender } = await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  expect(screen.getByRole("progressbar", { name: "Preparing narration…" })).toBeOnTheScreen();
  expect(screen.queryByText("The original research.")).toBeNull();
  mockAudio.phase = "error";
  await rerender(<NowPlayingScreen />);
  expect(screen.getByText("The transcript will appear when your audio guide is ready.")).toBeOnTheScreen();
});

it("shows narration failures as a toast above the modal player", async () => {
  mockAudio.phase = "error";
  mockAudio.waiting = false;
  const retry = jest.fn();
  await render(<NowPlayingScreen />);
  await act(() => showErrorToast("Narration is unavailable right now.", retry));
  expect(screen.getByRole("alert")).toHaveTextContent("Narration is unavailable right now.");
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Narration is unavailable right now.")).toBeNull();
  dismissToast();
});

type HostElement = ReturnType<typeof screen.getByRole>;

// The scroll views an element sits in, innermost first.
function scrollViewsAround(element: HostElement) {
  const found: HostElement[] = [];
  for (let node = element.parent; node; node = node.parent) {
    if (node.type === "RCTScrollView") found.push(node);
  }
  return found;
}

it("scrolls the title and the controls together, so large text pushes the controls down instead of under them", async () => {
  mockAudio.phase = "ready";
  await render(<NowPlayingScreen />);
  const [column] = scrollViewsAround(screen.getByText("Water Lilies"));
  expect(scrollViewsAround(screen.getByRole("button", { name: "Up next" }))).toEqual([column]);
  expect(column.props.scrollEnabled).toBe(true);
});

it("leaves the transcript to scroll on its own above the controls", async () => {
  mockAudio.phase = "ready";
  mockAudio.sentences = [{ sentence: "Take a moment to notice the lilies.", factIds: ["f1"], section: "hook" }];
  await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  const [transcript, column] = scrollViewsAround(screen.getByText("Take a moment to notice the lilies."));
  expect(transcript.props.scrollEnabled).not.toBe(false);
  expect(column.props).toMatchObject({ scrollEnabled: false, scrollsToTop: false });
  expect(scrollViewsAround(screen.getByRole("button", { name: "Up next" }))).toEqual([column]);
});

it("bounds the transcript by the screen, so it scrolls in the height the controls leave instead of pushing them off", async () => {
  mockAudio.phase = "ready";
  mockAudio.sentences = [{ sentence: "Take a moment to notice the lilies.", factIds: ["f1"], section: "hook" }];
  await render(<NowPlayingScreen />);
  const [player] = scrollViewsAround(screen.getByText("Water Lilies"));
  await fireEvent(player, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 722 } } });
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  const [transcript, column] = scrollViewsAround(screen.getByText("Take a moment to notice the lilies."));
  // Flexed content grew to its children's height at the largest text sizes, so the content is set to the column's
  // measured height, and each view down to the transcript then takes the height its parent leaves.
  expect(StyleSheet.flatten(column.props.contentContainerStyle)).toMatchObject({ height: 722 });
  const between: HostElement[] = [];
  // The Jest scroll view wraps its children in one unstyled view standing in for the content container.
  for (let node = transcript; node.parent?.parent && node.parent.parent !== column; node = node.parent) {
    between.push(node);
  }
  expect(between.length).toBeGreaterThan(0);
  for (const view of between) expect(StyleSheet.flatten(view.props.style)).toMatchObject({ flex: 1 });
});

it("opens a list from the column's top, so where the player was scrolled cannot hide the list's heading", async () => {
  mockAudio.phase = "ready";
  await render(<NowPlayingScreen />);
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  scrollTo.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
  scrollTo.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "Up next" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
});

it("keeps the controls mounted while switching views, so VoiceOver stays on the pressed button", async () => {
  mockAudio.phase = "ready";
  await render(<NowPlayingScreen />);
  const mounts = mockTransportMounts;
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  await fireEvent.press(screen.getByRole("button", { name: "Up next" }));
  expect(mockTransportMounts).toBe(mounts);
});

it("grows the title no larger than other headings, so a long word still fits a line", async () => {
  await render(<NowPlayingScreen />);
  const title = screen.getByText("Water Lilies");
  expect(StyleSheet.flatten(title.props.style).fontSize * title.props.maxFontSizeMultiplier).toBeCloseTo(
    DisplayMaxFontSize,
  );
});

// How far the views around an element push it in from the screen's right edge.
function rightInset(element: HostElement) {
  let inset = 0;
  for (let node = element.parent; node; node = node.parent) {
    const {
      padding = 0,
      paddingHorizontal = padding,
      paddingRight = paddingHorizontal,
    } = StyleSheet.flatten(node.props.style) ?? {};
    inset += Number(paddingRight);
  }
  return inset;
}

it.each([
  { bars: "the iPhone Duo's side bar", verticalBar: "trailing" as const, player: 0 },
  { bars: "landscape camera housings", verticalBar: null, player: 84 },
])("keeps the header clear of $bars and lets only a side bar's empty column hold the player", async (bars) => {
  mockInsets = { bottom: 0, left: 0, right: 84 };
  mockVerticalBar = bars.verticalBar;
  mockAudio.phase = "ready";
  mockAudio.sentences = [{ sentence: "Take a moment to notice the lilies.", factIds: ["f1"], section: "hook" }];
  try {
    await render(<NowPlayingScreen />);
    expect(rightInset(screen.getByRole("button", { name: "Minimize player" }))).toBe(84);
    expect(rightInset(screen.getByRole("button", { name: "Up next" }))).toBe(bars.player);
    await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
    expect(rightInset(screen.getByText("Take a moment to notice the lilies."))).toBeGreaterThanOrEqual(84);
  } finally {
    mockInsets = { bottom: 0, left: 0, right: 0 };
    mockVerticalBar = null;
  }
});
