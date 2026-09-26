import { render, screen } from "@testing-library/react-native";

import { MiniPlayer } from "./mini-player";

const mockAudio = {
  current: { work: { title: "Water Lilies", artist: "Claude Monet", facts: [] } },
  phase: "ready",
  playing: true,
  waiting: false,
  position: 12,
  duration: 72,
  controller: { toggle: jest.fn() },
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => mockAudio,
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

it("shows the time left once the narration's length is known, and only the state before that", async () => {
  const { rerender } = await render(<MiniPlayer />);
  expect(screen.getByText("Playing · 1:00 left")).toBeOnTheScreen();
  mockAudio.duration = 0;
  await rerender(<MiniPlayer />);
  expect(screen.getByText("Playing")).toBeOnTheScreen();
});
