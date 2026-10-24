import { act, fireEvent, render, screen } from "@testing-library/react-native";

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
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0 }),
}));
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
jest.mock("./player-transport", () => ({
  PlayerTransport: ({ onView }: { onView: (view: string) => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
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
