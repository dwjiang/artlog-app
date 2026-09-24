import { fireEvent, render, screen } from "@testing-library/react-native";

import { NowPlayingScreen } from "./now-playing-screen";

const mockAudio = {
  current: {
    work: {
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
  sentences: [{ sentence: "Take a moment to notice the lilies.", factIds: ["f1"] }] as
    | { sentence: string; factIds: string[] }[]
    | undefined,
  phase: "ready",
  controller: {},
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { back: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock("./listening-queue", () => ({
  ListeningQueue: () => null,
  QueueOptions: () => null,
}));
jest.mock("./add-saved-works", () => ({ AddSavedWorks: () => null }));
jest.mock("./player-transport", () => ({
  PlayerTransport: ({ onView }: { onView: (view: string) => void }) => {
    const { Pressable, Text } = jest.requireActual("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={() => onView("transcript")}>
        <Text>Transcript and sources</Text>
      </Pressable>
    );
  },
}));

it("shows the exact spoken script with its sources rather than the artwork card text", async () => {
  await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  expect(screen.getByText("Take a moment to notice the lilies.")).toBeOnTheScreen();
  expect(screen.getByText("Museum")).toBeOnTheScreen();
  expect(screen.queryByText("The original research.")).toBeNull();
});

it("shows preparation status until the spoken transcript is available", async () => {
  mockAudio.sentences = undefined;
  mockAudio.phase = "loading";
  await render(<NowPlayingScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Transcript and sources" }));
  expect(screen.getByText("Preparing your audio guide…")).toBeOnTheScreen();
  expect(screen.queryByText("The original research.")).toBeNull();
});
