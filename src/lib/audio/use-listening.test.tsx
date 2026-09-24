import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { openingFixture, researchFixture } from "@/shared/audio/guide-fixtures";

import { ListeningController, type AudioHandle, type Playback } from "./listening-controller";
import { ListeningContext, useHasListeningTrack } from "./use-listening";

let emit: (patch?: Partial<Playback>) => void = () => {};
const player: AudioHandle = {
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
  setPlaybackRate: jest.fn(),
  setActiveForLockScreen: jest.fn(),
  seekTo: jest.fn(async () => {}),
  addListener: (_event, callback) => {
    emit = (patch) =>
      callback({
        currentTime: 0,
        duration: 100,
        playing: true,
        isLoaded: true,
        didJustFinish: false,
        ...patch,
      });
    return { remove: jest.fn() };
  },
};
const renders = jest.fn();
function Dock() {
  const listening = useHasListeningTrack();
  renders();
  return <Text>{listening ? "Player docked" : "No player"}</Text>;
}

it("re-renders layout around the player when a track loads or clears, not on every position update", async () => {
  const controller = new ListeningController({
    render: async () => ({ uri: "file:///audio.mp3", sentences: [] }),
    cancel: jest.fn(),
    configure: async () => {},
    create: () => player,
  });
  await render(
    <ListeningContext value={controller}>
      <Dock />
    </ListeningContext>,
  );
  await act(async () => {
    await controller.play({
      work: {
        artworkId: "a" as never,
        title: "A",
        artist: "Artist",
        facts: researchFixture,
        opening: openingFixture,
      },
    });
  });
  expect(screen.getByText("Player docked")).toBeOnTheScreen();
  const settled = renders.mock.calls.length;
  await act(async () => {
    emit();
    await Promise.resolve();
    emit({ currentTime: 1 });
    emit({ currentTime: 2 });
  });
  expect(controller.snapshot().position).toBe(2);
  expect(renders).toHaveBeenCalledTimes(settled);
  await act(async () => {
    controller.stop();
  });
  expect(screen.getByText("No player")).toBeOnTheScreen();
});
